import express from 'express';
import cors from 'cors';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import axios from 'axios';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../data');
const DATA_FILE = path.join(DATA_DIR, 'chat-history.json');

// Danh sách origin được phép truy cập (thêm domain Vercel của bạn)
const ALLOWED_ORIGINS = [
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'http://localhost:3000',
  /\.vercel\.app$/,
  // Thêm domain tùy chỉnh nếu có, ví dụ:
  // 'https://your-custom-domain.com',
];

const PORT = Number(process.env.PORT || 3000);
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN?.trim();
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID?.trim();
const TELEGRAM_THREAD_ID = process.env.TELEGRAM_THREAD_ID?.trim();
const TELEGRAM_API_URL = TELEGRAM_BOT_TOKEN
  ? `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`
  : null;

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ALLOWED_ORIGINS,
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

app.use(cors({
  origin: ALLOWED_ORIGINS,
  credentials: true,
}));
app.use(express.json());

function createInitialState() {
  return {
    sessions: {},
    telegramMessageMap: {},
    lastUpdateId: 0,
  };
}

let state = createInitialState();
let telegramPolling = false;

function formatTime(date = new Date()) {
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

function normalizeState(parsed) {
  if (Array.isArray(parsed)) {
    return {
      sessions: {},
      telegramMessageMap: {},
      lastUpdateId: 0,
    };
  }

  return {
    sessions: typeof parsed?.sessions === 'object' && parsed.sessions ? parsed.sessions : {},
    telegramMessageMap:
      typeof parsed?.telegramMessageMap === 'object' && parsed.telegramMessageMap
        ? parsed.telegramMessageMap
        : {},
    lastUpdateId: Number.isInteger(parsed?.lastUpdateId) ? parsed.lastUpdateId : 0,
  };
}

function getSessionMessages(sessionId) {
  if (!state.sessions[sessionId]) {
    state.sessions[sessionId] = [];
  }
  return state.sessions[sessionId];
}

function trimSessionMessages(sessionId) {
  const messages = getSessionMessages(sessionId);
  if (messages.length > 100) {
    state.sessions[sessionId] = messages.slice(-100);
  }
}

function trimTelegramMap() {
  const entries = Object.entries(state.telegramMessageMap);
  if (entries.length <= 1000) {
    return;
  }

  const trimmed = entries
    .sort(([, left], [, right]) => {
      const leftTime = new Date(left.createdAt || 0).getTime();
      const rightTime = new Date(right.createdAt || 0).getTime();
      return rightTime - leftTime;
    })
    .slice(0, 1000);

  state.telegramMessageMap = Object.fromEntries(trimmed);
}

function buildMessage({ sessionId, role, user, text, source }) {
  const createdAt = new Date();
  return {
    id: `${createdAt.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
    sessionId,
    role,
    user,
    text,
    source,
    time: formatTime(createdAt),
    createdAt: createdAt.toISOString(),
  };
}

function saveMessage(message) {
  const sessionMessages = getSessionMessages(message.sessionId);
  sessionMessages.push(message);
  trimSessionMessages(message.sessionId);
  io.to(message.sessionId).emit('chat message', message);
}

async function loadState() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const raw = await fs.readFile(DATA_FILE, 'utf8');
    state = normalizeState(JSON.parse(raw));
  } catch (error) {
    state = createInitialState();
  }
}

async function saveState() {
  trimTelegramMap();
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(state, null, 2), 'utf8');
}

function getTelegramReplyHint(sessionId) {
  return [
    'Tin nhan moi tu portfolio',
    `Session: ${sessionId}`,
    '',
    'Khach web:',
    '',
  ].join('\n');
}

function buildTelegramOutgoingText(message) {
  return `${getTelegramReplyHint(message.sessionId)}${message.text}\n\nReply truc tiep vao tin nhan nay de tra loi dung hoi thoai.`;
}

function resolveSessionIdFromTelegramMessage(telegramMessage) {
  const repliedMessageId = telegramMessage.reply_to_message?.message_id;
  if (repliedMessageId) {
    const match = state.telegramMessageMap[String(repliedMessageId)];
    if (match?.sessionId) {
      return match.sessionId;
    }
  }

  const sessionMatch = telegramMessage.text?.match(/Session:\s*([a-zA-Z0-9-]+)/i);
  return sessionMatch?.[1] || null;
}

function cleanTelegramReplyText(text = '') {
  return text.replace(/Session:\s*[a-zA-Z0-9-]+\s*/gi, '').trim();
}

function getTelegramSenderName(from) {
  if (!from) {
    return 'Telegram';
  }

  return from.username
    ? `@${from.username}`
    : [from.first_name, from.last_name].filter(Boolean).join(' ') || 'Telegram';
}

async function sendTelegramMessage(message) {
  if (!TELEGRAM_API_URL || !TELEGRAM_CHAT_ID) {
    throw new Error('Telegram bot chua duoc cau hinh. Can TELEGRAM_BOT_TOKEN va TELEGRAM_CHAT_ID.');
  }

  const payload = {
    chat_id: TELEGRAM_CHAT_ID,
    text: buildTelegramOutgoingText(message),
  };

  if (TELEGRAM_THREAD_ID) {
    payload.message_thread_id = Number(TELEGRAM_THREAD_ID);
  }

  const response = await axios.post(`${TELEGRAM_API_URL}/sendMessage`, payload, {
    timeout: 15000,
  });

  const telegramMessageId = response.data?.result?.message_id;
  if (telegramMessageId) {
    state.telegramMessageMap[String(telegramMessageId)] = {
      sessionId: message.sessionId,
      createdAt: new Date().toISOString(),
    };
    await saveState();
  }
}

async function handleTelegramUpdate(update) {
  state.lastUpdateId = update.update_id;

  const telegramMessage = update.message;
  if (!telegramMessage?.text) {
    return;
  }

  if (TELEGRAM_CHAT_ID && String(telegramMessage.chat?.id) !== String(TELEGRAM_CHAT_ID)) {
    return;
  }

  const sessionId = resolveSessionIdFromTelegramMessage(telegramMessage);
  if (!sessionId) {
    return;
  }

  const cleanedText = cleanTelegramReplyText(telegramMessage.text);
  if (!cleanedText) {
    return;
  }

  const replyMessage = buildMessage({
    sessionId,
    role: 'telegram',
    user: getTelegramSenderName(telegramMessage.from),
    text: cleanedText,
    source: 'telegram',
  });

  saveMessage(replyMessage);
  state.telegramMessageMap[String(telegramMessage.message_id)] = {
    sessionId,
    createdAt: new Date().toISOString(),
  };
}

async function pollTelegramUpdates() {
  if (telegramPolling || !TELEGRAM_API_URL || !TELEGRAM_CHAT_ID) {
    return;
  }

  telegramPolling = true;

  try {
    const response = await axios.get(`${TELEGRAM_API_URL}/getUpdates`, {
      params: {
        offset: state.lastUpdateId + 1,
        timeout: 20,
      },
      timeout: 25000,
    });

    const updates = response.data?.result || [];
    for (const update of updates) {
      await handleTelegramUpdate(update);
    }

    if (updates.length > 0) {
      await saveState();
    }
  } catch (error) {
    console.error('[telegram] polling failed:', error.message);
  } finally {
    telegramPolling = false;
    setTimeout(pollTelegramUpdates, 1500);
  }
}

app.get('/api/messages', async (req, res) => {
  const sessionId = String(req.query.sessionId || '').trim();
  if (!sessionId) {
    return res.status(400).json({ error: 'Missing sessionId' });
  }

  res.json(getSessionMessages(sessionId));
});

app.post('/api/messages', async (req, res) => {
  const text = String(req.body?.text || '').trim();
  const sessionId = String(req.body?.sessionId || '').trim();

  if (!sessionId) {
    return res.status(400).json({ error: 'Missing sessionId' });
  }

  if (!text) {
    return res.status(400).json({ error: 'Missing message text' });
  }

  const message = buildMessage({
    sessionId,
    role: 'visitor',
    user: 'Ban',
    text,
    source: 'web',
  });

  saveMessage(message);
  await saveState();

  try {
    await sendTelegramMessage(message);
    return res.status(201).json({ message });
  } catch (error) {
    const systemMessage = buildMessage({
      sessionId,
      role: 'system',
      user: 'He thong',
      text: error.message,
      source: 'server',
    });

    saveMessage(systemMessage);
    await saveState();

    return res.status(502).json({ error: error.message, message });
  }
});

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    telegramConfigured: Boolean(TELEGRAM_API_URL && TELEGRAM_CHAT_ID),
    port: PORT,
  });
});

app.get('/', (req, res) => {
  res.json({
    service: 'Portfolio Chat API',
    status: 'running',
    docs: {
      'GET /api/messages': 'Lấy tin nhắn theo sessionId',
      'POST /api/messages': 'Gửi tin nhắn mới',
      'GET /api/health': 'Kiểm tra trạng thái server',
    },
  });
});

io.on('connection', (socket) => {
  socket.on('chat:join', ({ sessionId } = {}) => {
    const normalizedSessionId = String(sessionId || '').trim();
    if (!normalizedSessionId) {
      socket.emit('chat error', { error: 'Missing sessionId' });
      return;
    }

    socket.join(normalizedSessionId);
    socket.emit('chat history', getSessionMessages(normalizedSessionId));
  });
});

loadState().then(() => {
  server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    if (TELEGRAM_API_URL && TELEGRAM_CHAT_ID) {
      pollTelegramUpdates();
    } else {
      console.warn('[telegram] bridge disabled because TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is missing');
    }
  });
});
