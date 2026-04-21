import express from 'express';
import cors from 'cors';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../data');
const DATA_FILE = path.join(DATA_DIR, 'chat-history.json');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server);


app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
// API nhận tin nhắn mới từ client (POST)
app.post('/api/messages', async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: "Missing message text" });
  const guestId = Math.floor(100000 + Math.random() * 900000);
  const username = `Guest-${guestId}`;
  const message = {
    user: username,
    text,
    time: new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })
  };
  messages.push(message);
  if (messages.length > 100) messages.shift();
  await saveMessages();
  io.emit('chat message', message);
  res.json({ message });
});

let messages = [];

// Đọc lịch sử chat từ file JSON
async function loadMessages() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const data = await fs.readFile(DATA_FILE, 'utf8');
    messages = JSON.parse(data);
  } catch (err) {
    messages = [];
  }
}

// Ghi lịch sử chat vào file JSON
async function saveMessages() {
  await fs.writeFile(DATA_FILE, JSON.stringify(messages, null, 2), 'utf8');
}

// API lấy lịch sử chat
app.get('/api/messages', async (req, res) => {
  await loadMessages();
  res.json(messages);
});

// Trang chủ (nếu cần)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Socket.IO chat cộng đồng
io.on('connection', (socket) => {
  // Gán prefix Guest-{id ngẫu nhiên}
  const guestId = Math.floor(100000 + Math.random() * 900000);
  const username = `Guest-${guestId}`;

  // Gửi lịch sử chat cho user mới
  socket.emit('chat history', messages);

  // Khi nhận tin nhắn mới
  socket.on('chat message', async (msg) => {
    const message = {
      user: username,
      text: msg,
      time: new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })
    };
    messages.push(message);
    if (messages.length > 100) messages.shift();
    await saveMessages();
    io.emit('chat message', message);
  });
});

const PORT = 3000;
loadMessages().then(() => {
  server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
});
