const express = require("express");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");

const app = express();

/* ───────── Config ───────── */

const STATIC_ROOT = path.join(__dirname, "code");
const STORE_PATH = "/tmp/chat-store.json";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_OWNER_CHAT_ID = process.env.TELEGRAM_OWNER_CHAT_ID;

if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_OWNER_CHAT_ID) {
  console.error("Missing Telegram env variables");
}

/* ───────── Store ───────── */

let store = {
  sessions: {},
  telegramMessageToSession: {},
};

async function loadStore() {
  try {
    if (fs.existsSync(STORE_PATH)) {
      const raw = await fsp.readFile(STORE_PATH, "utf8");
      if (raw.trim()) store = JSON.parse(raw);
    }
  } catch {
    store = { sessions: {}, telegramMessageToSession: {} };
  }
}

async function saveStore() {
  await fsp.writeFile(STORE_PATH, JSON.stringify(store, null, 2));
}

function nowLabel() {
  return new Date().toLocaleTimeString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getSession(id) {
  if (!store.sessions[id]) {
    store.sessions[id] = {
      id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [
        {
          role: "owner",
          sender: "Chu web",
          text: "Xin chào, bạn có thể để lại tin nhắn tại đây.",
          timeLabel: "Bây giờ",
          timestamp: Date.now(),
        },
      ],
    };
  }
  return store.sessions[id];
}

function addMessage(sessionId, msg) {
  const s = getSession(sessionId);
  const entry = {
    id: Date.now() + "-" + Math.random().toString(16).slice(2),
    timestamp: Date.now(),
    timeLabel: nowLabel(),
    ...msg,
  };
  s.messages.push(entry);
  s.updatedAt = entry.timestamp;
  return entry;
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
    store.telegramMessageToSession[r.result.message_id] = sessionId;
  }
}

/* ───────── App ───────── */

app.use(express.json());

app.use(async (req, res, next) => {
  await loadStore();
  next();
});

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.get("/api/conversations/:id", (req, res) =>
  res.json(getSession(req.params.id))
);

app.post("/api/conversations/:id/messages", async (req, res) => {
  const { text, senderName } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: "Message required" });

  const msg = addMessage(req.params.id, {
    role: "client",
    sender: senderName || "Client",
    text: text.trim(),
  });

  await sendToTelegram(req.params.id, senderName, text);
  await saveStore();

  res.json({ ok: true, message: msg });
});

app.post("/api/telegram/webhook", async (req, res) => {
  try {   
    const m = req.body?.message;
    if (!m?.reply_to_message || !m.text) return res.send("ok");

    const sessionId =
      store.telegramMessageToSession[m.reply_to_message.message_id];

    if (sessionId) {
      addMessage(sessionId, {
        role: "owner",
        sender: "Chu web",
        text: m.text,
      });
      await saveStore();
    }
  } catch {}
  res.send("ok");
});

app.use(express.static(STATIC_ROOT));
app.use((req, res) => res.status(404).send("Not Found"));

module.exports = app;
