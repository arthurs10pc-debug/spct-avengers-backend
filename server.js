require('dotenv').config();
const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const cors = require('cors');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PATCH', 'DELETE'] }));
app.use(express.json());

const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST', 'PATCH', 'DELETE'] }
});

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error('[ERROR] MONGO_URI is missing.');
}

mongoose.connect(MONGO_URI)
  .then(async () => {
    console.log('MongoDB Cloud Atlas connected successfully.');
    try {
      await mongoose.connection.collection('users').dropIndex('email_1');
    } catch (e) {}
  })
  .catch((err) => console.error('MongoDB Atlas connection error:', err.message));

const userSchema = new mongoose.Schema({
  fullName: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  gmail: { type: String },
  phone: { type: String, default: '' },
  avatar: { type: String, default: '' },
  role: { type: String, enum: ['biker', 'ride_taker', 'user'], default: 'ride_taker' },
  createdAt: { type: Date, default: Date.now }
});

const rideSchema = new mongoose.Schema({
  creatorId: { type: String, required: true },
  creatorName: { type: String, required: true },
  creatorPhone: { type: String, required: true },
  creatorRole: { type: String, required: true },
  fromLocation: { type: String, required: true },
  toLocation: { type: String, required: true },
  status: { type: String, enum: ['active', 'accepted', 'completed'], default: 'active' },
  acceptedBy: {
    name: String,
    phone: String,
    role: String
  },
  createdAt: { type: Date, default: Date.now, expires: 7200 }
});

const User = mongoose.model('User', userSchema);
const Ride = mongoose.model('Ride', rideSchema);

// In-Memory Live Rider GPS Positions
const liveRiders = new Map();

app.get('/', (req, res) => {
  res.json({ message: 'SPCT Avengers Backend with Live Radar is live' });
});

// Google Authentication
app.post('/api/auth/google-login', async (req, res) => {
  const { fullName, email, avatar, phone, role, mode } = req.body;
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid Gmail account required.' });
  }

  const cleanEmail = email.trim().toLowerCase();

  try {
    let user = await User.findOne({ 
      $or: [{ email: cleanEmail }, { gmail: cleanEmail }] 
    });

    if (mode === 'login') {
      if (!user) {
        return res.status(404).json({ error: 'No account found with this Gmail. Please Sign Up.' });
      }
      if (avatar && !user.avatar) user.avatar = avatar;
      if (role) user.role = role;
      user.email = cleanEmail;
      user.gmail = cleanEmail;
      await user.save();

      return res.json({
        success: true,
        user: {
          _id: user._id.toString(),
          name: user.fullName,
          email: cleanEmail,
          phone: user.phone || '',
          avatar: user.avatar,
          role: user.role,
          isAdmin: cleanEmail === 'arthurs10pc@gmail.com'
        }
      });
    }

    if (!user) {
      user = await User.create({
        fullName: fullName || 'Hostel Student',
        email: cleanEmail,
        gmail: cleanEmail,
        phone: phone ? phone.trim() : '',
        avatar: avatar || '',
        role: role || 'ride_taker'
      });
    } else {
      if (phone) user.phone = phone.trim();
      if (role) user.role = role;
      if (avatar) user.avatar = avatar;
      user.email = cleanEmail;
      user.gmail = cleanEmail;
      await user.save();
    }

    return res.json({
      success: true,
      user: {
        _id: user._id.toString(),
        name: user.fullName,
        email: cleanEmail,
        phone: user.phone || '',
        avatar: user.avatar,
        role: user.role,
        isAdmin: cleanEmail === 'arthurs10pc@gmail.com'
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Rides API
app.get('/api/rides', async (req, res) => {
  try {
    const rides = await Ride.find().sort({ createdAt: -1 });
    res.json(rides);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/bikers', async (req, res) => {
  try {
    const bikers = await User.find({ role: 'biker' }).sort({ createdAt: -1 });
    res.json(bikers);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/rides/:id', async (req, res) => {
  try {
    await Ride.findByIdAndDelete(req.params.id);
    io.emit('ride_deleted_broadcast', req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/rides/clear-all', async (req, res) => {
  try {
    await Ride.deleteMany({});
    io.emit('all_rides_cleared');
    res.json({ success: true, message: 'All active rides cleared.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Socket.io with Live GPS Tracking and Auto-Hide Accepted Rides
io.on('connection', (socket) => {
  // Rider broadcasts current GPS coordinates
  socket.on('update_rider_gps', (riderData) => {
    if (riderData && riderData.userId) {
      liveRiders.set(riderData.userId, {
        ...riderData,
        socketId: socket.id,
        lastUpdated: Date.now()
      });
      io.emit('nearby_riders_update', Array.from(liveRiders.values()));
    }
  });

  socket.on('post_ride', async (rideData) => {
    try {
      const newRide = await Ride.create(rideData);
      io.emit('new_ride_broadcast', newRide);
    } catch (err) {
      console.error(err.message);
    }
  });

  socket.on('accept_ride', async ({ rideId, accepter }) => {
    try {
      const updated = await Ride.findByIdAndUpdate(
        rideId,
        { status: 'accepted', acceptedBy: accepter },
        { new: true }
      );
      // Auto-removes from other riders instantly
      io.emit('ride_accepted_broadcast', updated);
    } catch (err) {
      console.error(err.message);
    }
  });

  socket.on('disconnect', () => {
    for (const [userId, rider] of liveRiders.entries()) {
      if (rider.socketId === socket.id) {
        liveRiders.delete(userId);
        io.emit('nearby_riders_update', Array.from(liveRiders.values()));
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`SPCT Avengers Backend running on port ${PORT}`);
});