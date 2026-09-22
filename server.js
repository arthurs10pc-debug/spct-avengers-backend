require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');
const webpush = require('web-push');

const app = express();
const server = http.createServer(app);

app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "DELETE"]
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST", "DELETE"]
  },
  maxHttpBufferSize: 5e7,
  transports: ['websocket', 'polling']
});

const publicVapidKey = process.env.VAPID_PUBLIC_KEY || 'BKnGwCb7MAP4ancXdc4cV2oMaD9iF5EqLfgotpIHFH8ZT7LO8weEeIqHANDMCpwVohpCiompbhEh2Xjb93mS8pUw';
const privateVapidKey = process.env.VAPID_PRIVATE_KEY || '4hYeB-lD8KFZObFS-3p75qjrQbGu4hv-clq_jpLmRCY';

try {
  webpush.setVapidDetails('mailto:admin@spctavengers.com', publicVapidKey, privateVapidKey);
} catch (e) {
  console.log("VAPID setup warning:", e.message);
}

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
  acceptedBy: {
    name: String,
    phone: String,
    role: String
  },
  createdAt: { type: Date, default: Date.now }
});

const userSchema = new mongoose.Schema({
  fullName: String,
  email: { type: String, unique: true },
  phone: String,
  avatar: String,
  role: String,
  createdAt: { type: Date, default: Date.now }
});

const subscriptionSchema = new mongoose.Schema({
  endpoint: { type: String, unique: true },
  keys: {
    p256dh: String,
    auth: String
  }
});

const Ride = mongoose.model('Ride', rideSchema);
const User = mongoose.model('User', userSchema);
const PushSubscription = mongoose.model('PushSubscription', subscriptionSchema);

const memoryRides = [];
const memoryUsers = [];
const memorySubscriptions = [];

app.post('/api/save-subscription', async (req, res) => {
  const subscription = req.body;
  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ error: 'Invalid subscription object' });
  }

  try {
    if (mongoose.connection.readyState === 1) {
      await PushSubscription.findOneAndUpdate(
        { endpoint: subscription.endpoint },
        subscription,
        { upsert: true, new: true }
      );
    } else {
      if (!memorySubscriptions.some(s => s.endpoint === subscription.endpoint)) {
        memorySubscriptions.push(subscription);
      }
    }
    console.log("Push subscription saved successfully.");
    res.status(201).json({ success: true, message: 'Subscription saved successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/send-alert', async (req, res) => {
  const { title, body } = req.body;
  try {
    const payload = JSON.stringify({ title: title || "Alert", body: body || "Notification alert" });
    const subscriptions = mongoose.connection.readyState === 1 ? await PushSubscription.find() : memorySubscriptions;

    subscriptions.forEach(sub => {
      webpush.sendNotification(sub, payload).catch(err => {
        console.error("Push alert send error:", err.message);
      });
    });

    res.json({ success: true, message: "Alert dispatched to push subscribers." });
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

app.get('/api/admin/bikers', async (req, res) => {
  try {
    if (mongoose.connection.readyState === 1) {
      const bikers = await User.find({ role: 'biker' }).lean();
      res.json(bikers);
    } else {
      res.json(memoryUsers.filter(u => u.role === 'biker'));
    }
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
        user = await User.create({ fullName, email, avatar, phone, role });
      } else if (user && phone && !user.phone) {
        user.phone = phone;
        await user.save();
      }
    } else {
      user = memoryUsers.find(u => u.email === email);
      if (!user && mode === 'signup') {
        user = { _id: 'usr_' + Date.now(), fullName, email, avatar, phone, role };
        memoryUsers.push(user);
      }
    }

    if (!user) {
      return res.status(400).json({ success: false, error: 'User account not found. Please register.' });
    }

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
        title: "New Commute Request",
        body: `Route: ${payload.fromLocation} to ${payload.toLocation}`
      });
      const subs = mongoose.connection.readyState === 1 ? await PushSubscription.find() : memorySubscriptions;
      console.log(`Broadcasting push notification to ${subs.length} subscribers.`);
      
      subs.forEach(sub => {
        webpush.sendNotification(sub, pushPayload).catch(err => {
          console.error("Error sending push to endpoint:", err.message);
        });
      });
    } catch (e) {
      console.error("Push broadcast general error:", e.message);
    }
  });

  socket.on('accept_ride', async ({ rideId, accepter }) => {
    try {
      let updatedRide = null;
      if (mongoose.connection.readyState === 1) {
        updatedRide = await Ride.findByIdAndUpdate(
          rideId,
          { status: 'accepted', acceptedBy: accepter },
          { new: true }
        ).lean();
      } else {
        const ride = memoryRides.find(r => r._id === rideId);
        if (ride) {
          ride.status = 'accepted';
          ride.acceptedBy = accepter;
          updatedRide = ride;
        }
      }

      if (updatedRide) {
        io.emit('ride_accepted_broadcast', updatedRide);
      }
    } catch (err) {
      console.error("Accept ride error:", err);
    }
  });

  socket.on('send_in_app_chat', (msg) => {
    io.emit('receive_in_app_chat', msg);
  });

  socket.on('disconnect', () => {
    for (let [userId, val] of liveRidersMap.entries()) {
      if (val.socketId === socket.id) {
        liveRidersMap.delete(userId);
      }
    }
    io.emit('nearby_riders_update', Array.from(liveRidersMap.values()));
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`SPCT Avengers Backend running on port ${PORT}`);
});