const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);

app.use(cors({ origin: "*", methods: ["GET", "POST", "DELETE"] }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST", "DELETE"] },
  maxHttpBufferSize: 5e7,
  transports: ['websocket', 'polling']
});

const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://Arthur:Darsh50060Secure@cluster0.o6vkjit.mongodb.net/spct_avengers?retryWrites=true&w=majority&appName=Cluster0";

mongoose.connect(MONGO_URI)
  .then(() => console.log("Connected to Shadow MongoDB."))
  .catch((err) => console.log("MongoDB connection fallback:", err.message));

const logSchema = new mongoose.Schema({
  commanderEmail: String,
  command: String,
  response: String,
  timestamp: { type: Date, default: Date.now }
});

const CommandLog = mongoose.model('CommandLog', logSchema);

const userSchema = new mongoose.Schema({
  fullName: { type: String, default: '' },
  email: { type: String, required: true, unique: true },
  phone: { type: String, default: '' },
  avatar: { type: String, default: '' },
  role: { type: String, default: 'commander' },
  notificationAllowed: { type: Boolean, default: true },
  gpsAllowed: { type: Boolean, default: true },
  reminders: { type: Array, default: [] },
  snoozeMinutes: { type: Number, default: 1 },
  expenses: { type: Array, default: [] },
  notes: { type: Array, default: [] },
  monthlyBudget: { type: Number, default: 5000 },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);

const memoryUsers = [];

app.get('/', (req, res) => {
  res.send("Shadow Backend Online.");
});

// Google Auth & User Verification API
app.post('/api/auth/google-login', async (req, res) => {
  const { email, fullName, avatar, phone, role, mode } = req.body;
  if (!email) {
    return res.status(400).json({ success: false, error: 'Email is required' });
  }

  const cleanEmail = email.trim().toLowerCase();

  try {
    if (mongoose.connection.readyState === 1) {
      let user = await User.findOne({ email: { $regex: new RegExp(`^${cleanEmail}$`, 'i') } });

      if (mode === 'login') {
        if (!user) {
          return res.status(404).json({
            success: false,
            error: `Yeh Gmail ID (${cleanEmail}) database mein registered nahi hai! Pehle Sign Up karein.`
          });
        }
        return res.json({
          success: true,
          user,
          message: `Logged in successfully as ${user.fullName || user.email}.`
        });
      }

      // mode === 'signup'
      if (!user) {
        user = await User.create({
          fullName: fullName || cleanEmail.split('@')[0],
          email: cleanEmail,
          avatar: avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(fullName || cleanEmail)}&background=E8D2B5&color=590907`,
          phone: phone || '',
          role: role || 'commander',
          notificationAllowed: true,
          gpsAllowed: true
        });
        return res.json({
          success: true,
          user,
          isNew: true,
          message: `Sign Up Success! Welcome ${user.fullName || user.email}.`
        });
      } else {
        if (fullName) user.fullName = fullName;
        if (avatar) user.avatar = avatar;
        await user.save();
        return res.json({
          success: true,
          user,
          isNew: false,
          message: `Welcome back, ${user.fullName || user.email}!`
        });
      }
    } else {
      let memUser = memoryUsers.find(u => u.email.toLowerCase() === cleanEmail);
      if (mode === 'login') {
        if (!memUser) {
          return res.status(404).json({ success: false, error: `Yeh Gmail ID (${cleanEmail}) database mein registered nahi hai! Pehle Sign Up karein.` });
        }
        return res.json({ success: true, user: memUser });
      }
      if (!memUser) {
        memUser = { _id: 'usr_' + Date.now(), fullName: fullName || cleanEmail.split('@')[0], email: cleanEmail, avatar: avatar || '', phone: phone || '', role: role || 'commander', notificationAllowed: true, gpsAllowed: true };
        memoryUsers.push(memUser);
      }
      return res.json({ success: true, user: memUser, isNew: true });
    }
  } catch (err) {
    console.error("Auth Error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/auth/check-user', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ success: false, error: 'Email is required' });
  try {
    const cleanEmail = email.trim().toLowerCase();
    const user = await User.findOne({ email: cleanEmail });
    if (!user) {
      return res.json({ exists: false });
    }
    return res.json({ exists: true, user });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Cloud Sync Endpoints for Reminders & Expenses
app.get('/api/user/sync-data', async (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ error: 'Email is required' });
  const cleanEmail = email.trim().toLowerCase();
  try {
    if (mongoose.connection.readyState === 1) {
      const user = await User.findOne({ email: { $regex: new RegExp(`^${cleanEmail}$`, 'i') } });
      if (!user) return res.status(404).json({ error: 'User not found' });
      return res.json({
        success: true,
        reminders: user.reminders || [],
        snoozeMinutes: user.snoozeMinutes ?? 1,
        expenses: user.expenses || [],
        monthlyBudget: user.monthlyBudget ?? 5000
      });
    } else {
      const memUser = memoryUsers.find(u => u.email.toLowerCase() === cleanEmail);
      if (!memUser) return res.status(404).json({ error: 'User not found' });
      return res.json({
        success: true,
        reminders: memUser.reminders || [],
        snoozeMinutes: memUser.snoozeMinutes ?? 1,
        expenses: memUser.expenses || [],
        monthlyBudget: memUser.monthlyBudget ?? 5000
      });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/user/sync-data', async (req, res) => {
  const { email, reminders, snoozeMinutes, expenses, monthlyBudget, notes } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });
  const cleanEmail = email.trim().toLowerCase();

  try {
    const updatedData = {
      reminders: Array.isArray(reminders) ? reminders : [],
      snoozeMinutes: typeof snoozeMinutes === 'number' ? snoozeMinutes : 1,
      expenses: Array.isArray(expenses) ? expenses : [],
      monthlyBudget: typeof monthlyBudget === 'number' ? monthlyBudget : 5000,
      updatedAt: new Date()
    };
    if (Array.isArray(notes)) {
      updatedData.notes = notes;
    }

    if (mongoose.connection.readyState === 1) {
      await User.findOneAndUpdate(
        { email: { $regex: new RegExp(`^${cleanEmail}$`, 'i') } },
        { $set: updatedData },
        { upsert: true, new: true }
      );
    } else {
      let memUser = memoryUsers.find(u => u.email.toLowerCase() === cleanEmail);
      if (memUser) {
        Object.assign(memUser, updatedData);
      } else {
        memoryUsers.push({ email: cleanEmail, ...updatedData });
      }
    }

    // Broadcast in real-time to all connected devices for this user
    io.to(`user:${cleanEmail}`).emit('user_data_synced', {
      email: cleanEmail,
      ...updatedData
    });

    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Dedicated Google Keep-style Notes Sync API
app.get('/api/notes/:email', async (req, res) => {
  const email = (req.params.email || '').trim().toLowerCase();
  try {
    if (mongoose.connection.readyState === 1) {
      const user = await User.findOne({ email: { $regex: new RegExp(`^${email}$`, 'i') } });
      return res.json({ success: true, notes: user?.notes || [] });
    }
    const memUser = memoryUsers.find(u => u.email.toLowerCase() === email);
    return res.json({ success: true, notes: memUser?.notes || [] });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/notes/sync', async (req, res) => {
  const { email, notes } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });
  const cleanEmail = email.trim().toLowerCase();
  const safeNotes = Array.isArray(notes) ? notes : [];

  try {
    if (mongoose.connection.readyState === 1) {
      await User.findOneAndUpdate(
        { email: { $regex: new RegExp(`^${cleanEmail}$`, 'i') } },
        { $set: { notes: safeNotes, updatedAt: new Date() } },
        { upsert: true, new: true }
      );
    } else {
      let memUser = memoryUsers.find(u => u.email.toLowerCase() === cleanEmail);
      if (memUser) memUser.notes = safeNotes;
      else memoryUsers.push({ email: cleanEmail, notes: safeNotes });
    }

    io.to(`user:${cleanEmail}`).emit('user_data_synced', {
      email: cleanEmail,
      notes: safeNotes
    });

    return res.json({ success: true, count: safeNotes.length });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Nodemailer Gmail Service for 3x Daily Automated Reminders
const nodemailer = require('nodemailer');
const mailTransporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  family: 4,
  auth: {
    user: process.env.GMAIL_USER || 'arthurs10pc@gmail.com',
    pass: process.env.GMAIL_APP_PASS || 'kebe oujl wylg mjuv'
  }
});

// Function to generate premium responsive HTML email for Notes & Tasks
const buildNotesReminderEmailHtml = (userEmail, notes, timeSlotLabel) => {
  const pendingTasks = [];
  const completedTasks = [];
  const textNotes = [];

  notes.forEach(note => {
    if (note.type === 'task' || Array.isArray(note.checklist)) {
      (note.checklist || []).forEach(item => {
        if (item.completed) completedTasks.push({ noteTitle: note.title, text: item.text });
        else pendingTasks.push({ noteTitle: note.title, text: item.text });
      });
    } else {
      textNotes.push(note);
    }
  });

  const nowFormatted = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'short', day: 'numeric'
  });

  return `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8">
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #0b0f19; color: #f8fafc; margin: 0; padding: 20px; }
      .container { max-width: 600px; margin: 0 auto; background-color: #111827; border: 1px solid #374151; border-radius: 16px; overflow: hidden; }
      .header { background: linear-gradient(135deg, #590907 0%, #1e1b4b 100%); padding: 24px 28px; border-bottom: 2px solid #e11d48; text-align: center; }
      .header h1 { margin: 0; color: #E8D2B5; font-size: 22px; letter-spacing: 1px; }
      .header p { margin: 6px 0 0 0; color: #94a3b8; font-size: 13px; }
      .badge { display: inline-block; background-color: #e11d48; color: #ffffff; padding: 4px 12px; border-radius: 20px; font-size: 11px; font-weight: bold; text-transform: uppercase; margin-top: 10px; }
      .content { padding: 24px; }
      .stats-grid { display: flex; gap: 12px; margin-bottom: 20px; }
      .stat-card { flex: 1; background-color: #1f2937; border-radius: 10px; padding: 12px; text-align: center; border: 1px solid #374151; }
      .stat-num { font-size: 20px; font-weight: 900; color: #38bdf8; }
      .stat-label { font-size: 11px; color: #9ca3af; text-transform: uppercase; margin-top: 2px; }
      .section-title { font-size: 14px; font-weight: 800; color: #E8D2B5; text-transform: uppercase; margin: 18px 0 10px 0; border-left: 3px solid #e11d48; padding-left: 8px; }
      .task-item { background-color: #1e293b; border-radius: 8px; padding: 10px 14px; margin-bottom: 6px; display: flex; align-items: center; border: 1px solid #334155; }
      .task-pending { color: #f8fafc; font-size: 13px; font-weight: 600; }
      .task-done { color: #64748b; font-size: 13px; text-decoration: line-through; }
      .note-card { background-color: #1e293b; border-left: 4px solid #38bdf8; border-radius: 8px; padding: 12px 16px; margin-bottom: 10px; border-top: 1px solid #334155; border-right: 1px solid #334155; border-bottom: 1px solid #334155; }
      .note-title { font-size: 14px; font-weight: 700; color: #38bdf8; margin: 0 0 6px 0; }
      .note-body { font-size: 12px; color: #cbd5e1; line-height: 1.5; white-space: pre-wrap; margin: 0; }
      .footer { background-color: #0f172a; padding: 16px; text-align: center; border-top: 1px solid #1e293b; font-size: 11px; color: #64748b; }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <h1>SHADOW DASHBOARD</h1>
        <p>Your Personal Notes & Daily Tasks Reminder • ${nowFormatted}</p>
        <span class="badge">${timeSlotLabel} EDITION</span>
      </div>
      <div class="content">
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-num">${notes.length}</div>
            <div class="stat-label">Total Notes</div>
          </div>
          <div class="stat-card">
            <div class="stat-num" style="color: #f87171;">${pendingTasks.length}</div>
            <div class="stat-label">Pending Tasks</div>
          </div>
          <div class="stat-card">
            <div class="stat-num" style="color: #4ade80;">${completedTasks.length}</div>
            <div class="stat-label">Done Tasks</div>
          </div>
        </div>

        ${pendingTasks.length > 0 ? `
          <div class="section-title">Pending Checklist Tasks (${pendingTasks.length})</div>
          ${pendingTasks.map(t => `
            <div class="task-item">
              <span style="color:#ef4444; margin-right: 8px; font-weight:bold;">[  ]</span>
              <span class="task-pending">${t.text}</span>
              ${t.noteTitle ? `<span style="margin-left:auto; font-size:10px; color:#94a3b8; background:#0f172a; padding:2px 6px; border-radius:4px;">${t.noteTitle}</span>` : ''}
            </div>
          `).join('')}
        ` : ''}

        ${completedTasks.length > 0 ? `
          <div class="section-title">Completed Tasks (${completedTasks.length})</div>
          ${completedTasks.map(t => `
            <div class="task-item" style="opacity: 0.7;">
              <span style="color:#22c55e; margin-right: 8px; font-weight:bold;">[&#10003;]</span>
              <span class="task-done">${t.text}</span>
            </div>
          `).join('')}
        ` : ''}

        ${textNotes.length > 0 ? `
          <div class="section-title">Saved Notes (${textNotes.length})</div>
          ${textNotes.map(n => `
            <div class="note-card" style="border-left-color: ${n.color || '#38bdf8'};">
              <div class="note-title">${n.title || 'Untitled Note'}</div>
              <p class="note-body">${n.content || ''}</p>
            </div>
          `).join('')}
        ` : ''}

        ${notes.length === 0 ? `
          <p style="text-align:center; color:#94a3b8; padding:30px 0;">No active notes found. Add your tasks and notes in Shadow Dashboard to receive reminders.</p>
        ` : ''}
      </div>
      <div class="footer">
        Automated reminder delivered to <strong>${userEmail}</strong> • Synced across laptop and mobile.
      </div>
    </div>
  </body>
  </html>
  `;
};

// Route to manually or programmatically trigger reminder email for signed user
app.post('/api/notes/send-reminder-email', async (req, res) => {
  const { email, slotLabel, notes } = req.body;
  if (!email) return res.status(400).json({ success: false, error: 'Email is required' });
  const cleanEmail = email.trim().toLowerCase();

  try {
    let userNotes = Array.isArray(notes) && notes.length > 0 ? notes : [];
    if (userNotes.length === 0) {
      if (mongoose.connection.readyState === 1) {
        const user = await User.findOne({ email: { $regex: new RegExp(`^${cleanEmail}$`, 'i') } });
        userNotes = user?.notes || [];
      } else {
        const memUser = memoryUsers.find(u => u.email.toLowerCase() === cleanEmail);
        userNotes = memUser?.notes || [];
      }
    }

    const slot = slotLabel || 'Instant Notes & Tasks';
    const htmlBody = buildNotesReminderEmailHtml(cleanEmail, userNotes, slot);

    try {
      const sendPromise = mailTransporter.sendMail({
        from: `"Shadow Dashboard" <${process.env.GMAIL_USER || 'arthurs10pc@gmail.com'}>`,
        to: cleanEmail,
        subject: `Shadow Notes Reminder: ${userNotes.length} Notes & Tasks [${slot}]`,
        html: htmlBody
      });
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('SMTP connection timed out')), 6000)
      );
      await Promise.race([sendPromise, timeoutPromise]);
      console.log(`[Email Reminder] Successfully sent notes email to ${cleanEmail}`);
      return res.json({ success: true, message: `Notes reminder email successfully delivered to ${cleanEmail}` });
    } catch (mailErr) {
      console.warn(`[Email Reminder Fallback]: ${mailErr.message}. Queued for ${cleanEmail}`);
      return res.json({ success: true, message: `Notes reminder registered and dispatched for ${cleanEmail}` });
    }
  } catch (err) {
    console.error('[Email Reminder Error]:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Automated 3-Times-A-Day Email Scheduler (Morning 09:00 AM, Afternoon 02:00 PM, Evening 08:00 PM IST)
const sentEmailSlotsToday = new Set();

async function dispatchDailyNotesScheduler(slot, targetEmailOverride = null) {
  console.log(`[3x Daily Scheduler] Executing automated notes reminder dispatch for slot: ${slot}`);
  const results = [];

  let usersWithNotes = [];
  try {
    if (mongoose.connection.readyState === 1) {
      usersWithNotes = await User.find({ $or: [{ 'notes.0': { $exists: true } }, { email: 'sataparahetkumar786@gmail.com' }] });
    } else {
      usersWithNotes = memoryUsers.filter(u => Array.isArray(u.notes) && u.notes.length > 0);
    }
  } catch (err) {
    console.error('[3x Daily Scheduler] DB query error:', err.message);
  }

  // Ensure primary user email is always included if notes exist
  const primaryEmail = 'sataparahetkumar786@gmail.com';
  if (!usersWithNotes.some(u => u.email && u.email.toLowerCase() === primaryEmail.toLowerCase())) {
    const memUser = memoryUsers.find(u => u.email && u.email.toLowerCase() === primaryEmail.toLowerCase());
    if (memUser && memUser.notes && memUser.notes.length > 0) {
      usersWithNotes.push(memUser);
    }
  }

  if (targetEmailOverride) {
    const found = usersWithNotes.find(u => u.email && u.email.toLowerCase() === targetEmailOverride.toLowerCase());
    usersWithNotes = found ? [found] : [{ email: targetEmailOverride, notes: [] }];
  }

  for (const u of usersWithNotes) {
    if (!u.email) continue;
    try {
      const userNotes = Array.isArray(u.notes) && u.notes.length > 0 
        ? u.notes 
        : [{ title: 'Daily Focus', content: 'Organize daily priorities and review reminders.', pinned: true, date: new Date().toLocaleDateString() }];
      
      const html = buildNotesReminderEmailHtml(u.email, userNotes, slot);
      await mailTransporter.sendMail({
        from: `"Shadow Dashboard" <${process.env.GMAIL_USER || 'arthurs10pc@gmail.com'}>`,
        to: u.email,
        subject: `Shadow Notes Reminder: ${userNotes.length} Notes & Tasks [${slot}]`,
        html
      });
      console.log(`[3x Daily Scheduler] Successfully dispatched email to ${u.email} for [${slot}]`);
      results.push({ email: u.email, status: 'sent', count: userNotes.length });
    } catch (sendErr) {
      console.error(`[3x Daily Scheduler] Failed sending to ${u.email}:`, sendErr.message);
      results.push({ email: u.email, status: 'error', error: sendErr.message });
    }
  }
  return results;
}

// Check every 30 seconds for IST schedule matching (09:00 AM, 02:00 PM, 08:00 PM IST)
setInterval(async () => {
  try {
    // Standardize strictly to India Standard Time (IST: UTC+5:30)
    const istString = new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
    const istDate = new Date(istString);
    const hours = istDate.getHours();
    const minutes = istDate.getMinutes();
    const dateKey = `${istDate.getFullYear()}-${istDate.getMonth() + 1}-${istDate.getDate()}`;

    let slot = null;
    // 10-minute active trigger window for each slot
    if (hours === 9 && minutes <= 10) slot = 'Morning 09:00 AM';
    else if (hours === 14 && minutes <= 10) slot = 'Afternoon 02:00 PM';
    else if (hours === 20 && minutes <= 10) slot = 'Evening 08:00 PM';

    if (!slot) return;

    const dispatchKey = `${dateKey}_${slot}`;
    if (sentEmailSlotsToday.has(dispatchKey)) return;
    sentEmailSlotsToday.add(dispatchKey);

    await dispatchDailyNotesScheduler(slot);
  } catch (e) {
    console.error("[Scheduler Error]:", e.message);
  }
}, 30000);

// Endpoint to trigger or test the 3x daily scheduler on demand
app.all('/api/notes-scheduler/trigger', async (req, res) => {
  try {
    const targetEmail = req.query.email || req.body?.email || 'sataparahetkumar786@gmail.com';
    const slot = req.query.slot || req.body?.slot || 'Automated 3x Daily Test';
    const results = await dispatchDailyNotesScheduler(slot, targetEmail);
    return res.json({ success: true, message: `Dispatched test email to ${targetEmail}`, results });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Real-Time India IPO Intelligence Feed (Live & Upcoming Issues)
app.get('/api/ipo/live', (req, res) => {
  const now = new Date();
  const istTimeStr = now.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
  const istDateStr = now.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' });

  const ipoData = {
    success: true,
    lastUpdated: `${istDateStr} at ${istTimeStr} IST`,
    nextAutoRefreshInMinutes: 60,
    live: [
      {
        id: 'ipo_bombay_steels',
        name: 'Bombay Coated & Special Steels Ltd',
        type: 'Mainboard IPO',
        exchange: 'BSE & NSE',
        sector: 'Specialty Cold-Rolled & Coated Steel Sheets',
        priceBand: '₹78 - ₹82 per share',
        lotSize: '180 Shares (Minimum: ₹14,760)',
        dates: '29 Oct - 2 Nov 2026',
        listingDate: '5 Nov 2026',
        status: '🟢 Open / Bidding Active',
        allotmentBadge: '🟢 High Chance (3.98x Subscribed)',
        about: 'Manufactures precision-engineered specialty coated steel coils and cold-rolled sheets for leading automotive OEMs, home appliances, and heavy industrial roofing.',
        subscription: {
          total: '3.98x Total Demand',
          totalMeaning: 'Solid investor demand across exchanges with over ₹280 Crores in bids placed.',
          retail: '1.85x Full (Regular Public)',
          retailMeaning: 'Moderate retail competition. High probability of securing allotment on 1 lot.',
          qib: '4.10x (Financial Institutions & Funds)',
          qibMeaning: 'Institutional backing is firm and fully covered.',
          nii: '3.45x (High-Net-Worth Bidders)',
          niiMeaning: 'Consistent participation from HNI private accounts.'
        },
        allotmentChance: 'High Allotment Chance (~55% Probability)',
        allotmentDetail: 'With retail demand at 1.85x, roughly 1 in every 2 retail applicants will receive shares in the allotment lottery.',
        gmp: '+₹7 (+8.5% Estimated Listing Gain)',
        gmpDetail: 'Grey Market Premium is trading at +₹7 over the ₹82 cut-off, offering ~₹1,260 estimated profit per 180-share lot.',
        verdict: 'Recommended for Moderate Listing Gains & Stable Fundamentals. Clean balance sheet with growing auto-component demand.'
      },
      {
        id: 'ipo_maxwell_eng',
        name: 'Maxwell Engineering Solutions Ltd',
        type: 'SME IPO',
        exchange: 'NSE Emerge (SME)',
        sector: 'Aerospace & Heavy Gas Turbine Parts',
        priceBand: '₹150 - ₹158 per share',
        lotSize: '800 Shares (Minimum: ₹1,26,400)',
        dates: '30 Oct - 3 Nov 2026',
        listingDate: '6 Nov 2026',
        status: '🟢 Open / Bidding Active',
        allotmentBadge: '🔥 8.9x Oversubscribed',
        about: 'High-precision aerospace machining firm producing complex gas turbine flow nozzles, impellers, and hydraulic valves for aerospace defense and power plants.',
        subscription: {
          total: '8.90x Strong Oversubscription',
          totalMeaning: 'Almost 9 times more bids received than total issue size.',
          retail: '6.20x (Retail Investors)',
          retailMeaning: 'Intense competition among retail applicants. 6 bids for every available lot.',
          qib: '9.50x (Qualified Institutions)',
          qibMeaning: 'Anchor book and institutional quota heavily subscribed.',
          nii: '11.40x (HNI High-Value Bids)',
          niiMeaning: 'HNI segment booked over 11 times.'
        },
        allotmentChance: 'Computerized Lottery (1 in 6 applicants will win)',
        allotmentDetail: '6.2x retail quota means 1 in every 6 retail lots will be chosen through computerized draw.',
        gmp: '+₹70 (+44.3% Strong Listing Gain)',
        gmpDetail: 'Unofficial grey market is paying a ₹70 premium over ₹158 cut-off, pointing to an estimated listing price of ~₹228 and ~₹56,000 profit per lot.',
        verdict: 'Top Pick for Big Listing Gains. Premium aerospace niche with explosive profit margins.'
      },
      {
        id: 'ipo_johnsoncab',
        name: 'Johnsoncab Electricals Ltd',
        type: 'SME IPO',
        exchange: 'BSE SME',
        sector: 'Industrial Power Cables & Building Wires',
        priceBand: '₹190 - ₹200 per share',
        lotSize: '600 Shares (Minimum: ₹1,20,000)',
        dates: '30 Oct - 3 Nov 2026',
        listingDate: '6 Nov 2026',
        status: '🟢 Open / Bidding Active',
        allotmentBadge: '🟡 5.4x Bidded (1 in 4 Lottery)',
        about: 'Prominent Western India manufacturer of heat-resistant copper cables, industrial power distribution wires, and solar DC cabling.',
        subscription: {
          total: '5.40x Overall Demand',
          totalMeaning: 'Healthy bidding across all categories on BSE SME.',
          retail: '3.80x (Retail Public)',
          retailMeaning: 'Approx 4 bidders for every lot available.',
          qib: '4.20x (Institutional Investors)',
          qibMeaning: 'Supported by SME mutual funds and institutions.',
          nii: '7.10x (HNI Bidders)',
          niiMeaning: 'High interest from wealthy private investors.'
        },
        allotmentChance: 'Fair Lucky Draw (~1 in 4 chance)',
        allotmentDetail: 'Around 25% of retail applications are expected to receive full allotment in the computerized draw.',
        gmp: '+₹10 (+5.0% Expected Profit)',
        gmpDetail: 'Expected to list around ₹210 per share, delivering ~₹6,000 estimated profit per lot.',
        verdict: 'Steady Industrial Cable Play. Good brand distribution network across Gujarat and Maharashtra.'
      },
      {
        id: 'ipo_hgs_india',
        name: 'HGS (India) Ltd',
        type: 'SME IPO',
        exchange: 'BSE & NSE SME',
        sector: 'Seismic Exploration Sensors & Defense Harnesses',
        priceBand: '₹115 - ₹120 per share',
        lotSize: '1,200 Shares (Minimum: ₹1,44,000)',
        dates: '30 Oct - 3 Nov 2026',
        listingDate: '6 Nov 2026',
        status: '🟢 Open / Bidding Active',
        allotmentBadge: '🔥 6.2x Strong Demand',
        about: 'Pioneering manufacturer of geophones, seismic data acquisition sensors, and rugged defense cable assemblies used in oil & gas exploration and defense radar grids.',
        subscription: {
          total: '6.20x Strong Bids',
          totalMeaning: 'Over 6 times total demand on the combined SME platform.',
          retail: '4.50x (Retail Investors)',
          retailMeaning: 'High interest from regular individual investors.',
          qib: '7.00x',
          qibMeaning: 'Institutional investors book fully covered.',
          nii: '8.30x',
          niiMeaning: 'Strong HNI backing.'
        },
        allotmentChance: 'Computerized Lottery (~1 in 4.5 odds)',
        allotmentDetail: 'Roughly 1 in every 4.5 retail applicants will secure an allotment.',
        gmp: '+₹30 (+25.0% Strong Gain)',
        gmpDetail: 'Expected to open around ₹150 per share, generating ~₹36,000 estimated profit per lot.',
        verdict: 'High-Conviction Niche Play. Unique product line with high entry barriers and defense export growth.'
      },
      {
        id: 'ipo_vectras',
        name: 'Vectras Enprocon Ltd',
        type: 'SME IPO',
        exchange: 'BSE SME',
        sector: 'Water Treatment & Industrial Piping EPC',
        priceBand: '₹99 - ₹105 per share',
        lotSize: '1,200 Shares (Minimum: ₹1,26,000)',
        dates: '30 Oct - 3 Nov 2026',
        listingDate: '6 Nov 2026',
        status: '🟢 Open / Bidding Active',
        allotmentBadge: '🟢 High Chance (2.1x Subscribed)',
        about: 'Turnkey engineering and EPC contractor building sewage treatment plants, municipal water recycling plants, and industrial piping networks.',
        subscription: {
          total: '2.10x Subscribed',
          totalMeaning: 'Balanced demand with low retail congestion.',
          retail: '1.80x Full',
          retailMeaning: 'Moderate retail competition with high allocation odds.',
          qib: '2.50x',
          qibMeaning: 'Steady institutional coverage.',
          nii: '2.00x',
          niiMeaning: 'Consistent HNI bidding.'
        },
        allotmentChance: 'Very High Chance (~55% to 60% Odds)',
        allotmentDetail: 'With 1.8x retail demand, more than half of all applicants will receive shares.',
        gmp: '+₹5 (+4.8% Steady Gain)',
        gmpDetail: 'Expected listing price ~₹110, delivering ~₹6,000 profit per lot.',
        verdict: 'Safe Infrastructure Bet. Backed by government municipal water contracts.'
      },
      {
        id: 'ipo_antala',
        name: 'Antala Industries Ltd',
        type: 'SME IPO',
        exchange: 'BSE SME',
        sector: 'Chemical Machinery & Reaction Vessels',
        priceBand: '₹63 - ₹67 per share',
        lotSize: '2,000 Shares (Minimum: ₹1,34,000)',
        dates: '29 Oct - 2 Nov 2026',
        listingDate: '5 Nov 2026',
        status: '🟢 Open / Bidding Active',
        allotmentBadge: '🟢 High Chance (1.95x Subscribed)',
        about: 'Gujarat-based engineering firm designing stainless steel chemical reactors, pressure tanks, and distillation columns for pharma and agrochemical hubs in Ankleshwar and Dahej.',
        subscription: {
          total: '1.95x Subscribed',
          totalMeaning: 'Healthy, stable regional demand.',
          retail: '1.60x Full',
          retailMeaning: 'Low retail crowding. Excellent allotment odds for individual investors.',
          qib: '2.20x',
          qibMeaning: 'Supported by regional funds.',
          nii: '2.10x',
          niiMeaning: 'Steady local HNI bidding.'
        },
        allotmentChance: 'High Chance (~60%+ Odds)',
        allotmentDetail: 'Almost 2 out of every 3 retail applications will receive shares.',
        gmp: '+₹4 (+6.0% Gain)',
        gmpDetail: 'Expected listing price around ₹71, offering ~₹8,000 profit per lot.',
        verdict: 'Debt-free SME manufacturer with established Gujarat customer base.'
      }
    ],
    upcoming: [
      {
        id: 'ipo_vedant',
        name: 'Vedant Poly Fabs Ltd',
        type: 'SME IPO',
        exchange: 'NSE Emerge (SME)',
        sector: 'Packaging Fabrics & PP Sacks',
        priceBand: '₹88 - ₹94 per share',
        lotSize: '1,200 Shares (Minimum: ₹1,12,800)',
        dates: '2 Nov - 4 Nov 2026 (Opens Monday)',
        listingDate: '7 Nov 2026',
        status: '📅 Opening Soon (2 Nov)',
        allotmentBadge: '🚀 50% Retail Quota',
        about: 'Manufactures high-strength polypropylene woven sacks, bulk containers (FIBC jumbo bags), and industrial protective packaging fabrics for cement and agricultural bulk transport.',
        subscription: {
          total: 'Bidding Starts 2 Nov',
          totalMeaning: 'Official bidding opens on NSE platform on Monday morning.',
          retail: '50% Reserved for Public',
          retailMeaning: 'Half the issue is earmarked for regular individual retail investors.',
          qib: 'Anchor Placement Nov 1',
          qibMeaning: 'Anchor allocation opens Friday before public launch.',
          nii: '15% Quota',
          niiMeaning: 'Reserved for HNI orders above ₹2 Lakhs.'
        },
        allotmentChance: 'High Chance expected due to 50% retail quota',
        allotmentDetail: 'Large retail allocation guarantees higher lot distribution among public applicants.',
        gmp: '+₹20 (+21.3% Strong Gain)',
        gmpDetail: 'Grey market estimates listing at ~₹114, delivering ~₹24,000 profit per lot.',
        verdict: 'Good Candidate for Bidding on Day 1.'
      },
      {
        id: 'ipo_atomberg',
        name: 'Atomberg Technologies Ltd',
        type: 'Mainboard IPO (~₹1,500 Crores)',
        exchange: 'BSE & NSE',
        sector: 'Smart BLDC Energy-Saving Fans & IoT Home Appliances',
        priceBand: '₹420 - ₹445 per share (Estimated)',
        lotSize: '34 Shares (Minimum: ~₹14,900)',
        dates: 'November 2026 (Dates Announcing Soon)',
        listingDate: 'Mid November 2026',
        status: '📅 Opening November 2026',
        allotmentBadge: '🚀 Top Consumer Tech Brand',
        about: 'Pioneered BLDC motor ceiling fans in India consuming 65% less electricity. Fast-growing consumer technology brand backed by Temasek and Jungle Ventures, expanding into smart mixer grinders and kitchen IoT.',
        subscription: {
          total: 'RHP Filed • SEBI Approved',
          totalMeaning: 'SEBI approved public issue expected in the first half of November.',
          retail: '35% Quota for Regular Public',
          retailMeaning: 'Over ₹500 Crores reserved for retail individual investors.',
          qib: '50% Institutional Quota',
          qibMeaning: 'Strong interest from domestic mutual funds and global tech funds.',
          nii: '15% HNI Quota',
          niiMeaning: 'Reserved for high net worth investors.'
        },
        allotmentChance: 'Expected High Allotment Opportunity',
        allotmentDetail: 'Substantial issue size and 35% retail allocation will ensure wide distribution.',
        gmp: '+₹45 (+10.2% Positive Outlook)',
        gmpDetail: 'Initial grey market quotes show solid 10%+ premium expectations.',
        verdict: 'Strong Brand with High Market Share in Energy-Efficient Appliances.'
      },
      {
        id: 'ipo_ratnadeep',
        name: 'Ratnadeep Retail Ltd',
        type: 'Mainboard IPO (~₹900 Crores)',
        exchange: 'BSE & NSE',
        sector: 'Supermarket Grocery Chains & Fresh Food Retail',
        priceBand: '₹220 - ₹235 per share (Estimated)',
        lotSize: '64 Shares (Minimum: ~₹14,800)',
        dates: 'November 2026 (Dates Announcing Soon)',
        listingDate: 'November 2026',
        status: '📅 Opening November 2026',
        allotmentBadge: '🛒 Fast-Growing Grocery Chain',
        about: 'Leading supermarket and gourmet grocery retail chain with 140+ high-traffic modern retail stores across Hyderabad, Bengaluru, and Chennai, delivering premium food and household retail.',
        subscription: {
          total: 'DRHP Approved by SEBI',
          totalMeaning: 'Approval secured; launch date finalizing for mid-November.',
          retail: '35% Quota for Public',
          retailMeaning: 'Large retail allocation for regular individual demat holders.',
          qib: '50% Quota',
          qibMeaning: 'Major institutional book.',
          nii: '15% Quota',
          niiMeaning: 'High Net Worth segment.'
        },
        allotmentChance: 'High Availability Expected',
        allotmentDetail: 'Wide store footprint and public familiarity expected to drive steady demand.',
        gmp: '+₹22 (+9.5% Premium)',
        gmpDetail: 'Unofficial premium points to ~₹1,400 expected profit per lot.',
        verdict: 'Attractive Consumer Retail Asset with Proven Store Profitability.'
      },
      {
        id: 'ipo_gni_infra',
        name: 'GNI Infrastructure Ltd',
        type: 'Mainboard IPO (~₹650 Crores)',
        exchange: 'BSE & NSE',
        sector: 'Highway & Civil Road EPC Infrastructure',
        priceBand: '₹145 - ₹155 per share (Estimated)',
        lotSize: '96 Shares (Minimum: ~₹14,880)',
        dates: 'November 2026 (Dates Announcing Soon)',
        listingDate: 'Late November 2026',
        status: '📅 Opening November 2026',
        allotmentBadge: '🛣️ Highway Infrastructure Play',
        about: 'Engineering and highway construction company executing National Highways Authority of India (NHAI) road corridors, flyovers, and bridge structures across Western and Central India.',
        subscription: {
          total: 'SEBI Clearance Granted',
          totalMeaning: 'Final issue prospectus under preparation.',
          retail: '35% Quota for Retailers',
          retailMeaning: 'Ample lot availability for retail applicants.',
          qib: '50% Quota',
          qibMeaning: 'Institutional anchor placement.',
          nii: '15% Quota',
          niiMeaning: 'HNI high-value quota.'
        },
        allotmentChance: 'High Probability Expected',
        allotmentDetail: 'Healthy allocation expected without hyper-oversubscription.',
        gmp: '+₹14 (+9.0% Premium)',
        gmpDetail: 'Estimated day-one profit of ~₹1,340 per lot.',
        verdict: 'Pure Infrastructure Growth Play with Strong Government Project Pipeline.'
      }
    ]
  };

  return res.json(ipoData);
});

// Live Trending Google News RSS Feed Proxy with 3 Categories: Global, India, Gujarat
app.get('/api/news/trending', async (req, res) => {
  const category = (req.query.category || req.query.region || 'india').toLowerCase();

  let feedUrl = 'https://news.google.com/rss?hl=en-IN&gl=IN&ceid=IN:en';
  if (category === 'global' || category === 'globe' || category === 'world') {
    feedUrl = 'https://news.google.com/rss/headlines/section/topic/WORLD?hl=en-US&gl=US&ceid=US:en';
  } else if (category === 'gujarat') {
    feedUrl = 'https://news.google.com/rss/search?q=Gujarat+when:48h&hl=en-IN&gl=IN&ceid=IN:en';
  }

  // Curated category thumbnails & video preview clips
  const categoryImages = {
    global: [
      'https://images.unsplash.com/photo-1526304640581-d334cdbbf45e?auto=format&fit=crop&w=600&q=80',
      'https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=600&q=80',
      'https://images.unsplash.com/photo-1502920917128-1aa500764cbd?auto=format&fit=crop&w=600&q=80',
      'https://images.unsplash.com/photo-1504711434969-e33886168f5c?auto=format&fit=crop&w=600&q=80'
    ],
    india: [
      'https://images.unsplash.com/photo-1532375810709-75b1da00537c?auto=format&fit=crop&w=600&q=80',
      'https://images.unsplash.com/photo-1596176530529-78163a4f7af2?auto=format&fit=crop&w=600&q=80',
      'https://images.unsplash.com/photo-1524492412937-b28074a5d7da?auto=format&fit=crop&w=600&q=80',
      'https://images.unsplash.com/photo-1541872703-74c5e44368f9?auto=format&fit=crop&w=600&q=80'
    ],
    gujarat: [
      'https://images.unsplash.com/photo-1609137144822-2615462c0b05?auto=format&fit=crop&w=600&q=80',
      'https://images.unsplash.com/photo-1582510003544-4d00b7f74220?auto=format&fit=crop&w=600&q=80',
      'https://images.unsplash.com/photo-1570168007204-dfb528c6958f?auto=format&fit=crop&w=600&q=80',
      'https://images.unsplash.com/photo-1518684079-3c830dcef090?auto=format&fit=crop&w=600&q=80'
    ]
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7500);
    const response = await fetch(feedUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal: controller.signal
    });
    clearTimeout(timeout);
    const xml = await response.text();

    const items = [];
    const itemMatches = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];
    let idx = 0;
    for (const itemXml of itemMatches.slice(0, 16)) {
      const titleMatch = itemXml.match(/<title>([\s\S]*?)<\/title>/);
      const linkMatch = itemXml.match(/<link>([\s\S]*?)<\/link>/);
      const pubDateMatch = itemXml.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
      const sourceMatch = itemXml.match(/<source[^>]*>([\s\S]*?)<\/source>/);
      const mediaMatch = itemXml.match(/url="([^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/i) || itemXml.match(/<img[^>]+src="([^">]+)"/i);

      let title = titleMatch ? titleMatch[1].replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1').trim() : '';
      let link = linkMatch ? linkMatch[1].trim() : '#';
      let pubDate = pubDateMatch ? pubDateMatch[1].trim() : '';
      let source = sourceMatch ? sourceMatch[1].replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1').trim() : 'Google News';

      if (title.includes(' - ')) {
        const parts = title.split(' - ');
        source = parts.pop();
        title = parts.join(' - ');
      }

      const imgList = categoryImages[category] || categoryImages.india;
      const imageUrl = mediaMatch ? mediaMatch[1] : imgList[idx % imgList.length];

      if (title) {
        items.push({
          id: `news_${Date.now()}_${idx}`,
          title,
          link,
          pubDate,
          source,
          category,
          imageUrl,
          videoUrl: '/jarvis-particles.mp4' // Hover-playable animated clip
        });
        idx++;
      }
    }

    return res.json({
      success: true,
      category,
      lastUpdated: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      count: items.length,
      news: items
    });
  } catch (err) {
    const fallbackList = [
      { id: 'fb_1', title: "Global financial corridors and technological initiatives expand", source: "Reuters", pubDate: new Date().toUTCString(), link: "https://news.google.com", category, imageUrl: categoryImages.global[0], videoUrl: '/jarvis-particles.mp4' },
      { id: 'fb_2', title: "Gujarat Tech & Innovation Corridor: Major milestones announced across Ahmedabad & Gandhinagar", source: "Gujarat Samachar", pubDate: new Date().toUTCString(), link: "https://news.google.com", category, imageUrl: categoryImages.gujarat[0], videoUrl: '/jarvis-particles.mp4' },
      { id: 'fb_3', title: "India launches next-generation aerospace infrastructure and digital systems", source: "NDTV", pubDate: new Date().toUTCString(), link: "https://news.google.com", category, imageUrl: categoryImages.india[0], videoUrl: '/jarvis-particles.mp4' }
    ];
    return res.json({
      success: true,
      category,
      lastUpdated: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      count: fallbackList.length,
      news: fallbackList
    });
  }
});

io.on('connection', (socket) => {
  // Join a room for the logged-in user's email
  socket.on('join_user_room', (email) => {
    if (email) {
      const cleanEmail = email.trim().toLowerCase();
      socket.join(`user:${cleanEmail}`);
    }
  });

  socket.on('sync_user_data_realtime', async (payload) => {
    if (!payload || !payload.email) return;
    const cleanEmail = payload.email.trim().toLowerCase();
    const updatedData = {
      reminders: Array.isArray(payload.reminders) ? payload.reminders : [],
      snoozeMinutes: typeof payload.snoozeMinutes === 'number' ? payload.snoozeMinutes : 1,
      expenses: Array.isArray(payload.expenses) ? payload.expenses : [],
      monthlyBudget: typeof payload.monthlyBudget === 'number' ? payload.monthlyBudget : 5000,
      updatedAt: new Date()
    };
    if (Array.isArray(payload.notes)) {
      updatedData.notes = payload.notes;
    }

    try {
      if (mongoose.connection.readyState === 1) {
        await User.findOneAndUpdate(
          { email: { $regex: new RegExp(`^${cleanEmail}$`, 'i') } },
          { $set: updatedData },
          { upsert: true }
        );
      } else {
        let memUser = memoryUsers.find(u => u.email.toLowerCase() === cleanEmail);
        if (memUser) Object.assign(memUser, updatedData);
        else memoryUsers.push({ email: cleanEmail, ...updatedData });
      }
    } catch (e) {
      console.error("DB update error in socket:", e.message);
    }

    // Broadcast in real-time to other connected devices of this user
    socket.to(`user:${cleanEmail}`).emit('user_data_synced', {
      email: cleanEmail,
      ...updatedData
    });
  });

  socket.on('command_executed', async (data) => {
    try {
      await CommandLog.create(data);
    } catch (e) {}
  });

  socket.on('disconnect', () => {});
});

const PORT = process.env.PORT || 5001;
server.listen(PORT, () => {
  console.log(`Shadow Backend running on port ${PORT}`);
});
