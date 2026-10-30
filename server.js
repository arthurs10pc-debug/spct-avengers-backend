require('dotenv').config();
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
  const { email, reminders, snoozeMinutes, expenses, monthlyBudget } = req.body;
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

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Lone Wolf AI Backend running on port ${PORT}`);
});
