const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

require('dotenv').config();
const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const cors = require('cors');
const { Server } = require('socket.io');
const nodemailer = require('nodemailer');

const app = express();
const server = http.createServer(app);

// Socket.io setup with CORS
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PATCH', 'DELETE']
  }
});

// Middleware
app.use(cors());
app.use(express.json());

// --- MongoDB Atlas Connection ---
const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error('[ERROR] MONGO_URI environment variable is missing.');
}

mongoose.connect(MONGO_URI)
  .then(() => console.log('MongoDB Cloud Atlas connected successfully for SPCT Avengers.'))
  .catch((err) => console.error('MongoDB Atlas connection error:', err.message));

// --- Database Schemas ---
const userSchema = new mongoose.Schema({
  fullName: { type: String, required: true },
  gmail: { type: String, required: true, unique: true },
  phone: { type: String, required: true },
  role: { type: String, enum: ['biker', 'user', 'ride_taker'], default: 'user' },
  isVerified: { type: Boolean, default: false },
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

// In-memory OTP storage
const otpStore = new Map();

// --- Production Nodemailer Transporter (Strict IPv4 Lookup Fix) ---
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false, // STARTTLS
  lookup: (hostname, options, callback) => {
    // Force direct IPv4 resolution to eliminate ENETUNREACH IPv6 routing errors
    return dns.lookup(hostname, { family: 4 }, callback);
  },
  auth: {
    user: (process.env.GMAIL_USER || 'arthurs10pc@gmail.com').trim(),
    pass: (process.env.GMAIL_APP_PASS || '').replace(/\s+/g, '')
  },
  tls: {
    rejectUnauthorized: false
  }
});

// Verify SMTP connection on startup
transporter.verify((error) => {
  if (error) {
    console.error('[SMTP ERROR] Transporter connection failed:', error.message);
  } else {
    console.log('[SMTP READY] Gmail SMTP Server ready for instant dispatch.');
  }
});

// --- API Endpoints ---

// Root health check
app.get('/', (req, res) => {
  res.json({ message: 'SPCT Avengers Backend is running live.' });
});

// 1. Send OTP Endpoint
app.post('/api/auth/send-otp', async (req, res) => {
  const { email, name, fullName, phone, role } = req.body;
  const userName = name || fullName;

  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid Gmail address is required.' });
  }

  if (!process.env.GMAIL_APP_PASS) {
    return res.status(500).json({ 
      error: 'Backend Error: GMAIL_APP_PASS is missing in Render Environment Variables.' 
    });
  }

  const cleanEmail = email.trim().toLowerCase();
  const generatedOtp = Math.floor(100000 + Math.random() * 900000).toString();

  // Store OTP for 10 minutes
  otpStore.set(cleanEmail, {
    otp: generatedOtp,
    expires: Date.now() + 10 * 60 * 1000,
    registrationData: { fullName: userName, phone, role }
  });

  const mailOptions = {
    from: `"SPCT Avengers" <${(process.env.GMAIL_USER || 'arthurs10pc@gmail.com').trim()}>`,
    to: cleanEmail,
    subject: `Your SPCT Avengers Login OTP: ${generatedOtp}`,
    html: `
      <div style="font-family: Arial, sans-serif; padding: 20px; color: #111; max-width: 500px; border: 1px solid #e2e8f0; border-radius: 8px;">
        <h2 style="color: #0f172a; margin-top: 0;">SPCT Avengers Verification</h2>
        <p>Use the OTP below to complete your authentication:</p>
        <div style="font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #2563eb; padding: 15px 0; text-align: center; background-color: #eff6ff; border-radius: 6px; margin: 20px 0;">
          ${generatedOtp}
        </div>
        <p style="font-size: 13px; color: #64748b;">This OTP will expire in 10 minutes. If you did not request this code, please ignore this email.</p>
      </div>
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`[OTP DISPATCH] Successfully sent OTP to ${cleanEmail}`);
    return res.json({ success: true, message: 'OTP sent successfully.' });
  } catch (err) {
    console.error('Nodemailer error:', err);
    return res.status(500).json({ 
      error: `Email Dispatch Failed: ${err.message || 'SMTP Authentication / Network error'}` 
    });
  }
});

// 2. Verify OTP & Login/Register Endpoint
app.post('/api/auth/verify-otp', async (req, res) => {
  const { email, otp } = req.body;
  if (!email || !otp) {
    return res.status(400).json({ error: 'Email and OTP are required.' });
  }

  const cleanEmail = email.trim().toLowerCase();
  const record = otpStore.get(cleanEmail);

  if (!record || record.otp !== otp.trim()) {
    return res.status(400).json({ error: 'Invalid OTP entered. Please re-check your inbox.' });
  }

  if (Date.now() > record.expires) {
    otpStore.delete(cleanEmail);
    return res.status(400).json({ error: 'OTP has expired. Please request a new one.' });
  }

  otpStore.delete(cleanEmail);

  let user = await User.findOne({ gmail: cleanEmail });
  if (!user && record.registrationData) {
    user = await User.create({
      fullName: record.registrationData.fullName || 'User',
      gmail: cleanEmail,
      phone: record.registrationData.phone || '',
      role: record.registrationData.role || 'user',
      isVerified: true
    });
  }

  const isAdmin = cleanEmail === 'arthurs10pc@gmail.com';

  return res.json({
    success: true,
    user: {
      _id: user ? user._id : 'admin',
      name: user ? user.fullName : 'Arthur Admin',
      email: cleanEmail,
      phone: user ? user.phone : '',
      role: user ? user.role : 'biker',
      isAdmin
    }
  });
});

// 3. Rides Endpoints
app.get('/api/rides', async (req, res) => {
  try {
    const rides = await Ride.find().sort({ createdAt: -1 });
    res.json(rides);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Socket Events Relay
io.on('connection', (socket) => {
  socket.on('post_ride', async (rideData) => {
    try {
      const newRide = await Ride.create(rideData);
      io.emit('new_ride_broadcast', newRide);
    } catch (err) {
      console.error('Ride post error:', err.message);
    }
  });

  socket.on('accept_ride', async ({ rideId, accepter }) => {
    try {
      const updated = await Ride.findByIdAndUpdate(
        rideId,
        { status: 'accepted', acceptedBy: accepter },
        { new: true }
      );
      io.emit('ride_accepted_broadcast', updated);
    } catch (err) {
      console.error('Ride accept error:', err.message);
    }
  });

  socket.on('disconnect', () => {});
});

// Server Initialization
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`SPCT Avengers Backend running on port ${PORT}`);
});