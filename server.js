require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');
const nodemailer = require('nodemailer');

const app = express();
const server = http.createServer(app);

app.use(cors({ origin: "*" }));
app.use(express.json());

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST", "DELETE"] }
});

const ADMIN_EMAIL = "arthurs10pc@gmail.com";

// MongoDB Atlas Cloud Connection
const MONGO_URI = process.env.MONGO_URI;
mongoose.connect(MONGO_URI)
  .then(() => console.log("MongoDB Cloud Atlas connected successfully for SPCT Avengers."))
  .catch((err) => console.error("MongoDB Atlas connection error:", err.message));

// User Schema
const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  phone: { type: String, required: true },
  role: { type: String, required: true }, // 'Hostel Senior', 'Junior', 'Day Scholar'
  isAdmin: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

// Ride Schema
const rideSchema = new mongoose.Schema({
  creatorId: { type: String, required: true },
  creatorName: { type: String, required: true },
  creatorPhone: { type: String, required: true },
  creatorRole: { type: String, required: true },
  fromLocation: { type: String, required: true },
  toLocation: { type: String, required: true },
  status: { type: String, default: 'open' }, // 'open', 'accepted'
  acceptedBy: {
    name: { type: String, default: null },
    phone: { type: String, default: null },
    role: { type: String, default: null }
  },
  createdAt: { type: Date, default: Date.now }
});
const Ride = mongoose.model('Ride', rideSchema);

// In-Memory OTP Store
const otpStore = new Map();

// Strict Indian Mobile Validation (Starts with 6-9, rejects sequence and repeated numbers)
const isValidIndianMobile = (num) => {
  if (!num) return false;
  const cleaned = num.toString().replace(/\D/g, '');
  if (cleaned.length !== 10) return false;
  if (!/^[6-9]/.test(cleaned)) return false;
  if (["1234567890", "0123456789", "9876543210", "1234567892"].includes(cleaned)) return false;
  if (/^(\d)\1{9}$/.test(cleaned)) return false;
  return true;
};

// Nodemailer Transporter Setup
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER || ADMIN_EMAIL,
    pass: process.env.GMAIL_APP_PASS
  }
});

// Auto-Expire Controls: Clears open rides older than 2 hours every 15 minutes
setInterval(async () => {
  try {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const result = await Ride.deleteMany({ status: 'open', createdAt: { $lt: twoHoursAgo } });
    if (result.deletedCount > 0) {
      console.log(`[AUTO-CLEANUP] Purged ${result.deletedCount} expired open rides.`);
      io.emit('rides_refreshed');
    }
  } catch (err) {
    console.error("Auto-cleanup error:", err.message);
  }
}, 15 * 60 * 1000);

// API: Send OTP
app.post('/api/auth/send-otp', async (req, res) => {
  const { email, name, phone, role } = req.body;

  if (!email || !name || !phone || !role) {
    return res.status(400).json({ error: "All fields are required" });
  }

  if (!isValidIndianMobile(phone)) {
    return res.status(400).json({ error: "Enter a valid 10-digit mobile number (starts with 6-9, no dummy sequences)" });
  }

  const generatedOtp = Math.floor(100000 + Math.random() * 900000).toString();
  otpStore.set(email.toLowerCase(), {
    otp: generatedOtp,
    name,
    phone,
    role,
    expiresAt: Date.now() + 5 * 60 * 1000
  });

  const mailOptions = {
    from: `"SPCT Avengers" <${ADMIN_EMAIL}>`,
    to: email,
    subject: `SPCT Avengers OTP Code: ${generatedOtp}`,
    html: `
      <div style="font-family: Arial, sans-serif; background-color: #f8fafc; color: #0f172a; padding: 25px; border-radius: 12px; max-width: 450px; margin: auto; border: 1px solid #e2e8f0;">
        <h2 style="color: #16a34a; margin-top: 0;">SPCT Avengers Verification</h2>
        <p>Hey <b>${name}</b>,</p>
        <p>Your one-time login OTP is:</p>
        <div style="background: #ffffff; padding: 16px; text-align: center; font-size: 30px; font-weight: bold; letter-spacing: 8px; color: #0284c7; border-radius: 8px; margin: 20px 0; border: 2px dashed #bae6fd;">
          ${generatedOtp}
        </div>
        <p style="font-size: 12px; color: #64748b;">This code expires in 5 minutes. Ride safe with hostel mates!</p>
      </div>
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`[EMAIL DISPATCHED] OTP sent to ${email}`);
    res.json({ success: true, message: "OTP sent to your Gmail ID" });
  } catch (error) {
    console.error("Nodemailer error:", error.message);
    res.status(500).json({ error: "Failed to dispatch email. Verify your Gmail App Password." });
  }
});

// API: Verify OTP
app.post('/api/auth/verify-otp', async (req, res) => {
  const { email, otp } = req.body;
  const record = otpStore.get(email?.toLowerCase());

  if (!record || record.otp !== otp || Date.now() > record.expiresAt) {
    return res.status(400).json({ error: "Invalid or expired OTP" });
  }

  try {
    const isMasterAdmin = email.toLowerCase() === ADMIN_EMAIL.toLowerCase();

    let user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      user = await User.create({
        name: record.name,
        email: email.toLowerCase(),
        phone: record.phone,
        role: record.role,
        isAdmin: isMasterAdmin
      });
    } else {
      user.name = record.name;
      user.phone = record.phone;
      user.role = record.role;
      user.isAdmin = isMasterAdmin;
      await user.save();
    }

    otpStore.delete(email.toLowerCase());
    res.json({ success: true, user });
  } catch (error) {
    res.status(500).json({ error: "Database verification error" });
  }
});

// API: Get Active Rides
app.get('/api/rides', async (req, res) => {
  try {
    const rides = await Ride.find().sort({ createdAt: -1 }).limit(50);
    res.json(rides);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch rides" });
  }
});

// API: Master Admin - Fetch All Users
app.get('/api/admin/users', async (req, res) => {
  const { email } = req.query;
  if (email?.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
    return res.status(403).json({ error: "Access Denied: Master Admin Only" });
  }
  try {
    const users = await User.find().sort({ createdAt: -1 });
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: "Failed to load user directory" });
  }
});

// API: Master Admin - Delete Any Ride
app.delete('/api/admin/rides/:id', async (req, res) => {
  const { email } = req.body;
  if (email?.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
    return res.status(403).json({ error: "Access Denied: Master Admin Only" });
  }
  try {
    await Ride.findByIdAndDelete(req.params.id);
    io.emit('ride_deleted_broadcast', { rideId: req.params.id });
    res.json({ success: true, message: "Ride deleted by Master Admin" });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete ride" });
  }
});

// Socket Realtime Engine
io.on('connection', (socket) => {
  socket.on('post_ride', async (rideData) => {
    try {
      const newRide = await Ride.create(rideData);
      io.emit('new_ride_broadcast', newRide);
    } catch (e) {
      console.error(e.message);
    }
  });

  socket.on('accept_ride', async ({ rideId, accepter }) => {
    try {
      const ride = await Ride.findById(rideId);
      if (ride && ride.status === 'open') {
        ride.status = 'accepted';
        ride.acceptedBy = {
          name: accepter.name,
          phone: accepter.phone,
          role: accepter.role
        };
        await ride.save();
        io.emit('ride_accepted_broadcast', ride);
      }
    } catch (e) {
      console.error(e.message);
    }
  });
});

const PORT = process.env.PORT || 5001;
server.listen(PORT, () => {
  console.log(`SPCT Avengers Backend running on port ${PORT}`);
});