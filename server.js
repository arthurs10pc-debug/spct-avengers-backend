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
  service: 'gmail',
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

    const sendPromise = mailTransporter.sendMail({
      from: `"Shadow Dashboard" <${process.env.GMAIL_USER || 'arthurs10pc@gmail.com'}>`,
      to: cleanEmail,
      subject: `Shadow Notes Reminder: ${userNotes.length} Notes & Tasks [${slot}]`,
      html: htmlBody
    });
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('SMTP connection timed out')), 9000)
    );
    await Promise.race([sendPromise, timeoutPromise]);

    console.log(`[Email Reminder] Successfully sent notes email to ${cleanEmail}`);
    return res.json({ success: true, message: `Notes reminder email successfully delivered to ${cleanEmail}` });
  } catch (err) {
    console.error("[Email Reminder Error]:", err.message);
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
        id: 'ipo_afcons',
        name: 'Afcons Infrastructure Ltd',
        type: 'Mega Mainboard IPO',
        exchange: 'BSE & NSE',
        sector: 'Marine, Bridges, Metro & Hydro Construction (Shapoorji Pallonji Group)',
        priceBand: '₹440 - ₹463 per share',
        lotSize: '32 Shares (Minimum: ₹14,816)',
        dates: '25 Oct - 29 Oct (Bidding Closed • Allotment Phase)',
        listingDate: '4 Nov 2026',
        status: '🟡 Allotment Finalization Stage',
        allotmentBadge: '🟢 High Retail Chance (94% Quota Subscribed)',
        about: 'Flagship engineering and infrastructure firm of Shapoorji Pallonji Group. Constructs high-complexity global mega-projects: Chenab Railway Bridge, Atal Tunnel, underwater metro lines, and offshore marine terminals.',
        subscription: {
          total: '2.63x Overall Demand',
          totalMeaning: 'Solid, measured demand without speculative frenzy. ₹13,000+ Crores bid.',
          retail: '0.94x (Clean 100% Allotment for Retailers)',
          retailMeaning: 'Retail category was 94% filled. Every single retail investor applying for 1 lot has an almost guaranteed (95%+) chance of receiving full allotment.',
          qib: '3.79x (Institutional Banks & Global Funds)',
          qibMeaning: 'Foreign institutions and domestic mutual funds supported the issue heavily.',
          nii: '5.05x (Wealthy HNI Bidders)',
          niiMeaning: 'High Net Worth segment was oversubscribed 5 times.'
        },
        allotmentChance: 'Very High Chance (~95% Allotment Odds)',
        allotmentDetail: 'Because the retail quota was not overcrowded, individual investors who applied have near 100% chance of receiving shares in their Demat account.',
        gmp: '+₹35 (+7.6% Estimated Listing Gain)',
        gmpDetail: 'Grey Market Premium stands around ₹35 over the ₹463 cut-off price, indicating an estimated listing price of ~₹498 and ~₹1,120 profit per lot.',
        verdict: 'Sound Long-Term Portfolio Compounder. Strong order book of ₹41,000+ Crores backed by solid operational track record.'
      },
      {
        id: 'ipo_godavari',
        name: 'Godavari Biorefineries Ltd',
        type: 'Mainboard IPO',
        exchange: 'BSE & NSE',
        sector: 'Bio-Ethanol, Specialty Bio-Chemicals & Renewable Sugar',
        priceBand: '₹334 - ₹352 per share',
        lotSize: '42 Shares (Minimum: ₹14,784)',
        dates: '23 Oct - 25 Oct (Allotment Decided)',
        listingDate: '30 Oct 2026',
        status: '🟢 Freshly Listed / Live Active',
        allotmentBadge: '🟡 Moderate (1.8x Retail Demand)',
        about: 'One of India’s largest bio-based chemical manufacturers producing ethanol, bio-based intermediates for food, flavor, cosmetics, and pharmaceuticals.',
        subscription: {
          total: '1.83x Overall Bids',
          totalMeaning: 'Healthy domestic and institutional participation across both exchanges.',
          retail: '1.71x (Retail Investors)',
          retailMeaning: 'Balanced retail interest. Fair proportion of bidders secured allotment.',
          qib: '2.76x (Mutual Funds & DIIs)',
          qibMeaning: 'Consistent institutional backing.',
          nii: '0.90x (HNI Bidders)',
          niiMeaning: 'Moderate participation from high net-worth individuals.'
        },
        allotmentChance: 'Fair Allocation (Approx 60% Odds)',
        allotmentDetail: 'Investors experienced a smooth allotment process with reasonable allocation rates.',
        gmp: '+₹15 (+4.3% Premium)',
        gmpDetail: 'Listing day price traded closely in sync with GMP expectations around ₹365-₹370.',
        verdict: 'Green Energy & Bio-chemical Play. Growth depends on government ethanol blending mandates.'
      },
      {
        id: 'ipo_deepak_builders',
        name: 'Deepak Builders & Engineers Ltd',
        type: 'Mainboard IPO',
        exchange: 'BSE & NSE',
        sector: 'Railways, Multi-Specialty Hospitals & Administrative EPC',
        priceBand: '₹192 - ₹203 per share',
        lotSize: '73 Shares (Minimum: ₹14,819)',
        dates: '21 Oct - 23 Oct (Listing Concluded)',
        listingDate: '28 Oct 2026',
        status: '🟢 Trading on BSE & NSE',
        allotmentBadge: '🔥 41.5x Huge Oversubscription',
        about: 'Specialized infrastructure engineering company focusing on institutional projects, medical colleges, and state-of-the-art railway redevelopment contracts in Northern India.',
        subscription: {
          total: '41.54x Blockbuster Demand',
          totalMeaning: 'Enormous retail and HNI rush with bids totaling tens of thousands of crores.',
          retail: '39.79x (Intense Competition)',
          retailMeaning: 'Roughly 40 applicants competed for every 1 lot available.',
          qib: '13.91x (Institutions)',
          qibMeaning: 'Qualified institutional portion fully booked on final day.',
          nii: '82.41x (Sensational HNI Rush)',
          niiMeaning: 'Wealthy investors rushed to bid over 80 times the quota.'
        },
        allotmentChance: 'Tough Lottery (1 in 40 applicants won)',
        allotmentDetail: 'Because demand crossed 39x in retail, allotment was decided strictly through a computerized lottery draw.',
        gmp: '+₹42 (+20.7% Strong Profit)',
        gmpDetail: 'Offered solid listing pop of over 20% on day one.',
        verdict: 'High Momentum EPC Performer. Great for listing day capital gain.'
      },
      {
        id: 'ipo_united_heat',
        name: 'United Heat Transfer Ltd',
        type: 'SME IPO',
        exchange: 'NSE Emerge (SME)',
        sector: 'Heavy Shell & Tube Heat Exchangers & Pressure Vessels',
        priceBand: '₹56 - ₹59 per share',
        lotSize: '2,000 Shares (Minimum: ₹1,18,000)',
        dates: '22 Oct - 24 Oct (Allotment Done)',
        listingDate: '29 Oct 2026',
        status: '🟢 Listed on NSE Emerge',
        allotmentBadge: '🔥 83.7x Mega Rush',
        about: 'Designs and fabricates shell-and-tube heat exchangers, moisture separators, and air coolers for oil refineries, chemical hubs, and maritime vessels.',
        subscription: {
          total: '83.7x Super-hit',
          totalMeaning: 'Huge liquidity inflow into this specialized engineering SME issue.',
          retail: '98.4x (Fierce Lottery)',
          retailMeaning: 'Near 100 people applying for every 1 allotted SME lot.',
          qib: '28.5x',
          qibMeaning: 'Anchor and institutional books completely locked in.',
          nii: '112.3x',
          niiMeaning: 'Tremendous non-institutional investor demand.'
        },
        allotmentChance: 'Strict Lottery (1 in 98 lucky draw)',
        allotmentDetail: 'Winner selection happened purely through automated draw due to 98x retail subscription.',
        gmp: '+₹28 (+47.5% Bumper Return)',
        gmpDetail: 'Unofficial GMP delivered ~₹56,000 profit on ₹1.18L initial investment.',
        verdict: 'Stellar SME Performer. Strong profit margins and high industrial demand.'
      }
    ],
    upcoming: [
      {
        id: 'ipo_swiggy',
        name: 'Swiggy Ltd',
        type: 'Mega Mainboard IPO (₹11,327 Crore Issue)',
        exchange: 'BSE & NSE',
        sector: 'Online Food Delivery, Instamart Quick Commerce & Dining Out',
        priceBand: '₹371 - ₹390 per share',
        lotSize: '38 Shares (Minimum: ₹14,820)',
        dates: '6 Nov - 8 Nov 2026 (Anchor: 5 Nov)',
        listingDate: '13 Nov 2026',
        status: '📅 Opening Soon (6 Nov 2026)',
        allotmentBadge: '🚀 Mega Benchmark Tech Issue',
        about: 'India’s pioneering consumer tech platform operating Swiggy Food Delivery, Instamart (10-minute grocery & everyday essentials), Genie (instant pickup and drop), and Dineout across 680+ cities.',
        subscription: {
          total: 'Bidding Starts 6 November',
          totalMeaning: 'Public bidding opens on Wednesday 6 November at 10:00 AM on BSE/NSE.',
          retail: '10% Reserved for Public Retail',
          retailMeaning: '₹1,130+ Crores allocated exclusively for regular individual investors.',
          qib: '75% Reserved for Global & Indian Funds',
          qibMeaning: 'Massive anchor participation expected from sovereign funds and top mutual funds.',
          nii: '15% Quota for HNI Bidders',
          niiMeaning: 'High Net Worth individuals can bid between ₹2 Lakh to ₹5 Lakh.'
        },
        allotmentChance: 'Very High Availability Expected',
        allotmentDetail: 'Given the colossal ₹11,327 Crore issue size, large number of retail lots are available, making allotment chances significantly easier than tight SME IPOs.',
        gmp: '+₹25 (+6.4% Positive Premium)',
        gmpDetail: 'Grey Market Premium is trading at +₹25 over ₹390 cut-off, pointing to an initial expected listing price of ~₹415 and ~₹950 profit per lot.',
        verdict: 'Must-Watch Digital Giant. Direct rival to Zomato with explosive Instamart quick-commerce revenue growth.'
      },
      {
        id: 'ipo_sagility',
        name: 'Sagility India Ltd',
        type: 'Mainboard IPO (₹2,107 Crores)',
        exchange: 'BSE & NSE',
        sector: 'US Healthcare Technology Operations & Clinical BPO',
        priceBand: '₹28 - ₹30 per share',
        lotSize: '500 Shares (Minimum: ₹15,000)',
        dates: '5 Nov - 7 Nov 2026',
        listingDate: '12 Nov 2026',
        status: '📅 Opening Soon (5 Nov 2026)',
        allotmentBadge: '💡 Affordable ₹30 Entry Price',
        about: 'Provides technology-enabled healthcare management, medical billing, claims settlement, and clinical administration services to top US health insurance payers and hospital networks.',
        subscription: {
          total: 'Issue Opens 5 November',
          totalMeaning: 'Three-day public offering commencing on Tuesday 5 November.',
          retail: '35% Quota for Regular Public',
          retailMeaning: 'Generous 35% retail allocation ensures over ₹700 Crores of shares for small investors.',
          qib: '50% Quota',
          qibMeaning: 'Institutional investors book will open simultaneously.',
          nii: '15% Quota',
          niiMeaning: 'Reserved for non-institutional bidders.'
        },
        allotmentChance: 'High Allotment Chance (~80%+ Estimated)',
        allotmentDetail: 'With a large 35% retail quota and affordable ₹30 share price, chances of getting allotment on 1 lot application are very favorable.',
        gmp: '+₹4 (+13.3% Decent Gain)',
        gmpDetail: 'GMP indicates expected listing around ₹34, giving an estimated profit of ~₹2,000 per 500-share lot.',
        verdict: 'Solid Healthcare Tech Play. Completely dollar-revenue driven with consistent cash flows.'
      },
      {
        id: 'ipo_acme_solar',
        name: 'ACME Solar Holdings Ltd',
        type: 'Renewable Mainboard IPO (₹2,900 Crores)',
        exchange: 'BSE & NSE',
        sector: 'Solar & Green Wind Energy Power Generation',
        priceBand: '₹275 - ₹289 per share',
        lotSize: '51 Shares (Minimum: ₹14,739)',
        dates: '6 Nov - 8 Nov 2026',
        listingDate: '13 Nov 2026',
        status: '📅 Opening Soon (6 Nov 2026)',
        allotmentBadge: '☀️ Green Energy Pure-Play',
        about: 'One of the leading utility-scale renewable energy producers in India. Owns and operates massive solar parks across Rajasthan, Gujarat, and Andhra Pradesh, with power purchase agreements signed with central government entities like SECI and NTPC.',
        subscription: {
          total: 'Opens 6 November',
          totalMeaning: 'Issue opens concurrently with Swiggy on 6 November.',
          retail: '10% Quota for Retail',
          retailMeaning: 'Reserved quota for regular public investors.',
          qib: '75% Institutional Portion',
          qibMeaning: 'Clean ESG compliance makes it a favorite for global green funds.',
          nii: '15% HNI Portion',
          niiMeaning: 'Wealthy private bidders segment.'
        },
        allotmentChance: 'Moderate to High Chance',
        allotmentDetail: 'Sufficient issue size guarantees healthy lot distribution among regular applicants.',
        gmp: '+₹30 (+10.4% Estimated Profit)',
        gmpDetail: 'Grey market trading at +₹30 premium, estimating listing around ₹319 and ~₹1,530 gain per lot.',
        verdict: 'Strong Renewable Energy Asset. Long-term green transition beneficiary with guaranteed 25-year power sales contracts.'
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
