const express = require("express");
const path = require("path");
const { kv } = require("@vercel/kv");

const app = express();

// Đã fix: Trỏ thẳng vào thư mục hiện tại vì index.js đã nằm cùng file HTML
const STATIC_ROOT = path.join(__dirname, "api", "code");

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_OWNER_CHAT_ID = process.env.TELEGRAM_OWNER_CHAT_ID;

if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_OWNER_CHAT_ID) {
  console.error("Missing Telegram env variables");
}

/* ───────── Hàm tiện ích ───────── */
function nowLabel() {
  return new Date().toLocaleTimeString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function getSession(id) {
  let session = await kv.get(`session:${id}`);
  if (!session) {
    session = {
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
    await kv.set(`session:${id}`, session);
  }
  return session;
}

async function addMessage(sessionId, msg) {
  const session = await getSession(sessionId);
  const entry = {
    id: Date.now() + "-" + Math.random().toString(16).slice(2),
    timestamp: Date.now(),
    timeLabel: nowLabel(),
    ...msg,
  };
  session.messages.push(entry);
  session.updatedAt = entry.timestamp;
  await kv.set(`session:${sessionId}`, session);
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
    // Lưu message_id để Webhook biết đường reply lại web
    await kv.set(`tg_msg:${r.result.message_id}`, sessionId);
  }
}

/* ───────── App Routes (Các API xử lý) ───────── */
app.use(express.json());

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.get("/api/conversations/:id", async (req, res) => {
  try {
    const session = await getSession(req.params.id);
    res.json(session);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/conversations/:id/messages", async (req, res) => {
  try {
    const { text, senderName } = req.body;
    if (!text?.trim()) return res.status(400).json({ error: "Message required" });

    const msg = await addMessage(req.params.id, {
      role: "client",
      sender: senderName || "Client",
      text: text.trim(),
    });

    await sendToTelegram(req.params.id, senderName, text);

    res.json({ ok: true, message: msg });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/telegram/webhook", async (req, res) => {
  try {
    const m = req.body?.message;
    if (!m?.reply_to_message || !m.text) return res.send("ok");

    const sessionId = await kv.get(`tg_msg:${m.reply_to_message.message_id}`);

    if (sessionId) {
      await addMessage(sessionId, {
        role: "owner",
        sender: "Chu web",
        text: m.text,
      });
    }
  } catch (error) {
    console.error("Webhook error:", error);
  }
  res.send("ok");
});

// BẮT BUỘC PHẢI CÓ DÒNG NÀY ĐỂ VERCEL CHẠY ĐƯỢC
module.exports = app;
