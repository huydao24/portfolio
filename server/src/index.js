import 'dotenv/config';  // Load .env file trước tất cả mọi thứ khác
import express from 'express';
import cors from 'cors';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import axios from 'axios';
import nodemailer from 'nodemailer';
import { registerUser, loginUser, requireAuth, requestPasswordReset, resetPassword } from './auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../data');
const DATA_FILE = path.join(DATA_DIR, 'chat-history.json');

// Cho phép tất cả origin truy cập (public chat API)
const ALLOWED_ORIGINS = '*';

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
  },
});

app.use(cors());
app.use(express.json());

// ── Gmail SMTP Transporter ──────────────────────────────────────────────────
const GMAIL_USER = process.env.GMAIL_USER?.trim();
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD?.trim();

let mailTransporter = null;
if (GMAIL_USER && GMAIL_APP_PASSWORD) {
  mailTransporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: GMAIL_USER,
      pass: GMAIL_APP_PASSWORD,
    },
  });
  console.log(`[email] Gmail SMTP configured: ${GMAIL_USER}`);
} else {
  console.warn('[email] Gmail SMTP disabled — GMAIL_USER or GMAIL_APP_PASSWORD is missing');
}

function createInitialState() {
  return {
    sessions: {},
    telegramMessageMap: {},
    lastUpdateId: 0,
    activeTelegramSessionId: null,
    activeTelegramSessionUpdatedAt: null,
  };
}

let state = createInitialState();
let telegramPolling = false;
const ACTIVE_TELEGRAM_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

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
      activeTelegramSessionId: null,
      activeTelegramSessionUpdatedAt: null,
    };
  }

  return {
    sessions: typeof parsed?.sessions === 'object' && parsed.sessions ? parsed.sessions : {},
    telegramMessageMap:
      typeof parsed?.telegramMessageMap === 'object' && parsed.telegramMessageMap
        ? parsed.telegramMessageMap
        : {},
    lastUpdateId: Number.isInteger(parsed?.lastUpdateId) ? parsed.lastUpdateId : 0,
    activeTelegramSessionId:
      typeof parsed?.activeTelegramSessionId === 'string' ? parsed.activeTelegramSessionId : null,
    activeTelegramSessionUpdatedAt:
      typeof parsed?.activeTelegramSessionUpdatedAt === 'string'
        ? parsed.activeTelegramSessionUpdatedAt
        : null,
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

function setActiveTelegramSession(sessionId, updatedAt = new Date()) {
  state.activeTelegramSessionId = sessionId;
  state.activeTelegramSessionUpdatedAt = new Date(updatedAt).toISOString();
}

function getFallbackSessionIdFromState() {
  if (state.activeTelegramSessionId) {
    const updatedAt = new Date(state.activeTelegramSessionUpdatedAt || 0).getTime();
    if (updatedAt && Date.now() - updatedAt <= ACTIVE_TELEGRAM_SESSION_TTL_MS) {
      return state.activeTelegramSessionId;
    }
  }

  const sessionIds = Object.keys(state.sessions);
  return sessionIds.length === 1 ? sessionIds[0] : null;
}

function normalizeDisplayName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 40);
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

  if (message.source === 'web' || message.source === 'telegram') {
    setActiveTelegramSession(message.sessionId, message.createdAt);
  }

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

function getTelegramReplyHint(user) {
  const senderName = String(user || 'Ban').trim() || 'Ban';
  return [
    `B\u1ea1n ${senderName} g\u1eedi n\u00e8:`,
    '',
  ].join('\n');
}

function buildTelegramOutgoingText(message) {
  return `${getTelegramReplyHint(message.user)}${message.text}`;
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
  if (sessionMatch?.[1]) {
    return sessionMatch[1];
  }

  return getFallbackSessionIdFromState();
}

function cleanTelegramReplyText(text = '') {
  return text.replace(/Session:\s*[a-zA-Z0-9-]+\s*/gi, '').trim();
}

function getTelegramSenderName(from) {
  return 'Anh Huy';
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

  if (TELEGRAM_THREAD_ID) {
    const messageThreadId = Number(telegramMessage.message_thread_id || 0);
    if (messageThreadId !== Number(TELEGRAM_THREAD_ID)) {
      return;
    }
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
  const user = normalizeDisplayName(req.body?.user) || 'Ban';

  if (!sessionId) {
    return res.status(400).json({ error: 'Missing sessionId' });
  }

  if (!text) {
    return res.status(400).json({ error: 'Missing message text' });
  }

  const message = buildMessage({
    sessionId,
    role: 'visitor',
    user,
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

// ============================================================
// AUTH ROUTES
// ============================================================

/**
 * POST /api/auth/register
 * Body: { name, email, password }
 */
app.post('/api/auth/register', async (req, res) => {
  try {
    const { user, token } = await registerUser(req.body);
    return res.status(201).json({ message: 'Đăng ký thành công!', user, token });
  } catch (err) {
    const status = err.statusCode || 500;
    return res.status(status).json({ error: err.message || 'Lỗi server.' });
  }
});

/**
 * POST /api/auth/login
 * Body: { email, password }
 */
app.post('/api/auth/login', async (req, res) => {
  try {
    const { user, token } = await loginUser(req.body);
    return res.status(200).json({ message: 'Đăng nhập thành công!', user, token });
  } catch (err) {
    const status = err.statusCode || 500;
    return res.status(status).json({ error: err.message || 'Lỗi server.' });
  }
});

/**
 * GET /api/auth/verify
 * Header: Authorization: Bearer <token>
 * Verify token còn hợp lệ không.
 */
app.get('/api/auth/verify', requireAuth, (req, res) => {
  return res.json({ valid: true, user: req.user });
});

/**
 * POST /api/auth/forgot-password
 * Body: { email }
 * Tạo mã reset 6 số và gửi trực tiếp đến email người dùng.
 */
app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const result = await requestPasswordReset(req.body);

    // ── Gửi mã reset qua Email cho người dùng ──────────────────────────
    if (mailTransporter && result.resetCode) {
      const htmlContent = `
        <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 480px; margin: 0 auto; background: #0d1117; color: #e6edf3; border-radius: 12px; overflow: hidden; border: 1px solid rgba(0,212,255,0.15);">
          <div style="background: linear-gradient(135deg, #0077BC, #009866); padding: 28px 32px; text-align: center;">
            <h1 style="margin: 0; font-size: 1.4em; color: #fff; letter-spacing: 0.04em;">🔐 Đặt lại mật khẩu</h1>
          </div>
          <div style="padding: 32px;">
            <p style="color: #8b949e; font-size: 0.95em; line-height: 1.7; margin-top: 0;">
              Xin chào <strong style="color: #e6edf3;">${result.userName}</strong>,
            </p>
            <p style="color: #8b949e; font-size: 0.95em; line-height: 1.7;">
              Bạn vừa yêu cầu đặt lại mật khẩu cho tài khoản tại <strong style="color: #00d4ff;">DNH.dev</strong>. Sử dụng mã bên dưới để hoàn tất:
            </p>
            <div style="background: rgba(22,27,34,0.9); border: 1px solid rgba(0,212,255,0.25); border-radius: 8px; padding: 20px; text-align: center; margin: 24px 0;">
              <span style="font-family: 'Courier New', monospace; font-size: 2.2em; font-weight: bold; letter-spacing: 0.3em; color: #00d4ff;">${result.resetCode}</span>
            </div>
            <p style="color: #f85149; font-size: 0.82em; text-align: center; margin-bottom: 20px;">
              ⏰ Mã này sẽ hết hạn sau <strong>15 phút</strong>
            </p>
            <hr style="border: none; border-top: 1px solid rgba(0,212,255,0.1); margin: 24px 0;">
            <p style="color: #6e7681; font-size: 0.78em; line-height: 1.6; margin-bottom: 0;">
              Nếu bạn không yêu cầu đặt lại mật khẩu, vui lòng bỏ qua email này. Tài khoản của bạn vẫn an toàn.
            </p>
          </div>
          <div style="background: rgba(22,27,34,0.5); padding: 16px 32px; text-align: center; border-top: 1px solid rgba(0,212,255,0.08);">
            <p style="color: #484f58; font-size: 0.72em; margin: 0;">© 2025 DNH.dev — Portfolio by Đào Ngọc Huy</p>
          </div>
        </div>
      `;

      try {
        await mailTransporter.sendMail({
          from: `"DNH.dev" <${GMAIL_USER}>`,
          to: result.userEmail,
          subject: `🔐 Mã đặt lại mật khẩu: ${result.resetCode}`,
          html: htmlContent,
        });
        console.log(`[email] Reset code sent to ${result.userEmail}`);
      } catch (mailErr) {
        console.error('[email] Failed to send reset code:', mailErr.message);
        return res.status(500).json({ error: 'Không thể gửi email. Vui lòng thử lại sau.' });
      }
    } else if (!mailTransporter) {
      console.error('[email] Mail transporter not configured');
      return res.status(500).json({ error: 'Chức năng gửi email chưa được cấu hình.' });
    }

    // Thông báo admin qua Telegram (tùy chọn)
    if (TELEGRAM_API_URL && TELEGRAM_CHAT_ID && result.resetCode) {
      const telegramText = [
        `🔐 YÊU CẦU ĐẶT LẠI MẬT KHẨU`,
        `━━━━━━━━━━━━━━━━━━━`,
        `👤 ${result.userName} (${result.userEmail})`,
        `📧 Mã reset đã gửi qua email`,
        `⏰ Hết hạn sau 15 phút`,
      ].join('\n');

      const payload = { chat_id: TELEGRAM_CHAT_ID, text: telegramText };
      if (TELEGRAM_THREAD_ID) payload.message_thread_id = Number(TELEGRAM_THREAD_ID);

      try {
        await axios.post(`${TELEGRAM_API_URL}/sendMessage`, payload, { timeout: 10000 });
      } catch (tgErr) {
        console.error('[telegram] Failed to notify admin:', tgErr.message);
      }
    }

    return res.json({ message: 'Mã xác nhận đã được gửi đến email của bạn. Vui lòng kiểm tra hộp thư.' });
  } catch (err) {
    const status = err.statusCode || 500;
    if (status === 200) {
      return res.json({ message: err.message });
    }
    return res.status(status).json({ error: err.message || 'Lỗi server.' });
  }
});

/**
 * POST /api/auth/reset-password
 * Body: { email, resetCode, newPassword }
 */
app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const result = await resetPassword(req.body);
    return res.json({ message: result.message });
  } catch (err) {
    const status = err.statusCode || 500;
    return res.status(status).json({ error: err.message || 'Lỗi server.' });
  }
});

app.get('/', (req, res) => {
  res.json({
    service: 'Portfolio Chat API',
    status: 'running',
    docs: {
      'GET /api/messages':           'Lấy tin nhắn theo sessionId',
      'POST /api/messages':          'Gửi tin nhắn mới',
      'GET /api/health':             'Kiểm tra trạng thái server',
      'POST /api/auth/register':     'Đăng ký tài khoản mới',
      'POST /api/auth/login':        'Đăng nhập',
      'GET /api/auth/verify':        'Verify JWT token',
      'POST /api/auth/forgot-password': 'Yêu cầu mã đặt lại mật khẩu',
      'POST /api/auth/reset-password':  'Đặt lại mật khẩu bằng mã xác nhận',
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
