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

const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://het:het123@cluster0.mongodb.net/lonewolf_ai?retryWrites=true&w=majority";

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

app.get('/', (req, res) => {
  res.send("Lone Wolf AI Assistant Backend Online.");
});

io.on('connection', (socket) => {
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