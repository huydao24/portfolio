const express = require("express");
const path = require("path");

const app = express();

/* ───────── Config ───────── */

const STATIC_ROOT = path.join(__dirname, "code");

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_OWNER_CHAT_ID = process.env.TELEGRAM_OWNER_CHAT_ID;
const UPSTASH_REDIS_REST_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_REDIS_REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_OWNER_CHAT_ID) {
  console.error("Missing Telegram env variables");
}
if (!UPSTASH_REDIS_REST_URL || !UPSTASH_REDIS_REST_TOKEN) {
  console.error("Missing Upstash Redis env variables");
}

/* ───────── Redis (Upstash REST) ───────── */
// Dùng fetch thuần, không cần cài thêm package

async function redisGet(key) {
  const res = await fetch(`${UPSTASH_REDIS_REST_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}` },
  });
  const data = await res.json();
  if (!data.result) return null;
  try {
    return JSON.parse(data.result);
  } catch {
    return data.result;
  }
}

async function redisSet(key, value) {
  await fetch(`${UPSTASH_REDIS_REST_URL}/set/${encodeURIComponent(key)}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(JSON.stringify(value)),
  });
}

/* ───────── Helpers ───────── */

function nowLabel() {
  return new Date().toLocaleTimeString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function makeMessage(msg) {
  return {
    id: Date.now() + "-" + Math.random().toString(16).slice(2),
    timestamp: Date.now(),
    timeLabel: nowLabel(),
    ...msg,
  };
}

/* ───────── Session ───────── */

async function getSession(id) {
  const existing = await redisGet(`session:${id}`);
  if (existing) return existing;

  const session = {
    id,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [
      makeMessage({
        id: "init",
        role: "owner",
        sender: "Chu web",
        text: "Xin chào, bạn có thể để lại tin nhắn tại đây.",
        timeLabel: "Bây giờ",
      }),
    ],
  };
  await redisSet(`session:${id}`, session);
  return session;
}

async function saveSession(session) {
  session.updatedAt = Date.now();
  await redisSet(`session:${session.id}`, session);
}

/* ───────── Telegram map ───────── */

async function getTelegramMap() {
  return (await redisGet("telegram:map")) || {};
}

async function saveTelegramMap(map) {
  await redisSet("telegram:map", map);
}

/* ───────── Telegram ───────── */

async function telegram(method, payload) {
  const res = await fetch(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );
  return res.json();
}

async function sendToTelegram(sessionId, sender, text) {
  const r = await telegram("sendMessage", {
    chat_id: TELEGRAM_OWNER_CHAT_ID,
    text: `💬 ${sender || "Khách"}\n\n${text}`,
  });

  if (r.ok) {
    const map = await getTelegramMap();
    map[r.result.message_id] = sessionId;
    await saveTelegramMap(map);
  }
}

/* ───────── App ───────── */

app.use(express.json());

app.get("/api/health", (req, res) => res.json({ ok: true }));

// Lấy session — contact.js gọi không có ?since (load lần đầu)
// hoặc có ?since=timestamp (incremental poll)
app.get("/api/conversations/:id", async (req, res) => {
  try {
    const since = parseInt(req.query.since) || 0;
    const session = await getSession(req.params.id);

    if (since > 0) {
      const newMessages = session.messages.filter((m) => m.timestamp > since);
      return res.json({ messages: newMessages, updatedAt: session.updatedAt });
    }

    res.json(session);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// Gửi tin nhắn từ client
app.post("/api/conversations/:id/messages", async (req, res) => {
  const { text, senderName } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: "Message required" });

  try {
    const session = await getSession(req.params.id);
    const msg = makeMessage({
      role: "client",
      sender: senderName || "Khách",
      text: text.trim(),
    });

    session.messages.push(msg);
    await saveSession(session);
    await sendToTelegram(req.params.id, senderName, text.trim());

    res.json({ ok: true, message: msg });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// Webhook Telegram — owner reply trong Telegram → hiện lên web
app.post("/api/telegram/webhook", async (req, res) => {
  try {
    const m = req.body?.message;
    if (!m?.reply_to_message || !m.text) return res.send("ok");

    const map = await getTelegramMap();
    const sessionId = map[m.reply_to_message.message_id];

    if (sessionId) {
      const session = await getSession(sessionId);
      session.messages.push(
        makeMessage({ role: "owner", sender: "Chu web", text: m.text })
      );
      await saveSession(session);
    }
  } catch (e) {
    console.error(e);
  }
  res.send("ok");
});

app.use(express.static(STATIC_ROOT));
app.use((req, res) => res.status(404).send("Not Found"));

module.exports = app;
