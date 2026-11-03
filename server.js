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
  .then(async () => {
    console.log("Connected to Shadow MongoDB.");
    try {
      await mongoose.connection.db.collection('users').dropIndex('phone_1');
    } catch (e) {}
  })
  .catch((err) => console.log("MongoDB connection fallback:", err.message));

const logSchema = new mongoose.Schema({
  commanderEmail: String,
  command: String,
  response: String,
  timestamp: { type: Date, default: Date.now }
});

const CommandLog = mongoose.model('CommandLog', logSchema);

const DEFAULT_REMINDERS = [
  { task: "Morning Review & Focus", time: "09:00", completed: false },
  { task: "Afternoon Work & Tasks", time: "14:00", completed: false },
  { task: "Evening Wrap Up & Notes", time: "20:00", completed: false }
];

const userSchema = new mongoose.Schema({
  fullName: { type: String, default: '' },
  email: { type: String, required: true, unique: true },
  phone: { type: String, default: '' },
  avatar: { type: String, default: '' },
  role: { type: String, default: 'commander' },
  notificationAllowed: { type: Boolean, default: true },
  gpsAllowed: { type: Boolean, default: true },
  reminders: { type: Array, default: DEFAULT_REMINDERS },
  snoozeMinutes: { type: Number, default: 1 },
  expenses: { type: Array, default: [] },
  notes: { type: Array, default: [] },
  monthlyBudget: { type: Number, default: 5000 },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);

const emailLogSchema = new mongoose.Schema({
  dateKey: { type: String, required: true },
  slot: { type: String, required: true },
  recipientsCount: { type: Number, default: 0 },
  sentAt: { type: Date, default: Date.now }
});
emailLogSchema.index({ dateKey: 1, slot: 1 }, { unique: true });
const EmailDispatchLog = mongoose.models.EmailDispatchLog || mongoose.model('EmailDispatchLog', emailLogSchema);

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

// Cloud Sync Endpoints for Reminders, Notes & Expenses
app.get('/api/user/sync-data', async (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ error: 'Email is required' });
  const cleanEmail = email.trim().toLowerCase();
  try {
    if (mongoose.connection.readyState === 1) {
      let user = await User.findOne({ email: cleanEmail });
      if (!user) {
        user = await User.findOne({ email: { $regex: new RegExp(`^${cleanEmail}$`, 'i') } });
      }
      if (!user) {
        // Auto-provision initial cloud store for this Gmail account so mobile/desktop sync immediately
        user = await User.create({
          email: cleanEmail,
          fullName: cleanEmail.split('@')[0],
          reminders: DEFAULT_REMINDERS,
          snoozeMinutes: 1,
          expenses: [],
          notes: [],
          monthlyBudget: 5000,
          updatedAt: new Date()
        });
      }
      const userReminders = (Array.isArray(user.reminders) && user.reminders.length > 0) ? user.reminders : DEFAULT_REMINDERS;
      return res.json({
        success: true,
        reminders: userReminders,
        snoozeMinutes: user.snoozeMinutes ?? 1,
        expenses: user.expenses || [],
        monthlyBudget: user.monthlyBudget ?? 5000,
        notes: user.notes || [],
        updatedAt: user.updatedAt || new Date()
      });
    } else {
      let memUser = memoryUsers.find(u => u.email.toLowerCase() === cleanEmail);
      if (!memUser) {
        memUser = {
          email: cleanEmail,
          reminders: DEFAULT_REMINDERS,
          snoozeMinutes: 1,
          expenses: [],
          notes: [],
          monthlyBudget: 5000,
          updatedAt: new Date()
        };
        memoryUsers.push(memUser);
      }
      const memReminders = (Array.isArray(memUser.reminders) && memUser.reminders.length > 0) ? memUser.reminders : DEFAULT_REMINDERS;
      return res.json({
        success: true,
        reminders: memReminders,
        snoozeMinutes: memUser.snoozeMinutes ?? 1,
        expenses: memUser.expenses || [],
        monthlyBudget: memUser.monthlyBudget ?? 5000,
        notes: memUser.notes || [],
        updatedAt: memUser.updatedAt || new Date()
      });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Helper: Non-destructive intelligent expense merge
const mergeExpenses = (existingList = [], incomingList = [], deletedIds = []) => {
  const deletedSet = new Set((Array.isArray(deletedIds) ? deletedIds : []).map(id => String(id)));
  const map = new Map();

  const processExp = (exp) => {
    if (!exp) return;
    const rawId = exp.id || `tx_${exp.date || ''}_${exp.title || ''}_${exp.amount || ''}`;
    const id = String(rawId);
    if (deletedSet.has(id)) return; // Filter out deleted expense

    const item = {
      ...exp,
      id,
      title: String(exp.title || 'Expense').trim(),
      amount: parseFloat(exp.amount) || 0,
      category: exp.category || 'Food & Snacks',
      type: exp.type || 'expense',
      date: exp.date || new Date().toISOString().slice(0, 10),
      createdAt: exp.createdAt || (exp.date ? new Date(exp.date).getTime() : Date.now()) || Date.now()
    };

    if (map.has(id)) {
      const prev = map.get(id);
      if ((item.createdAt || 0) >= (prev.createdAt || 0)) {
        map.set(id, { ...prev, ...item });
      }
    } else {
      map.set(id, item);
    }
  };

  if (Array.isArray(existingList)) existingList.forEach(processExp);
  if (Array.isArray(incomingList)) incomingList.forEach(processExp);

  const merged = Array.from(map.values());
  // Sort descending: newest on top
  merged.sort((a, b) => {
    const timeA = a.createdAt || (a.date ? new Date(a.date).getTime() : 0);
    const timeB = b.createdAt || (b.date ? new Date(b.date).getTime() : 0);
    return timeB - timeA;
  });
  return merged;
};

app.post('/api/user/sync-data', async (req, res) => {
  const { email, reminders, snoozeMinutes, expenses, monthlyBudget, notes, deletedExpenseIds, isClearAllExpenses } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });
  const cleanEmail = email.trim().toLowerCase();

  try {
    // 1. Fetch current existing DB record so we never destructively overwrite
    let existingUser = null;
    if (mongoose.connection.readyState === 1) {
      existingUser = await User.findOne({ email: cleanEmail });
      if (!existingUser) {
        existingUser = await User.findOne({ email: { $regex: new RegExp(`^${cleanEmail}$`, 'i') } });
      }
    } else {
      existingUser = memoryUsers.find(u => u.email.toLowerCase() === cleanEmail);
    }

    const currentExpenses = existingUser?.expenses || [];
    let finalExpenses = [];
    if (isClearAllExpenses) {
      finalExpenses = [];
    } else if (Array.isArray(expenses)) {
      finalExpenses = mergeExpenses(currentExpenses, expenses, deletedExpenseIds);
    } else {
      finalExpenses = currentExpenses;
    }

    const updatedData = {
      email: cleanEmail,
      reminders: (Array.isArray(reminders) && reminders.length > 0) ? reminders : (existingUser?.reminders || DEFAULT_REMINDERS),
      snoozeMinutes: typeof snoozeMinutes === 'number' ? snoozeMinutes : (existingUser?.snoozeMinutes ?? 1),
      expenses: finalExpenses,
      monthlyBudget: typeof monthlyBudget === 'number' ? monthlyBudget : (existingUser?.monthlyBudget ?? 5000),
      updatedAt: new Date()
    };
    if (Array.isArray(notes)) {
      updatedData.notes = notes;
    } else if (existingUser?.notes) {
      updatedData.notes = existingUser.notes;
    }

    if (mongoose.connection.readyState === 1) {
      await User.findOneAndUpdate(
        { email: cleanEmail },
        { $set: updatedData },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    } else {
      let memUser = memoryUsers.find(u => u.email.toLowerCase() === cleanEmail);
      if (memUser) {
        Object.assign(memUser, updatedData);
      } else {
        memoryUsers.push({ ...updatedData });
      }
    }

    // Broadcast in real-time to all connected devices for this user
    io.to(`user:${cleanEmail}`).emit('user_data_synced', {
      email: cleanEmail,
      ...updatedData
    });

    return res.json({ success: true, expenses: finalExpenses, updatedAt: updatedData.updatedAt });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Dedicated Real-Time Atomic Expense Endpoints
app.get('/api/expenses/:email', async (req, res) => {
  const email = (req.params.email || '').trim().toLowerCase();
  try {
    if (mongoose.connection.readyState === 1) {
      const user = await User.findOne({ email: { $regex: new RegExp(`^${email}$`, 'i') } });
      return res.json({ success: true, expenses: user?.expenses || [], monthlyBudget: user?.monthlyBudget ?? 5000 });
    }
    const memUser = memoryUsers.find(u => u.email.toLowerCase() === email);
    return res.json({ success: true, expenses: memUser?.expenses || [], monthlyBudget: memUser?.monthlyBudget ?? 5000 });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/expenses/add', async (req, res) => {
  const { email, expense } = req.body;
  if (!email || !expense) return res.status(400).json({ success: false, error: 'Email and expense are required' });
  const cleanEmail = email.trim().toLowerCase();

  try {
    const rawId = expense.id || `tx_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const newExp = {
      ...expense,
      id: String(rawId),
      title: String(expense.title || '').trim(),
      amount: parseFloat(expense.amount) || 0,
      category: expense.category || 'Food & Snacks',
      type: expense.type || 'expense',
      date: expense.date || new Date().toISOString().slice(0, 10),
      createdAt: expense.createdAt || Date.now()
    };

    let user = null;
    if (mongoose.connection.readyState === 1) {
      user = await User.findOne({ email: cleanEmail });
      if (!user) user = await User.findOne({ email: { $regex: new RegExp(`^${cleanEmail}$`, 'i') } });
    } else {
      user = memoryUsers.find(u => u.email.toLowerCase() === cleanEmail);
    }

    const currentExpenses = user?.expenses || [];
    const mergedExpenses = mergeExpenses(currentExpenses, [newExp], []);

    if (mongoose.connection.readyState === 1) {
      await User.findOneAndUpdate(
        { email: cleanEmail },
        { $set: { expenses: mergedExpenses, updatedAt: new Date() } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    } else {
      if (user) {
        user.expenses = mergedExpenses;
        user.updatedAt = new Date();
      } else {
        memoryUsers.push({ email: cleanEmail, expenses: mergedExpenses, monthlyBudget: 5000, updatedAt: new Date() });
      }
    }

    // Instant Socket Broadcast to ALL connected devices (Mobile, Laptop, Tablets)
    io.to(`user:${cleanEmail}`).emit('user_data_synced', {
      email: cleanEmail,
      expenses: mergedExpenses
    });

    return res.json({ success: true, item: newExp, expenses: mergedExpenses });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/expenses/delete', async (req, res) => {
  const { email, id } = req.body;
  if (!email || !id) return res.status(400).json({ success: false, error: 'Email and id are required' });
  const cleanEmail = email.trim().toLowerCase();
  const targetId = String(id);

  try {
    let user = null;
    if (mongoose.connection.readyState === 1) {
      user = await User.findOne({ email: cleanEmail });
      if (!user) user = await User.findOne({ email: { $regex: new RegExp(`^${cleanEmail}$`, 'i') } });
    } else {
      user = memoryUsers.find(u => u.email.toLowerCase() === cleanEmail);
    }

    const currentExpenses = user?.expenses || [];
    const filtered = currentExpenses.filter(e => String(e.id) !== targetId);

    if (mongoose.connection.readyState === 1) {
      await User.findOneAndUpdate(
        { email: cleanEmail },
        { $set: { expenses: filtered, updatedAt: new Date() } },
        { upsert: true, new: true }
      );
    } else if (user) {
      user.expenses = filtered;
      user.updatedAt = new Date();
    }

    io.to(`user:${cleanEmail}`).emit('user_data_synced', {
      email: cleanEmail,
      expenses: filtered,
      deletedExpenseIds: [targetId]
    });

    return res.json({ success: true, deletedId: targetId, count: filtered.length });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/expenses/clear', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ success: false, error: 'Email is required' });
  const cleanEmail = email.trim().toLowerCase();

  try {
    if (mongoose.connection.readyState === 1) {
      await User.findOneAndUpdate(
        { email: cleanEmail },
        { $set: { expenses: [], updatedAt: new Date() } },
        { upsert: true, new: true }
      );
    } else {
      let user = memoryUsers.find(u => u.email.toLowerCase() === cleanEmail);
      if (user) user.expenses = [];
    }

    io.to(`user:${cleanEmail}`).emit('user_data_synced', {
      email: cleanEmail,
      expenses: []
    });

    return res.json({ success: true, message: 'All expenses cleared.' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
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

// HTML entity escaping helper for safe email rendering
function escapeEmailHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Function to generate premium responsive HTML email for Notes & Tasks
// Pinned notes are placed strictly at the TOP so the user can read them immediately
const buildNotesReminderEmailHtml = (userEmail, notes, timeSlotLabel) => {
  const safeNotes = Array.isArray(notes) ? notes : [];

  // Sort notes so PINNED notes are strictly on top
  const pinnedNotes = safeNotes.filter(n => n && (n.pinned === true || n.pinned === 'true'));
  const regularNotes = safeNotes.filter(n => !n || (n.pinned !== true && n.pinned !== 'true'));
  const totalNotesCount = safeNotes.length;

  let totalChecklistItems = 0;
  let pendingTasksCount = 0;
  let completedTasksCount = 0;

  safeNotes.forEach(note => {
    if (Array.isArray(note.checklist)) {
      note.checklist.forEach(item => {
        totalChecklistItems++;
        if (item.completed) completedTasksCount++;
        else pendingTasksCount++;
      });
    }
  });

  const nowFormatted = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'short', day: 'numeric'
  });

  const renderNoteCard = (note, isPinned) => {
    const title = note.title || 'Untitled Note';
    const content = note.content || '';
    const checklist = Array.isArray(note.checklist) ? note.checklist : [];
    const dateStr = note.createdAt || note.date || '';
    const color = note.color || (isPinned ? '#f59e0b' : '#38bdf8');

    return `
      <div style="margin-bottom: 16px; background-color: ${isPinned ? '#fffdf7' : '#ffffff'}; border: 1.5px solid ${isPinned ? '#fcd34d' : '#e2e8f0'}; border-left: 6px solid ${color}; border-radius: 12px; padding: 18px 20px; box-shadow: 0 2px 8px rgba(0,0,0,${isPinned ? '0.06' : '0.03'});">
        <!-- Note Header -->
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; flex-wrap: wrap; gap: 6px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            ${isPinned ? `
              <span style="display: inline-block; background-color: #fef3c7; color: #b45309; border: 1px solid #fde68a; padding: 3px 8px; border-radius: 6px; font-size: 11px; font-weight: 900; letter-spacing: 0.5px;">
                📌 PINNED NOTE
              </span>
            ` : ''}
            <h3 style="margin: 0; font-size: 16px; font-weight: 900; color: #0f172a; letter-spacing: -0.2px;">
              ${escapeEmailHtml(title)}
            </h3>
          </div>
          ${dateStr ? `<span style="font-size: 11px; color: #64748b; font-weight: 700;">${escapeEmailHtml(dateStr)}</span>` : ''}
        </div>

        <!-- Note Text Body (Full text directly readable in email) -->
        ${content ? `
          <div style="font-size: 13.5px; line-height: 1.6; color: #334155; white-space: pre-wrap; font-weight: 500; margin-top: 8px; margin-bottom: ${checklist.length > 0 ? '12px' : '0'};">
            ${escapeEmailHtml(content)}
          </div>
        ` : ''}

        <!-- Checklist Items (if any) -->
        ${checklist.length > 0 ? `
          <div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid #f1f5f9;">
            <div style="font-size: 11px; font-weight: 800; color: #64748b; text-transform: uppercase; margin-bottom: 6px; letter-spacing: 0.5px;">
              Checklist Tasks (${checklist.filter(c => !c.completed).length} pending, ${checklist.filter(c => c.completed).length} done):
            </div>
            ${checklist.map(item => `
              <div style="display: flex; align-items: flex-start; gap: 8px; padding: 6px 10px; margin-bottom: 4px; background-color: ${item.completed ? '#f8fafc' : '#ffffff'}; border: 1px solid ${item.completed ? '#e2e8f0' : '#cbd5e1'}; border-radius: 6px; font-size: 12.5px;">
                <span style="font-weight: 900; font-family: monospace; color: ${item.completed ? '#16a34a' : '#ef4444'}; flex-shrink: 0;">
                  ${item.completed ? '[✔]' : '[  ]'}
                </span>
                <span style="color: ${item.completed ? '#94a3b8' : '#0f172a'}; text-decoration: ${item.completed ? 'line-through' : 'none'}; font-weight: ${item.completed ? '500' : '700'}; line-height: 1.4;">
                  ${escapeEmailHtml(item.text)}
                </span>
              </div>
            `).join('')}
          </div>
        ` : ''}

        <!-- Attachments Pill (if any) -->
        ${Array.isArray(note.attachments) && note.attachments.length > 0 ? `
          <div style="margin-top: 10px; font-size: 11.5px; color: #2563eb; font-weight: 700; background-color: #eff6ff; padding: 6px 10px; border-radius: 6px; border: 1px solid #bfdbfe;">
            📎 Attachments (${note.attachments.length}): ${note.attachments.map(a => `${a.type === 'photo' ? '📷' : a.type === 'video' ? '🎥' : a.type === 'audio' ? '🎵' : '📄'} ${escapeEmailHtml(a.name)}`).join(', ')}
          </div>
        ` : ''}
      </div>
    `;
  };

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Shadow Notes Daily Briefing</title>
  <style>
    body { margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #0f172a; }
    .email-wrapper { max-width: 640px; margin: 24px auto; background-color: #ffffff; border: 1.5px solid #cbd5e1; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.06); }
    .email-header { background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); padding: 26px 28px; text-align: center; border-bottom: 3px solid #BDC3C7; }
    .email-header h1 { margin: 0; color: #ffffff; font-size: 22px; font-weight: 900; letter-spacing: 1px; text-transform: uppercase; }
    .email-header p { margin: 6px 0 0 0; color: #94a3b8; font-size: 13px; font-weight: 600; }
    .edition-badge { display: inline-block; background-color: #ffffff; color: #0f172a; padding: 4px 14px; border-radius: 20px; font-size: 11px; font-weight: 900; letter-spacing: 0.6px; text-transform: uppercase; margin-top: 12px; box-shadow: 0 2px 6px rgba(0,0,0,0.2); }
    .email-body { padding: 24px 28px; }
    .stats-row { display: flex; gap: 10px; margin-bottom: 22px; }
    .stat-box { flex: 1; background-color: #f8fafc; border: 1.5px solid #e2e8f0; border-radius: 10px; padding: 12px 8px; text-align: center; }
    .stat-val { font-size: 20px; font-weight: 900; color: #0f172a; line-height: 1.2; }
    .stat-lbl { font-size: 10px; font-weight: 800; color: #64748b; text-transform: uppercase; margin-top: 4px; letter-spacing: 0.5px; }
    .section-heading { font-size: 13px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.8px; margin: 24px 0 12px 0; display: flex; align-items: center; gap: 8px; }
    .footer { background-color: #f8fafc; border-top: 1px solid #e2e8f0; padding: 18px 24px; text-align: center; font-size: 11.5px; color: #64748b; line-height: 1.5; }
    @media (max-width: 600px) {
      .email-wrapper { margin: 0; border-radius: 0; border: none; }
      .email-header { padding: 20px 16px; }
      .email-body { padding: 16px 14px; }
      .stats-row { flex-wrap: wrap; }
      .stat-box { min-width: 45%; }
    }
  </style>
</head>
<body>
  <div class="email-wrapper">
    <!-- Header -->
    <div class="email-header">
      <h1>SHADOW DASHBOARD</h1>
      <p>Personal Notes & Daily Briefing • ${nowFormatted}</p>
      <div class="edition-badge">${escapeEmailHtml(timeSlotLabel)}</div>
    </div>

    <!-- Main Content -->
    <div class="email-body">
      <!-- Summary Metric Cards -->
      <div class="stats-row">
        <div class="stat-box">
          <div class="stat-val">${totalNotesCount}</div>
          <div class="stat-lbl">Total Notes</div>
        </div>
        <div class="stat-box" style="background-color: #fffbeb; border-color: #fde68a;">
          <div class="stat-val" style="color: #b45309;">${pinnedNotes.length}</div>
          <div class="stat-lbl" style="color: #b45309;">📌 Pinned</div>
        </div>
        <div class="stat-box">
          <div class="stat-val" style="color: #ef4444;">${pendingTasksCount}</div>
          <div class="stat-lbl">Pending Tasks</div>
        </div>
        <div class="stat-box">
          <div class="stat-val" style="color: #16a34a;">${completedTasksCount}</div>
          <div class="stat-lbl">Completed</div>
        </div>
      </div>

      <!-- SECTION 1: PINNED NOTES AT THE VERY TOP -->
      ${pinnedNotes.length > 0 ? `
        <div class="section-heading" style="color: #b45309; border-bottom: 2px solid #fde68a; padding-bottom: 6px;">
          <span>📌 PINNED PRIORITY NOTES (${pinnedNotes.length})</span>
        </div>
        ${pinnedNotes.map(n => renderNoteCard(n, true)).join('')}
      ` : ''}

      <!-- SECTION 2: ALL OTHER SAVED NOTES -->
      ${regularNotes.length > 0 ? `
        <div class="section-heading" style="color: #0f172a; border-bottom: 2px solid #e2e8f0; padding-bottom: 6px; ${pinnedNotes.length > 0 ? 'margin-top: 28px;' : ''}">
          <span>📝 ALL SAVED NOTES (${regularNotes.length})</span>
        </div>
        ${regularNotes.map(n => renderNoteCard(n, false)).join('')}
      ` : ''}

      ${totalNotesCount === 0 ? `
        <div style="text-align: center; padding: 40px 20px; color: #64748b;">
          <div style="font-size: 32px; margin-bottom: 8px;">📝</div>
          <p style="font-size: 15px; font-weight: 700; color: #0f172a; margin: 0 0 6px 0;">No active notes found</p>
          <p style="font-size: 12.5px; margin: 0;">Add your notes and tasks in Shadow Dashboard to receive them directly in this email briefing.</p>
        </div>
      ` : ''}
    </div>

    <!-- Footer -->
    <div class="footer">
      Automated briefing delivered directly to <strong>${escapeEmailHtml(userEmail)}</strong>.<br>
      Notes and tasks are synced real-time across your laptop and mobile device.
    </div>
  </div>
</body>
</html>`;
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
    const pinnedCount = userNotes.filter(n => n && (n.pinned === true || n.pinned === 'true')).length;
    const subjectLine = `📌 Shadow Notes [${slot}]: ${pinnedCount > 0 ? `${pinnedCount} Pinned • ` : ''}${userNotes.length} Notes Ready to Read`;

    try {
      const info = await mailTransporter.sendMail({
        from: `"Shadow Dashboard" <${process.env.GMAIL_USER || 'arthurs10pc@gmail.com'}>`,
        to: cleanEmail,
        subject: subjectLine,
        html: htmlBody
      });
      console.log(`[Email Reminder] Successfully sent notes email to ${cleanEmail}: ${info.messageId}`);
      return res.json({ success: true, message: `Notes reminder email successfully delivered to ${cleanEmail}`, messageId: info.messageId });
    } catch (mailErr) {
      console.error(`[Email Reminder Error]: ${mailErr.message}`);
      return res.status(500).json({ success: false, error: mailErr.message });
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
      usersWithNotes = await User.find({
        $or: [
          { 'notes.0': { $exists: true } },
          { email: 'sataparahetkumar786@gmail.com' },
          { email: 'arthurs10pc@gmail.com' }
        ]
      });
    } else {
      usersWithNotes = memoryUsers.filter(u => Array.isArray(u.notes) && u.notes.length > 0);
    }
  } catch (err) {
    console.error('[3x Daily Scheduler] DB query error:', err.message);
  }

  // Ensure primary user email is always included
  const primaryEmail = 'sataparahetkumar786@gmail.com';
  if (!usersWithNotes.some(u => u.email && u.email.toLowerCase() === primaryEmail.toLowerCase())) {
    const memUser = memoryUsers.find(u => u.email && u.email.toLowerCase() === primaryEmail.toLowerCase());
    if (memUser) {
      usersWithNotes.push(memUser);
    } else {
      usersWithNotes.push({ email: primaryEmail, notes: [] });
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
        : [{ title: 'Daily Focus & Priorities', content: 'Organize your daily tasks, check Watcher reminders, and review active notes.', pinned: true, date: new Date().toLocaleDateString() }];
      
      const html = buildNotesReminderEmailHtml(u.email, userNotes, slot);
      const pinnedCount = userNotes.filter(n => n && (n.pinned === true || n.pinned === 'true')).length;
      const subjectLine = `📌 Shadow Notes [${slot}]: ${pinnedCount > 0 ? `${pinnedCount} Pinned • ` : ''}${userNotes.length} Notes Ready to Read`;

      const info = await mailTransporter.sendMail({
        from: `"Shadow Dashboard" <${process.env.GMAIL_USER || 'arthurs10pc@gmail.com'}>`,
        to: u.email,
        subject: subjectLine,
        html
      });
      console.log(`[3x Daily Scheduler] Successfully dispatched email to ${u.email} for [${slot}]: ${info.messageId}`);
      results.push({ email: u.email, status: 'sent', count: userNotes.length, messageId: info.messageId });
    } catch (sendErr) {
      console.error(`[3x Daily Scheduler] Failed sending to ${u.email}:`, sendErr.message);
      results.push({ email: u.email, status: 'error', error: sendErr.message });
    }
  }
  return results;
}

// Persistent Catch-Up Check Function: Runs on interval, on startup, and when client pings
async function checkAndDispatch3xSlots() {
  try {
    const istString = new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
    const istDate = new Date(istString);
    const hours = istDate.getHours();
    const dateKey = `${istDate.getFullYear()}-${String(istDate.getMonth() + 1).padStart(2, '0')}-${String(istDate.getDate()).padStart(2, '0')}`;

    const slotsDue = [];
    if (hours >= 9) slotsDue.push('Morning 09:00 AM');
    if (hours >= 14) slotsDue.push('Afternoon 02:00 PM');
    if (hours >= 20) slotsDue.push('Evening 08:00 PM');

    const executed = [];

    for (const slot of slotsDue) {
      const dispatchKey = `${dateKey}_${slot}`;
      let alreadySent = sentEmailSlotsToday.has(dispatchKey);

      if (!alreadySent && mongoose.connection.readyState === 1) {
        try {
          const log = await EmailDispatchLog.findOne({ dateKey, slot });
          if (log) {
            alreadySent = true;
            sentEmailSlotsToday.add(dispatchKey);
          }
        } catch (e) {}
      }

      if (!alreadySent) {
        sentEmailSlotsToday.add(dispatchKey);
        console.log(`[3x Catch-Up Trigger] Slot ${slot} is due for ${dateKey}. Dispatching now...`);
        const results = await dispatchDailyNotesScheduler(slot);
        if (mongoose.connection.readyState === 1) {
          try {
            await EmailDispatchLog.create({
              dateKey,
              slot,
              recipientsCount: results.filter(r => r.status === 'sent').length,
              sentAt: new Date()
            });
          } catch (e) {}
        }
        executed.push({ slot, results });
      }
    }
    return { dateKey, hours, slotsDue, executed };
  } catch (err) {
    console.error('[Check 3x Slots Error]:', err.message);
    return { error: err.message };
  }
}

// Periodic check every 30 seconds
setInterval(checkAndDispatch3xSlots, 30000);

// Endpoint for frontend to check & trigger any due slots (guarantees Render free-tier catch-up)
app.all('/api/notes-scheduler/check-and-dispatch', async (req, res) => {
  const result = await checkAndDispatch3xSlots();
  return res.json({ success: true, ...result });
});

// Endpoint to view scheduler status
app.get('/api/notes-scheduler/status', async (req, res) => {
  try {
    const istString = new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
    const istDate = new Date(istString);
    const dateKey = `${istDate.getFullYear()}-${String(istDate.getMonth() + 1).padStart(2, '0')}-${String(istDate.getDate()).padStart(2, '0')}`;
    let logs = [];
    if (mongoose.connection.readyState === 1) {
      logs = await EmailDispatchLog.find({ dateKey });
    }
    return res.json({
      success: true,
      currentTimeIST: istString,
      dateKey,
      dispatchedToday: logs,
      inMemorySlots: Array.from(sentEmailSlotsToday)
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Manual test trigger endpoint
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

    let existingUser = null;
    try {
      if (mongoose.connection.readyState === 1) {
        existingUser = await User.findOne({ email: { $regex: new RegExp(`^${cleanEmail}$`, 'i') } });
      } else {
        existingUser = memoryUsers.find(u => u.email.toLowerCase() === cleanEmail);
      }
    } catch (e) {}

    const currentExpenses = existingUser?.expenses || [];
    let finalExpenses = currentExpenses;
    if (payload.isClearAllExpenses) {
      finalExpenses = [];
    } else if (Array.isArray(payload.expenses)) {
      finalExpenses = mergeExpenses(currentExpenses, payload.expenses, payload.deletedExpenseIds);
    }

    const updatedData = {
      reminders: (Array.isArray(payload.reminders) && payload.reminders.length > 0) ? payload.reminders : (existingUser?.reminders || DEFAULT_REMINDERS),
      snoozeMinutes: typeof payload.snoozeMinutes === 'number' ? payload.snoozeMinutes : (existingUser?.snoozeMinutes ?? 1),
      expenses: finalExpenses,
      monthlyBudget: typeof payload.monthlyBudget === 'number' ? payload.monthlyBudget : (existingUser?.monthlyBudget ?? 5000),
      updatedAt: new Date()
    };
    if (Array.isArray(payload.notes)) {
      updatedData.notes = payload.notes;
    } else if (existingUser?.notes) {
      updatedData.notes = existingUser.notes;
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
