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
import { registerUser, loginUser, requireAuth, requestPasswordReset, resetPassword, googleLogin } from './auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../.data');
const DATA_FILE = path.join(DATA_DIR, 'chat-history.json');

// Cho phép tất cả origin truy cập (public chat API)
const ALLOWED_ORIGINS = '*';

const PORT = Number(process.env.PORT || 3000);

// Bot dành cho Chat
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN?.trim();
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID?.trim();
const TELEGRAM_THREAD_ID = process.env.TELEGRAM_THREAD_ID?.trim();

// Biến lưu trữ OTP Admin và hàng chờ cuộc gọi (Dùng chung cho toàn Server)
let currentAdminOTP = null;
let adminOTPExpiry = null;
const pendingCalls = new Map();



const TELEGRAM_API_URL = TELEGRAM_BOT_TOKEN
  ? `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`
  : null;

// Bot dành cho Auth (Mã xác thực, Noti đăng ký)
const TELEGRAM_AUTH_BOT_TOKEN = process.env.TELEGRAM_AUTH_BOT_TOKEN?.trim();
const TELEGRAM_AUTH_CHAT_ID = process.env.TELEGRAM_AUTH_CHAT_ID?.trim();
const TELEGRAM_AUTH_API_URL = TELEGRAM_AUTH_BOT_TOKEN
  ? `https://api.telegram.org/bot${TELEGRAM_AUTH_BOT_TOKEN}`
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
app.use(express.json({ limit: '300mb' }));
app.use(express.urlencoded({ extended: true, limit: '300mb' }));

// ── Email Setup (SMTP & Brevo HTTP API) ──────────────────────────────────────
const GMAIL_USER = process.env.GMAIL_USER?.trim();
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD?.trim();
const BREVO_API_KEY = process.env.BREVO_API_KEY?.trim();

let mailTransporter = null;
let useBrevo = false;

if (BREVO_API_KEY) {
  useBrevo = true;
  console.log('[email] Configured to use Brevo HTTP API (Render-friendly port 443)');
} else if (GMAIL_USER && GMAIL_APP_PASSWORD) {
  mailTransporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: GMAIL_USER,
      pass: GMAIL_APP_PASSWORD,
    },
    connectionTimeout: 4000, // 4 giây
    greetingTimeout: 4000,    // 4 giây
    socketTimeout: 6000,      // 6 giây
  });
  console.log(`[email] Gmail SMTP configured: ${GMAIL_USER}`);

  // Verify kết nối SMTP ngay khi khởi động để phát hiện sớm lỗi App Password
  mailTransporter.verify()
    .then(() => console.log('[email] ✅ SMTP connection verified — sẵn sàng gửi email'))
    .catch(err => {
      console.error('[email] ❌ SMTP verification FAILED:', err.message);
      console.error('[email] ❌ Error code:', err.code, '| Response:', err.responseCode);
      console.error('[email] ⚠️ Email SMTP có thể không gửi được. Hãy kiểm tra lại App Password hoặc kết nối mạng.');
    });
} else {
  console.warn('[email] Email service disabled — BREVO_API_KEY or GMAIL credentials missing');
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

function getMostRecentSessionId() {
  let latestSessionId = null;
  let latestTime = 0;

  for (const [sessionId, messages] of Object.entries(state.sessions)) {
    if (Array.isArray(messages) && messages.length > 0) {
      const lastMsg = messages[messages.length - 1];
      const time = new Date(lastMsg.createdAt || 0).getTime();
      if (time > latestTime) {
        latestTime = time;
        latestSessionId = sessionId;
      }
    }
  }

  return latestSessionId;
}

function getFallbackSessionIdFromState() {
  if (state.activeTelegramSessionId) {
    const updatedAt = new Date(state.activeTelegramSessionUpdatedAt || 0).getTime();
    if (updatedAt && Date.now() - updatedAt <= ACTIVE_TELEGRAM_SESSION_TTL_MS) {
      return state.activeTelegramSessionId;
    }
  }

  return getMostRecentSessionId();
}

function normalizeDisplayName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 40);
}

function formatFileSize(bytes) {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function resolveSessionIdFromTelegramMessage(telegramMessage) {
  const replyMsg = telegramMessage.reply_to_message;
  if (replyMsg) {
    const repliedMessageId = replyMsg.message_id;
    const match = state.telegramMessageMap[String(repliedMessageId)];
    if (match?.sessionId) {
      return match.sessionId;
    }
    const replyText = replyMsg.text || replyMsg.caption || '';
    const replySessionMatch = replyText.match(/Session:\s*([a-zA-Z0-9-]+)/i);
    if (replySessionMatch?.[1]) {
      return replySessionMatch[1];
    }
  }

  // Kiểm tra cả text và caption (document/photo/video dùng caption thay vì text)
  const textToSearch = telegramMessage.text || telegramMessage.caption || '';
  const sessionMatch = textToSearch.match(/Session:\s*([a-zA-Z0-9-]+)/i);
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

  if (message.image) {
    // Send as photo if image is present
    try {
      const mimeMatch = message.image.match(/^data:([^;]+);base64,/);
      const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
      const extension = mimeType.split('/')[1] || 'jpg';

      const base64Data = message.image.split(',')[1];
      const buffer = Buffer.from(base64Data, 'base64');
      const blob = new Blob([buffer], { type: mimeType });

      const formData = new FormData();
      formData.append('chat_id', TELEGRAM_CHAT_ID);
      formData.append('caption', buildTelegramOutgoingText(message));
      formData.append('photo', blob, `photo.${extension}`);

      if (TELEGRAM_THREAD_ID) {
        formData.append('message_thread_id', Number(TELEGRAM_THREAD_ID));
      }

      const response = await axios.post(`${TELEGRAM_API_URL}/sendPhoto`, formData);

      const telegramMessageId = response.data?.result?.message_id;
      if (telegramMessageId) {
        message.telegramMessageId = telegramMessageId;
        state.telegramMessageMap[String(telegramMessageId)] = {
          sessionId: message.sessionId,
          createdAt: new Date().toISOString(),
        };
        await saveState();
      }
      return;
    } catch (photoErr) {
      console.error('[telegram] sendPhoto failed:', photoErr.message);
    }
  }

  if (message.video) {
    // Send as video if video is present
    try {
      const mimeMatch = message.video.match(/^data:([^;]+);base64,/);
      let mimeType = mimeMatch ? mimeMatch[1] : 'video/mp4';
      let extension = mimeType.split('/')[1] || 'mp4';

      // Chuẩn hóa cho iOS / QuickTime
      if (mimeType === 'video/quicktime' || extension === 'quicktime') {
        extension = 'mov';
      }

      const base64Data = message.video.split(',')[1];
      const buffer = Buffer.from(base64Data, 'base64');
      const blob = new Blob([buffer], { type: mimeType });

      const formData = new FormData();
      formData.append('chat_id', TELEGRAM_CHAT_ID);
      formData.append('caption', buildTelegramOutgoingText(message));
      formData.append('video', blob, `video_${Date.now()}.${extension}`);

      if (TELEGRAM_THREAD_ID) {
        formData.append('message_thread_id', Number(TELEGRAM_THREAD_ID));
      }

      const response = await axios.post(`${TELEGRAM_API_URL}/sendVideo`, formData);

      const telegramMessageId = response.data?.result?.message_id;
      if (telegramMessageId) {
        message.telegramMessageId = telegramMessageId;
        state.telegramMessageMap[String(telegramMessageId)] = {
          sessionId: message.sessionId,
          createdAt: new Date().toISOString(),
        };
        await saveState();
      }
      return;
    } catch (videoErr) {
      console.error('[telegram] sendVideo failed:', videoErr.message);
    }
  }

  if (message.audio) {
    // Send as voice message if audio is present
    try {
      const mimeMatch = message.audio.match(/^data:([^;]+);base64,/);
      const mimeType = mimeMatch ? mimeMatch[1] : 'audio/ogg';
      let extension = mimeType.split('/')[1] || 'ogg';
      if (extension === 'mpeg') extension = 'mp3';
      if (extension === 'quicktime') extension = 'm4a';

      const base64Data = message.audio.split(',')[1];
      const buffer = Buffer.from(base64Data, 'base64');
      const blob = new Blob([buffer], { type: mimeType });

      const formData = new FormData();
      formData.append('chat_id', TELEGRAM_CHAT_ID);
      formData.append('caption', buildTelegramOutgoingText(message));
      formData.append('voice', blob, `voice_${Date.now()}.${extension}`);

      if (TELEGRAM_THREAD_ID) {
        formData.append('message_thread_id', Number(TELEGRAM_THREAD_ID));
      }

      const response = await axios.post(`${TELEGRAM_API_URL}/sendVoice`, formData);

      const telegramMessageId = response.data?.result?.message_id;
      if (telegramMessageId) {
        message.telegramMessageId = telegramMessageId;
        state.telegramMessageMap[String(telegramMessageId)] = {
          sessionId: message.sessionId,
          createdAt: new Date().toISOString(),
        };
        await saveState();
      }
      return;
    } catch (audioErr) {
      console.error('[telegram] sendVoice failed:', audioErr.message);
    }
  }

  if (message.file && message.file.data) {
    try {
      const mimeType = message.file.mimeType || 'application/octet-stream';
      const fileName = message.file.name || 'file';

      const base64Data = message.file.data.split(',')[1];
      const buffer = Buffer.from(base64Data, 'base64');
      const blob = new Blob([buffer], { type: mimeType });

      const formData = new FormData();
      formData.append('chat_id', TELEGRAM_CHAT_ID);
      formData.append('caption', buildTelegramOutgoingText(message));
      formData.append('document', blob, fileName);

      if (TELEGRAM_THREAD_ID) {
        formData.append('message_thread_id', Number(TELEGRAM_THREAD_ID));
      }

      const response = await axios.post(`${TELEGRAM_API_URL}/sendDocument`, formData);

      const telegramMessageId = response.data?.result?.message_id;
      if (telegramMessageId) {
        message.telegramMessageId = telegramMessageId;
        state.telegramMessageMap[String(telegramMessageId)] = {
          sessionId: message.sessionId,
          createdAt: new Date().toISOString(),
        };
        await saveState();
      }
      return;
    } catch (docErr) {
      console.error('[telegram] sendDocument failed:', docErr.message);
    }
  }

  const payload = {
    chat_id: TELEGRAM_CHAT_ID,
    text: buildTelegramOutgoingText(message)
  };

  if (TELEGRAM_THREAD_ID) {
    payload.message_thread_id = Number(TELEGRAM_THREAD_ID);
  }

  const response = await axios.post(`${TELEGRAM_API_URL}/sendMessage`, payload, {
    timeout: 15000,
  });

  const telegramMessageId = response.data?.result?.message_id;
  if (telegramMessageId) {
    message.telegramMessageId = telegramMessageId; // Lưu ID vào chính đối tượng tin nhắn
    state.telegramMessageMap[String(telegramMessageId)] = {
      sessionId: message.sessionId,
      createdAt: new Date().toISOString(),
    };
    await saveState();
  }
}

async function handleTelegramUpdate(update) {
  state.lastUpdateId = update.update_id;

  // Xử lý khi nhấn nút "Xóa trên Web" (Callback Query)
  if (update.callback_query) {
    const callbackData = update.callback_query.data;
    if (callbackData.startsWith('del:')) {
      const messageId = callbackData.split(':')[1];
      let found = false;

      // Tìm và xóa tin nhắn trong tất cả sessions
      for (const sessionId in state.sessions) {
        const messages = state.sessions[sessionId];
        const index = messages.findIndex(m => m.id === messageId);
        if (index !== -1) {
          messages.splice(index, 1);
          io.to(sessionId).emit('chat:message_deleted', { messageId });
          found = true;
          break;
        }
      }

      if (found) {
        await saveState();
        // Xóa tin nhắn bên Telegram luôn
        try {
          await axios.post(`${TELEGRAM_API_URL}/deleteMessage`, {
            chat_id: update.callback_query.message.chat.id,
            message_id: update.callback_query.message.message_id
          });
        } catch (err) { }
      }

      // Trả lời callback query để mất icon loading trên nút
      await axios.post(`${TELEGRAM_API_URL}/answerCallbackQuery`, {
        callback_query_id: update.callback_query.id,
        text: found ? 'Đã xóa trên Web' : 'Không tìm thấy tin nhắn'
      });
    }
    return;
  }

  // Handle reaction updates from Telegram
  if (update.message_reaction) {
    const reaction = update.message_reaction;
    const telegramMessageId = String(reaction.message_id);
    const match = state.telegramMessageMap[telegramMessageId];

    if (match?.sessionId) {
      const messages = getSessionMessages(match.sessionId);
      const msg = messages.find(
        m => String(m.telegramMessageId) === telegramMessageId
      );

      if (msg) {
        if (!msg.telegramReactions) msg.telegramReactions = [];

        // Reset cảm xúc của Admin (Telegram)
        const newReactions = reaction.new_reaction || [];
        msg.telegramReactions = newReactions.map(r => r.emoji).filter(Boolean);

        // Tính tổng hợp lại cảm xúc từ Web và Telegram
        msg.reactions = {};
        if (msg.webReaction) {
          msg.reactions[msg.webReaction] = 1;
        }
        msg.telegramReactions.forEach(e => {
          msg.reactions[e] = (msg.reactions[e] || 0) + 1;
        });

        io.to(match.sessionId).emit('chat:reaction', {
          messageId: msg.id,
          reactions: msg.reactions,
        });

        await saveState();
        console.log(`[telegram] Reaction updated for message ${telegramMessageId}:`, msg.reactions);
      }
    }
    return;
  }

  // Hỗ trợ cả tin nhắn mới (message) và tin nhắn được sửa (edited_message)
  const telegramMessage = update.message || update.edited_message;
  if (!telegramMessage) {
    return;
  }

  const isEdit = Boolean(update.edited_message);
  const telegramMessageId = String(telegramMessage.message_id);
  const text = telegramMessage.text || telegramMessage.caption || '';

  // Nếu là tin nhắn được sửa từ Telegram
  if (isEdit) {
    const match = state.telegramMessageMap[telegramMessageId];
    if (match?.sessionId) {
      const messages = getSessionMessages(match.sessionId);
      const msg = messages.find(m => m.telegramMessageId === Number(telegramMessageId) || m.telegramMessageId === telegramMessageId);

      if (msg) {
        const cleanedText = cleanTelegramReplyText(text);
        msg.text = cleanedText;
        msg.isEdited = true;

        // Thông báo cho client qua Socket.io
        io.to(match.sessionId).emit('chat:message_edited', {
          messageId: msg.id,
          text: cleanedText
        });

        await saveState();
        console.log(`[telegram] Sync edit from Telegram for message ${telegramMessageId}`);
      }
    }
    return;
  }

  let image = null;
  let video = null;

  // Handle photo from Telegram
  if (telegramMessage.photo && telegramMessage.photo.length > 0) {
    const photo = telegramMessage.photo[telegramMessage.photo.length - 1]; // Largest size
    try {
      const fileRes = await axios.get(`${TELEGRAM_API_URL}/getFile`, {
        params: { file_id: photo.file_id }
      });
      const filePath = fileRes.data?.result?.file_path;
      if (filePath && TELEGRAM_BOT_TOKEN) {
        const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${filePath}`;
        const imgRes = await axios.get(fileUrl, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(imgRes.data, 'binary');
        const mimeType = filePath.endsWith('.png') ? 'image/png' : 'image/jpeg';
        image = `data:${mimeType};base64,${buffer.toString('base64')}`;
      }
    } catch (err) {
      console.error('[telegram] failed to download photo:', err.message);
    }
  }

  // Handle video from Telegram
  if (telegramMessage.video) {
    const tgVideo = telegramMessage.video;
    try {
      const fileRes = await axios.get(`${TELEGRAM_API_URL}/getFile`, {
        params: { file_id: tgVideo.file_id }
      });
      const filePath = fileRes.data?.result?.file_path;
      if (filePath && TELEGRAM_BOT_TOKEN) {
        const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${filePath}`;
        const vidRes = await axios.get(fileUrl, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(vidRes.data, 'binary');
        video = `data:video/mp4;base64,${buffer.toString('base64')}`;
      }
    } catch (err) {
      console.error('[telegram] failed to download video:', err.message);
    }
  }

  // Handle voice/audio from Telegram
  let audio = null;
  if (telegramMessage.voice || telegramMessage.audio) {
    const tgAudio = telegramMessage.voice || telegramMessage.audio;
    try {
      const fileRes = await axios.get(`${TELEGRAM_API_URL}/getFile`, {
        params: { file_id: tgAudio.file_id }
      });
      const filePath = fileRes.data?.result?.file_path;
      if (filePath && TELEGRAM_BOT_TOKEN) {
        const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${filePath}`;
        const audRes = await axios.get(fileUrl, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(audRes.data, 'binary');
        const mimeType = telegramMessage.voice ? 'audio/ogg' : (tgAudio.mime_type || 'audio/mpeg');
        audio = `data:${mimeType};base64,${buffer.toString('base64')}`;
      }
    } catch (err) {
      console.error('[telegram] failed to download audio:', err.message);
    }
  }

  // Handle document/file from Telegram
  let file = null;
  if (telegramMessage.document) {
    const tgDoc = telegramMessage.document;
    console.log(`[telegram] 📎 Document received: ${tgDoc.file_name || 'unknown'} (${tgDoc.mime_type}, ${tgDoc.file_size} bytes)`);
    try {
      const fileRes = await axios.get(`${TELEGRAM_API_URL}/getFile`, {
        params: { file_id: tgDoc.file_id }
      });
      const filePath = fileRes.data?.result?.file_path;
      if (filePath && TELEGRAM_BOT_TOKEN) {
        const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${filePath}`;
        const docRes = await axios.get(fileUrl, { responseType: 'arraybuffer', timeout: 60000 });
        const buffer = Buffer.from(docRes.data);
        const mimeType = tgDoc.mime_type || 'application/octet-stream';
        const base64Data = `data:${mimeType};base64,${buffer.toString('base64')}`;
        file = {
          name: tgDoc.file_name || 'file',
          mimeType,
          size: tgDoc.file_size || buffer.length,
          data: base64Data,
        };
        console.log(`[telegram] ✅ Document downloaded successfully: ${file.name} (${buffer.length} bytes)`);
      } else {
        console.error('[telegram] ❌ Could not get file path for document');
      }
    } catch (err) {
      console.error('[telegram] ❌ Failed to download document:', err.message);
    }

    if (!file) {
      const fName = tgDoc.file_name || 'tệp';
      const fSize = formatFileSize(tgDoc.file_size || 0);
      const errorNotice = `⚠️ [Admin gửi tệp "${fName}" ${fSize ? '(' + fSize + ')' : ''} qua Telegram nhưng không thể tải về (file >20MB hoặc lỗi mạng)]`;
      text = text ? `${text}\n${errorNotice}` : errorNotice;
    }
  }

  if (!text && !image && !video && !audio && !file) {
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

  const cleanedText = cleanTelegramReplyText(text);

  const replyMessage = buildMessage({
    sessionId,
    role: 'telegram',
    user: getTelegramSenderName(telegramMessage.from),
    text: cleanedText,
    image,
    video,
    audio,
    file,
    source: 'telegram',
  });

  // Lưu ID Telegram để có thể xóa/sửa sau này từ phía Web
  replyMessage.telegramMessageId = telegramMessage.message_id;

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
        allowed_updates: JSON.stringify(["message", "edited_message", "message_reaction", "callback_query"])
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
  const image = req.body?.image; // base64 string
  const video = req.body?.video; // base64 string
  const audio = req.body?.audio; // base64 string
  const file = req.body?.file;   // { name, mimeType, size, data } object
  const sessionId = String(req.body?.sessionId || '').trim();
  const user = normalizeDisplayName(req.body?.user) || 'Ban';

  if (!sessionId) {
    return res.status(400).json({ error: 'Missing sessionId' });
  }

  if (!text && !image && !video && !audio && !file) {
    return res.status(400).json({ error: 'Missing message content' });
  }

  const message = buildMessage({
    sessionId,
    role: 'visitor',
    user,
    text,
    image,
    video,
    audio,
    file,
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
    chatBotConfigured: Boolean(TELEGRAM_API_URL && TELEGRAM_CHAT_ID),
    authBotConfigured: Boolean(TELEGRAM_AUTH_API_URL && TELEGRAM_AUTH_CHAT_ID),
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

    // Thông báo cho admin về tài khoản mới qua Auth Bot
    if (TELEGRAM_AUTH_API_URL && TELEGRAM_AUTH_CHAT_ID) {
      const text = [
        `🆕 TÀI KHOẢN MỚI ĐƯỢC TẠO`,
        `━━━━━━━━━━━━━━━━━━━`,
        `👤 Tên: ${user.name}`,
        `📧 Email: ${user.email}`,
        `📅 Thời gian: ${formatTime()}`,
      ].join('\n');

      try {
        await axios.post(`${TELEGRAM_AUTH_API_URL}/sendMessage`, {
          chat_id: TELEGRAM_AUTH_CHAT_ID,
          text: text
        }, { timeout: 10000 });
      } catch (tgErr) {
        console.error('[telegram-auth] Failed to notify registration:', tgErr.message);
      }
    }

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

    // ── KIỂM TRA EMAIL CONFIG (SMTP hoặc Brevo HTTP API) ──
    if (!mailTransporter && !useBrevo) {
      console.warn(`[email] ⚠️ Cannot send reset email to ${result.userEmail} because no email service is configured`);
      return res.status(500).json({ error: 'Chức năng gửi mã OTP qua Email chưa được cấu hình hoặc đang gặp sự cố. Vui lòng liên hệ Admin.' });
    }

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

    // ── GỬI MÃ RESET QUA EMAIL (Brevo HTTP hoặc Gmail SMTP) ──
    if (useBrevo) {
      try {
        await axios.post('https://api.brevo.com/v3/smtp/email', {
          sender: {
            name: 'DNH.dev',
            email: GMAIL_USER || 'daohuy1701@gmail.com' // Sử dụng email người gửi đã verify trên Brevo
          },
          to: [
            {
              email: result.userEmail,
              name: result.userName
            }
          ],
          subject: `🔐 Mã đặt lại mật khẩu: ${result.resetCode}`,
          htmlContent: htmlContent
        }, {
          headers: {
            'accept': 'application/json',
            'api-key': BREVO_API_KEY,
            'content-type': 'application/json'
          },
          timeout: 10000
        });
        console.log(`[email] ✅ Reset code sent via Brevo HTTP API to ${result.userEmail}`);
      } catch (mailErr) {
        const errorDetail = mailErr.response?.data?.message || mailErr.message;
        console.error(`[email] ❌ Brevo API Send FAILED to ${result.userEmail}:`, errorDetail);
        return res.status(500).json({ error: `Không thể gửi OTP qua Brevo API: ${errorDetail}. Vui lòng liên hệ Admin.` });
      }
    } else if (mailTransporter) {
      try {
        await mailTransporter.sendMail({
          from: `"DNH.dev" <${GMAIL_USER}>`,
          to: result.userEmail,
          subject: `🔐 Mã đặt lại mật khẩu: ${result.resetCode}`,
          html: htmlContent,
        });
        console.log(`[email] ✅ Reset code successfully sent to ${result.userEmail}`);
      } catch (mailErr) {
        console.error(`[email] ❌ Send FAILED to ${result.userEmail}:`, mailErr.message);

        // Nếu có Telegram hoạt động, vẫn gửi OTP qua Telegram và gợi ý cách lấy
        let advice = '';
        if (TELEGRAM_AUTH_API_URL && TELEGRAM_AUTH_CHAT_ID) {
          advice = ' (Gợi ý: Nếu server chạy trên Render Free, cổng gửi mail SMTP bị chặn. Hãy kiểm tra Telegram Bot của Admin để lấy mã OTP!)';

          const telegramText = [
            `🔐 YÊU CẦU ĐẶT LẠI MẬT KHẨU (Gửi mail lỗi)`,
            `━━━━━━━━━━━━━━━━━━━`,
            `👤 ${result.userName} (${result.userEmail})`,
            `🔑 Mã xác thực: ${result.resetCode}`,
            `⏰ Hết hạn sau 15 phút`,
            `⚠️ Email không gửi được do lỗi: ${mailErr.message}`,
          ].join('\n');

          axios.post(`${TELEGRAM_AUTH_API_URL}/sendMessage`, {
            chat_id: TELEGRAM_AUTH_CHAT_ID,
            text: telegramText
          }, { timeout: 10000 }).catch(tgErr => {
            console.error('[telegram-auth] Fallback send failed:', tgErr.message);
          });
        }

        return res.status(500).json({ error: `Không thể gửi OTP qua email: ${mailErr.message}.${advice}` });
      }
    } else {
      console.warn(`[email] ⚠️ Cannot send reset email to ${result.userEmail} because no email service is configured`);
      return res.status(500).json({ error: 'Chức năng gửi mã OTP qua Email chưa được cấu hình. Vui lòng liên hệ Admin.' });
    }

    // ── CHẠY NGẦM: Thông báo qua Telegram (Không cần await, dùng khi email thành công) ──
    if (TELEGRAM_AUTH_API_URL && TELEGRAM_AUTH_CHAT_ID && result.resetCode) {
      const telegramText = [
        `🔐 YÊU CẦU ĐẶT LẠI MẬT KHẨU`,
        `━━━━━━━━━━━━━━━━━━━`,
        `👤 ${result.userName} (${result.userEmail})`,
        `🔑 Mã xác thực: ${result.resetCode}`,
        `⏰ Hết hạn sau 15 phút`,
      ].join('\n');

      axios.post(`${TELEGRAM_AUTH_API_URL}/sendMessage`, {
        chat_id: TELEGRAM_AUTH_CHAT_ID,
        text: telegramText
      }, { timeout: 10000 }).catch(err => {
        console.error('[telegram-auth] Background send failed:', err.message);
      });
    }

    // ✅ PHẢN HỒI THÀNH CÔNG CHO CLIENT
    return res.json({ message: 'Mã xác nhận đặt lại mật khẩu đã được gửi đến Gmail của bạn. Vui lòng kiểm tra hộp thư (cả mục Spam).' });

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

/**
 * POST /api/auth/google
 * Body: { idToken }
 * Đăng nhập hoặc đăng ký tự động bằng Google ID Token.
 */
app.post('/api/auth/google', async (req, res) => {
  try {
    const { user, token, isNewUser } = await googleLogin(req.body);

    // Thông báo cho admin qua Telegram nếu là user mới
    if (isNewUser && TELEGRAM_AUTH_API_URL && TELEGRAM_AUTH_CHAT_ID) {
      const text = [
        `🆕 TÀI KHOẢN MỚI (Google Sign-In)`,
        `━━━━━━━━━━━━━━━━━━━`,
        `👤 Tên: ${user.name}`,
        `📧 Email: ${user.email}`,
        `🔑 Đăng nhập qua: Google`,
        `📅 Thời gian: ${formatTime()}`,
      ].join('\n');

      try {
        await axios.post(`${TELEGRAM_AUTH_API_URL}/sendMessage`, {
          chat_id: TELEGRAM_AUTH_CHAT_ID,
          text: text
        }, { timeout: 10000 });
      } catch (tgErr) {
        console.error('[telegram-auth] Failed to notify Google registration:', tgErr.message);
      }
    }

    return res.status(isNewUser ? 201 : 200).json({
      message: isNewUser ? 'Đăng ký qua Google thành công!' : 'Đăng nhập qua Google thành công!',
      user,
      token,
    });
  } catch (err) {
    const status = err.statusCode || 500;
    return res.status(status).json({ error: err.message || 'Lỗi server.' });
  }
});

/**
 * GET /api/auth/google-client-id
 * Trả về Google Client ID cho frontend (không phải secret, an toàn để expose).
 */
app.get('/api/auth/google-client-id', (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID || '';
  return res.json({ clientId: clientId || null });
});

app.get('/', (req, res) => {
  res.json({
    service: 'Portfolio Chat API',
    status: 'running',
    docs: {
      'GET /api/messages': 'Lấy tin nhắn theo sessionId',
      'POST /api/messages': 'Gửi tin nhắn mới',
      'GET /api/health': 'Kiểm tra trạng thái server',
      'POST /api/auth/register': 'Đăng ký tài khoản mới',
      'POST /api/auth/login': 'Đăng nhập',
      'GET /api/auth/verify': 'Verify JWT token',
      'POST /api/auth/forgot-password': 'Yêu cầu mã đặt lại mật khẩu',
      'POST /api/auth/reset-password': 'Đặt lại mật khẩu bằng mã xác nhận',
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

    // RỜI KHỎI TẤT CẢ phòng cũ trước khi vào phòng mới
    // Đảm bảo mỗi socket chỉ ở trong 1 phòng chat duy nhất, tránh nhận nhầm tin nhắn
    for (const room of socket.rooms) {
      if (room !== socket.id) {
        socket.leave(room);
      }
    }

    socket.join(normalizedSessionId);
    socket.data.sessionId = normalizedSessionId;
    console.log(`[Socket] ${socket.id} joined room: ${normalizedSessionId}`);
    socket.emit('chat history', getSessionMessages(normalizedSessionId));
  });

  socket.on('chat:delete', async ({ sessionId, messageId }) => {
    const messages = getSessionMessages(sessionId);
    const index = messages.findIndex(m => m.id === messageId);
    if (index !== -1) {
      const msgToDelete = messages[index];

      // Nếu tin nhắn có ID Telegram, thực hiện xóa trên Telegram
      if (msgToDelete.telegramMessageId && TELEGRAM_API_URL && TELEGRAM_CHAT_ID) {
        try {
          await axios.post(`${TELEGRAM_API_URL}/deleteMessage`, {
            chat_id: TELEGRAM_CHAT_ID,
            message_id: msgToDelete.telegramMessageId
          });
          console.log(`[telegram] Deleted message ${msgToDelete.telegramMessageId}`);
        } catch (err) {
          console.error('[telegram] Failed to delete message:', err.response?.data || err.message);
        }
      }

      messages.splice(index, 1);
      io.to(sessionId).emit('chat:message_deleted', { messageId });
      await saveState();
    }
  });

  socket.on('chat:edit', async ({ sessionId, messageId, text }) => {
    const messages = getSessionMessages(sessionId);
    const msg = messages.find(m => m.id === messageId);
    if (msg) {
      msg.text = text;
      msg.isEdited = true;

      // Đồng bộ sửa tin nhắn sang Telegram
      if (msg.telegramMessageId && TELEGRAM_API_URL && TELEGRAM_CHAT_ID) {
        try {
          const newText = buildTelegramOutgoingText(msg);
          const isMedia = msg.image || msg.video || msg.audio;
          const method = isMedia ? 'editMessageCaption' : 'editMessageText';

          const payload = {
            chat_id: TELEGRAM_CHAT_ID,
            message_id: msg.telegramMessageId,
            [isMedia ? 'caption' : 'text']: newText
          };

          await axios.post(`${TELEGRAM_API_URL}/${method}`, payload);
          console.log(`[telegram] Edited message ${msg.telegramMessageId}`);
        } catch (err) {
          console.error('[telegram] Failed to edit message:', err.response?.data || err.message);
        }
      }

      io.to(sessionId).emit('chat:message_edited', { messageId, text });
      await saveState();
    }
  });

  socket.on('chat:reaction', async ({ sessionId, messageId, emoji }) => {
    const messages = getSessionMessages(sessionId);
    const msg = messages.find(m => m.id === messageId);
    if (msg) {
      if (!msg.telegramReactions) msg.telegramReactions = [];
      
      // Bot Telegram (Web) chỉ được phép có 1 cảm xúc trên 1 tin nhắn
      if (msg.webReaction === emoji) {
        msg.webReaction = null; // Toggle tắt
      } else {
        msg.webReaction = emoji; // Ghi đè cảm xúc cũ
      }

      // Tính tổng hợp lại cảm xúc
      msg.reactions = {};
      if (msg.webReaction) {
        msg.reactions[msg.webReaction] = 1;
      }
      msg.telegramReactions.forEach(e => {
        msg.reactions[e] = (msg.reactions[e] || 0) + 1;
      });

      // Đồng bộ sang Telegram
      if (msg.telegramMessageId && TELEGRAM_API_URL && TELEGRAM_CHAT_ID) {
        try {
          const reactionPayload = msg.webReaction ? [{ type: "emoji", emoji: msg.webReaction }] : [];
          
          await axios.post(`${TELEGRAM_API_URL}/setMessageReaction`, {
            chat_id: TELEGRAM_CHAT_ID,
            message_id: msg.telegramMessageId,
            reaction: reactionPayload,
            is_big: false
          });
          console.log(`[telegram] Synced reaction ${emoji} for message ${msg.telegramMessageId}`);
        } catch (err) {
          console.error('[telegram] Failed to sync reaction:', err.response?.data || err.message);
        }
      }

      io.to(sessionId).emit('chat:reaction', { messageId, reactions: msg.reactions });
      await saveState();
    }
  });
  socket.on('admin:join', ({ password } = {}) => {
    const now = Date.now();
    // Chỉ cho phép đăng nhập bằng mã OTP động gửi qua Telegram
    const isValidOTP = currentAdminOTP && password === currentAdminOTP && now < adminOTPExpiry;

    if (isValidOTP) {
      socket.join('admins');
      console.log(`[Socket] Admin ${socket.id} joined admins room`);
      socket.emit('admin:auth_success');

      // 📢 Gửi ngay các cuộc gọi đang chờ cho Admin vừa vào
      if (pendingCalls.size > 0) {
        pendingCalls.forEach((callData) => {
          socket.emit('call:incoming', callData);
        });
      }
    } else {
      socket.emit('chat error', { error: 'Mã OTP không đúng hoặc đã hết hạn' });
    }
  });



  // WebRTC & Video Call Signaling
  socket.on('call:request', async ({ sessionId }) => {
    console.log(`[VideoCall] 📢 Nhận yêu cầu gọi từ: ${sessionId}`);

    // ── Chống duplicate: nếu cuộc gọi cùng sessionId đã được xử lý trong 60 giây qua, bỏ qua ──
    const existing = pendingCalls.get(sessionId);
    const now = Date.now();
    if (existing && existing.requestedAt && (now - existing.requestedAt) < 60000) {
      console.log(`[VideoCall] ⚠️ Bỏ qua call:request trùng lặp từ ${sessionId} (cooldown 60s)`);
      // Vẫn emit call:incoming cho admin đang online (không gửi Telegram lần 2)
      socket.to('admins').emit('call:incoming', { sessionId, callerId: socket.id });
      return;
    }

    const adminsRoom = io.sockets.adapter.rooms.get('admins');
    const adminIsOnline = adminsRoom && adminsRoom.size > 0;

    if (!currentAdminOTP || now >= adminOTPExpiry) {
      currentAdminOTP = Math.floor(100000 + Math.random() * 900000).toString();
      adminOTPExpiry = now + 5 * 60 * 1000;
    }

    const callData = { sessionId, callerId: socket.id, requestedAt: now };
    pendingCalls.set(sessionId, callData);
    socket.to('admins').emit('call:incoming', callData);

    if (!adminIsOnline && TELEGRAM_AUTH_API_URL && TELEGRAM_AUTH_CHAT_ID) {
      const adminUrl = 'https://portfolioptit.vercel.app/admin.html';
      const text = [
        `📹 <b>CÓ CUỘC GỌI VIDEO MỚI!</b>`,
        `━━━━━━━━━━━━━━━━━━━`,
        `👤 Khách: <code>${sessionId}</code>`,
        `🔑 Mã OTP Admin: <b>${currentAdminOTP}</b>`,
        `⏳ Hiệu lực OTP: 5 phút`,
        `━━━━━━━━━━━━━━━━━━━`,
        `👉 Truy cập ngay trang Admin để bắt máy:`,
        `🌐 ${adminUrl}`
      ].join('\n');

      try {
        await axios.post(`${TELEGRAM_AUTH_API_URL}/sendMessage`, {
          chat_id: TELEGRAM_AUTH_CHAT_ID,
          text: text,
          parse_mode: 'HTML'
        });
      } catch (err) {
        console.error('[telegram-auth] Failed to notify video call:', err.message);
      }
    }
  });

  socket.on('call:accept', ({ sessionId }) => {
    console.log(`[VideoCall] Admin ${socket.id} accepted call from ${sessionId}`);
    pendingCalls.delete(sessionId); // Xóa khỏi hàng chờ khi đã bắt máy
    socket.to(sessionId).emit('call:accepted', { adminId: socket.id });
  });

  socket.on('call:reject', ({ sessionId }) => {
    pendingCalls.delete(sessionId); // Xóa khỏi hàng chờ khi từ chối
    socket.to(sessionId).emit('call:rejected');
  });

  socket.on('call:end', ({ targetId }) => {
    // Tìm và xóa khỏi hàng chờ nếu có
    for (const [sid, data] of pendingCalls.entries()) {
      if (sid === targetId || data.callerId === socket.id) {
        pendingCalls.delete(sid);
      }
    }

    if (targetId) {
      socket.to(targetId).emit('call:ended');
    } else {
      socket.broadcast.emit('call:ended');
    }
  });

  socket.on('webrtc:signal', ({ targetId, signal }) => {
    // Chuyển tiếp signal (offer, answer, ice-candidate) tới đích
    // targetId = socket ID của đối phương hoặc sessionId (room)
    socket.to(targetId).emit('webrtc:signal', { senderId: socket.id, signal });
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
