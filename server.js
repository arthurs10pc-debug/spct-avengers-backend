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
