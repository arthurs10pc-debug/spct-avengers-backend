require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');
const webpush = require('web-push');

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

const publicVapidKey = process.env.VAPID_PUBLIC_KEY || 'BNp5iirw54SBOS_8VOAKw7gpSzvkktgKWNzq_mDeAztqClikXufNCdCHk_vvB7cSD-djbSQXosHRzEtMERwEQhQ';
const privateVapidKey = process.env.VAPID_PRIVATE_KEY || '4hYeB-lD8KFZObFS-3p75qjrQbGu4hv-clq_jpLmRCY';

try {
  webpush.setVapidDetails('mailto:admin@spctavengers.com', publicVapidKey, privateVapidKey);
} catch (e) {}

const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://het:het123@cluster0.mongodb.net/spct_avengers?retryWrites=true&w=majority";

mongoose.connect(MONGO_URI)
  .then(() => console.log("Connected to MongoDB successfully."))
  .catch((err) => console.log("MongoDB connection fallback to memory:", err.message));

const rideSchema = new mongoose.Schema({
  creatorId: String,
  creatorName: String,
  creatorPhone: String,
  creatorRole: String,
  fromLocation: String,
  toLocation: String,
  status: { type: String, default: 'waiting' },
  acceptedBy: { name: String, phone: String, role: String },
  createdAt: { type: Date, default: Date.now }
});

const userSchema = new mongoose.Schema({
  fullName: String,
  email: { type: String, unique: true },
  phone: { type: String, unique: true, sparse: true },
  avatar: String,
  role: String,
  notificationAllowed: { type: Boolean, default: true },
  gpsAllowed: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});

const subscriptionSchema = new mongoose.Schema({
  endpoint: { type: String, unique: true },
  keys: { p256dh: String, auth: String }
});

const Ride = mongoose.model('Ride', rideSchema);
const User = mongoose.model('User', userSchema);
const PushSubscription = mongoose.model('PushSubscription', subscriptionSchema);

const memoryRides = [];
const memoryUsers = [];
const memorySubscriptions = [];

app.post('/api/save-subscription', async (req, res) => {
  const subscription = req.body;
  if (!subscription || !subscription.endpoint) return res.status(400).json({ error: 'Invalid' });
  try {
    if (mongoose.connection.readyState === 1) {
      await PushSubscription.findOneAndUpdate({ endpoint: subscription.endpoint }, subscription, { upsert: true, new: true });
    } else {
      if (!memorySubscriptions.some(s => s.endpoint === subscription.endpoint)) memorySubscriptions.push(subscription);
    }
    res.status(201).json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/report-permission', async (req, res) => {
  const { userId, notificationAllowed, gpsAllowed } = req.body;
  try {
    if (mongoose.connection.readyState === 1 && userId) {
      await User.findByIdAndUpdate(userId, { notificationAllowed, gpsAllowed });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/rides', async (req, res) => {
  try {
    if (mongoose.connection.readyState === 1) {
      const rides = await Ride.find().sort({ createdAt: -1 }).lean();
      res.json(rides);
    } else {
      res.json(memoryRides.slice().reverse());
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/rides/:id', async (req, res) => {
  const { id } = req.params;
  try {
    if (mongoose.connection.readyState === 1) {
      await Ride.findByIdAndDelete(id);
    } else {
      const idx = memoryRides.findIndex(r => r._id === id);
      if (idx !== -1) memoryRides.splice(idx, 1);
    }
    io.emit('ride_deleted_broadcast', id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/rides/clear-all', async (req, res) => {
  try {
    if (mongoose.connection.readyState === 1) {
      await Ride.deleteMany({});
    } else {
      memoryRides.length = 0;
    }
    io.emit('all_rides_cleared');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/users', async (req, res) => {
  try {
    if (mongoose.connection.readyState === 1) {
      const users = await User.find().lean();
      res.json(users);
    } else {
      res.json(memoryUsers);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/export-db', async (req, res) => {
  try {
    let users = [];
    let rides = [];
    let subscriptions = [];
    if (mongoose.connection.readyState === 1) {
      users = await User.find().lean();
      rides = await Ride.find().lean();
      subscriptions = await PushSubscription.find().lean();
    } else {
      users = memoryUsers;
      rides = memoryRides;
      subscriptions = memorySubscriptions;
    }
    res.json({ exportTimestamp: new Date(), totalUsers: users.length, totalRides: rides.length, users, rides, subscriptions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/clear-full-db', async (req, res) => {
  try {
    if (mongoose.connection.readyState === 1) {
      await User.deleteMany({ email: { $ne: "arthurs10pc@gmail.com" } });
      await Ride.deleteMany({});
      await PushSubscription.deleteMany({});
    } else {
      for (let i = memoryUsers.length - 1; i >= 0; i--) {
        if (memoryUsers[i].email !== "arthurs10pc@gmail.com") {
          memoryUsers.splice(i, 1);
        }
      }
      memoryRides.length = 0;
      memorySubscriptions.length = 0;
    }
    io.emit('db_cleared_broadcast');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/users/:id', async (req, res) => {
  const { id } = req.params;
  try {
    if (mongoose.connection.readyState === 1) {
      await User.findByIdAndDelete(id);
    } else {
      const idx = memoryUsers.findIndex(u => u._id === id);
      if (idx !== -1) memoryUsers.splice(idx, 1);
    }
    io.emit('user_deleted_broadcast', id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/google-login', async (req, res) => {
  const { fullName, email, avatar, phone, role, mode } = req.body;
  try {
    let user = null;
    if (mongoose.connection.readyState === 1) {
      user = await User.findOne({ email });
      if (!user && mode === 'signup') {
        if (phone) {
          const phoneExists = await User.findOne({ phone });
          if (phoneExists) {
            return res.status(400).json({ success: false, error: 'This mobile number is already registered with another account.' });
          }
        }
        user = await User.create({ fullName, email, avatar, phone: phone || '', role, notificationAllowed: true, gpsAllowed: true });
      } else if (user) {
        if (phone && phone !== user.phone) {
          const phoneExists = await User.findOne({ phone });
          if (phoneExists && phoneExists._id.toString() !== user._id.toString()) {
            return res.status(400).json({ success: false, error: 'This mobile number is already registered with another account.' });
          }
          user.phone = phone;
        }
        if (role) user.role = role;
        if (fullName) user.fullName = fullName;
        if (avatar) user.avatar = avatar;
        await user.save();
      }
    } else {
      user = memoryUsers.find(u => u.email === email);
      if (!user && mode === 'signup') {
        if (phone && memoryUsers.some(u => u.phone === phone)) {
          return res.status(400).json({ success: false, error: 'This mobile number is already registered with another account.' });
        }
        user = { _id: 'usr_' + Date.now(), fullName, email, avatar, phone: phone || '', role, notificationAllowed: true, gpsAllowed: true };
        memoryUsers.push(user);
      } else if (user) {
        if (phone) user.phone = phone;
        if (role) user.role = role;
      }
    }
    if (!user) return res.status(400).json({ success: false, error: 'User not found' });
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

const liveRidersMap = new Map();

io.on('connection', (socket) => {
  socket.on('update_rider_gps', (data) => {
    if (data && data.userId) {
      liveRidersMap.set(data.userId, { ...data, socketId: socket.id, lastUpdated: Date.now() });
      io.emit('nearby_riders_update', Array.from(liveRidersMap.values()));
    }
  });

  socket.on('request_riders_refresh', () => {
    io.emit('nearby_riders_update', Array.from(liveRidersMap.values()));
  });

  socket.on('post_ride', async (payload) => {
    const newRideData = {
      _id: new mongoose.Types.ObjectId().toString(),
      ...payload,
      status: 'waiting',
      createdAt: new Date()
    };

    if (mongoose.connection.readyState === 1) {
      Ride.create(newRideData).catch(() => {});
    } else {
      memoryRides.push(newRideData);
    }

    io.emit('new_ride_broadcast', newRideData);

    try {
      const pushPayload = JSON.stringify({
        title: "High Priority Ride Request",
        body: `From: ${payload.fromLocation} To: ${payload.toLocation}`
      });
      const subs = mongoose.connection.readyState === 1 ? await PushSubscription.find() : memorySubscriptions;
      subs.forEach(sub => {
        webpush.sendNotification(sub, pushPayload).catch(() => {});
      });
    } catch (e) {}
  });

  socket.on('ping_riders', (data) => {
    io.emit('new_ride_broadcast', {
      _id: data.rideId || Date.now(),
      fromLocation: data.from,
      toLocation: data.to,
      creatorName: data.passenger,
      status: 'waiting'
    });
  });

  socket.on('accept_ride', async ({ rideId, accepter }) => {
    try {
      let updatedRide = null;
      if (mongoose.connection.readyState === 1) {
        updatedRide = await Ride.findByIdAndUpdate(rideId, { status: 'accepted', acceptedBy: accepter }, { new: true }).lean();
      } else {
        const ride = memoryRides.find(r => r._id === rideId);
        if (ride) {
          ride.status = 'accepted';
          ride.acceptedBy = accepter;
          updatedRide = ride;
        }
      }
      if (updatedRide) io.emit('ride_accepted_broadcast', updatedRide);
    } catch (err) {}
  });

  socket.on('send_in_app_chat', async (msg) => {
    io.emit('receive_in_app_chat', msg);
  });

  socket.on('disconnect', () => {
    for (let [userId, val] of liveRidersMap.entries()) {
      if (val.socketId === socket.id) liveRidersMap.delete(userId);
    }
    io.emit('nearby_riders_update', Array.from(liveRidersMap.values()));
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`SPCT Avengers Backend running on port ${PORT}`);
});