const express = require("express");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const fetch = require("node-fetch");

const app = express();

/* ───────── Config ───────── */

const STATIC_ROOT = path.join(__dirname, "code");
const STORE_PATH = "/tmp/chat-store.json";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_OWNER_CHAT_ID = process.env.TELEGRAM_OWNER_CHAT_ID;

if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_OWNER_CHAT_ID) {
  throw new Error("Missing Telegram env variables");
}

/* ───────── In-memory store ───────── */

let store = {
  sessions: {},
  telegramMessageToSession: {},
};

/* ───────── Store helpers ───────── */

async function loadStore() {
  try {
    if (fs.existsSync(STORE_PATH)) {
      const raw = await fsp.readFile(STORE_PATH, "utf8");
      if (raw && raw.trim()) {
        store = JSON.parse(raw);
      }
    }
  } catch (err) {
    console.error("Load store error:", err.message);
    store = { sessions: {}, telegramMessageToSession: {} };
  }
}

async function saveStore() {
  try {
    await fsp.writeFile(STORE_PATH, JSON.stringify(store, null, 2));
  } catch (err) {
    console.error("Save store error:", err.message);
  }
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

/* ───────── Telegram helpers ───────── */

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
  const msg = `💬 Tin nhắn mới\nSession: ${sessionId}\nTên: ${
    sender || "Khách"
  }\n\n${text}`;

  const r = await telegram("sendMessage", {
    chat_id: TELEGRAM_OWNER_CHAT_ID,
    text: msg,
  });

  if (r.ok && r.result?.message_id) {
    store.telegramMessageToSession[r.result.message_id] = sessionId;
  }
}

/* ───────── Middleware ───────── */

app.use(express.json());

app.use(async (req, res, next) => {
  await loadStore();
  next();
});

/* ───────── API ───────── */

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

app.get("/api/conversations/:id", (req, res) => {
  res.json(getSession(req.params.id));
});

app.post("/api/conversations/:id/messages", async (req, res) => {
  try {
    const { text, senderName } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ error: "Message required" });
    }

    const msg = addMessage(req.params.id, {
      role: "client",
      sender: senderName || "Client",
      text: text.trim(),
    });

    await sendToTelegram(req.params.id, senderName, text.trim());
    await saveStore();

    res.json({ ok: true, message: msg });
  } catch (err) {
    console.error("Send message error:", err);
    res.status(500).json({ error: "Internal error" });
  }
});

/* ───────── Telegram Webhook ───────── */

app.post("/api/telegram/webhook", async (req, res) => {
  try {
    const update = req.body;
    if (!update || !update.message) {
      return res.status(200).send("ok");
    }

    const m = update.message;
    if (!m.reply_to_message || !m.text) {
      return res.status(200).send("ok");
    }

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

    res.status(200).send("ok");
  } catch (err) {
    console.error("Webhook error:", err);
    res.status(200).send("ok"); // Telegram luôn cần 200
  }
});

/* ───────── Static ───────── */

app.use(express.static(STATIC_ROOT));

app.use((req, res) => {
  res.status(404).send("Not Found");
});

/* ───────── Export for Vercel ───────── */

module.exports = app;
