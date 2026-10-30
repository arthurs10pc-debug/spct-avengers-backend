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
  .then(() => console.log("Connected to Lone Wolf MongoDB."))
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
  res.send("Lone Wolf AI Assistant Backend Online.");
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
        <h1>SPCT LONE WOLF JARVIS</h1>
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
          <p style="text-align:center; color:#94a3b8; padding:30px 0;">No active notes found. Add your tasks and notes in SPCT Lone Wolf to receive reminders.</p>
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
  const { email, slotLabel } = req.body;
  if (!email) return res.status(400).json({ success: false, error: 'Email is required' });
  const cleanEmail = email.trim().toLowerCase();

  try {
    let userNotes = [];
    if (mongoose.connection.readyState === 1) {
      const user = await User.findOne({ email: { $regex: new RegExp(`^${cleanEmail}$`, 'i') } });
      userNotes = user?.notes || [];
    } else {
      const memUser = memoryUsers.find(u => u.email.toLowerCase() === cleanEmail);
      userNotes = memUser?.notes || [];
    }

    const slot = slotLabel || 'Daily Tasks';
    const htmlBody = buildNotesReminderEmailHtml(cleanEmail, userNotes, slot);

    await mailTransporter.sendMail({
      from: `"SPCT Lone Wolf Jarvis" <${process.env.GMAIL_USER || 'arthurs10pc@gmail.com'}>`,
      to: cleanEmail,
      subject: `Lone Wolf Notes Reminder: ${userNotes.length} Notes & Tasks [${slot}]`,
      html: htmlBody
    });

    console.log(`[Email Reminder] Successfully sent notes email to ${cleanEmail}`);
    return res.json({ success: true, message: `Notes reminder email successfully delivered to ${cleanEmail}` });
  } catch (err) {
    console.error("[Email Reminder Error]:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Automated 3-Times-A-Day Email Scheduler (Morning 09:00 AM, Afternoon 02:00 PM, Evening 08:00 PM)
const sentEmailSlotsToday = new Set();
setInterval(async () => {
  try {
    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();
    const dateKey = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;

    let slot = null;
    if (hours === 9 && minutes === 0) slot = 'Morning 09:00 AM';
    else if (hours === 14 && minutes === 0) slot = 'Afternoon 02:00 PM';
    else if (hours === 20 && minutes === 0) slot = 'Evening 08:00 PM';

    if (!slot) return;

    const dispatchKey = `${dateKey}_${slot}`;
    if (sentEmailSlotsToday.has(dispatchKey)) return;
    sentEmailSlotsToday.add(dispatchKey);

    console.log(`[3x Daily Scheduler] Firing automated notes reminder for slot: ${slot}`);

    let usersWithNotes = [];
    if (mongoose.connection.readyState === 1) {
      usersWithNotes = await User.find({ 'notes.0': { $exists: true } });
    } else {
      usersWithNotes = memoryUsers.filter(u => Array.isArray(u.notes) && u.notes.length > 0);
    }

    for (const u of usersWithNotes) {
      if (!u.email) continue;
      try {
        const html = buildNotesReminderEmailHtml(u.email, u.notes, slot);
        await mailTransporter.sendMail({
          from: `"SPCT Lone Wolf Jarvis" <${process.env.GMAIL_USER || 'arthurs10pc@gmail.com'}>`,
          to: u.email,
          subject: `Lone Wolf Notes Reminder: ${u.notes.length} Notes & Tasks [${slot}]`,
          html
        });
        console.log(`[3x Daily Scheduler] Dispatched email to ${u.email}`);
      } catch (sendErr) {
        console.error(`[3x Daily Scheduler] Failed sending to ${u.email}:`, sendErr.message);
      }
    }
  } catch (e) {
    console.error("[Scheduler Error]:", e.message);
  }
}, 60000);

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
  console.log(`Lone Wolf AI Backend running on port ${PORT}`);
});
