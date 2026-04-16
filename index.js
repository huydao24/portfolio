const express = require("express");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");

const app = express();

const STATIC_ROOT = path.join(__dirname, "code");
const STORE_PATH = path.join("/tmp", "chat-store.json");

const TELEGRAM_BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN || "8560536702:AAHk4rvMiFDIYcFI2_ye2IH-GzyUwg7ew8s";
const TELEGRAM_OWNER_CHAT_ID =
  process.env.TELEGRAM_OWNER_CHAT_ID || "5953252108";

let store = {
  lastUpdateId: 0,
  sessions: {},
  telegramMessageToSession: {},
};

// ─── Store Helpers ────────────────────────────────────────────────────────────

async function ensureStoreLoaded() {
  try {
    if (fs.existsSync(STORE_PATH)) {
      const raw = await fsp.readFile(STORE_PATH, "utf8");
      const parsed = JSON.parse(raw);
      store = {
        lastUpdateId: Number(parsed.lastUpdateId || 0),
        sessions: parsed.sessions || {},
        telegramMessageToSession: parsed.telegramMessageToSession || {},
      };
    }
  } catch (error) {
    console.error("Failed to load chat store:", error);
  }
}

async function persistStore() {
  try {
    await fsp.writeFile(STORE_PATH, JSON.stringify(store, null, 2), "utf8");
  } catch (error) {
    console.error("Failed to persist chat store:", error);
  }
}

// ─── Session / Message Helpers ────────────────────────────────────────────────

function nowTimeLabel() {
  return new Date().toLocaleTimeString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildWelcomeMessages() {
  const baseTimestamp = Date.now();
  return [
    {
      role: "owner",
      sender: "Chu web",
      text: "Xin chào, mình là Huy. Bạn có thể để lại nhu cầu, dự án hoặc cách liên hệ phù hợp ngay tại đây.",
      timeLabel: "Bây giờ",
      timestamp: baseTimestamp,
    },
    {
      role: "owner",
      sender: "Chu web",
      text: "Mọi phản hồi từ Telegram sẽ được đồng bộ ngược lại vào khung chat này.",
      timeLabel: "Bây giờ",
      timestamp: baseTimestamp + 1,
    },
  ];
}

function getSession(sessionId) {
  if (!store.sessions[sessionId]) {
    store.sessions[sessionId] = {
      id: sessionId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      clientName: "",
      messages: buildWelcomeMessages(),
    };
  }
  return store.sessions[sessionId];
}

function addMessage(sessionId, message) {
  const session = getSession(sessionId);
  const entry = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    timestamp: Date.now(),
    timeLabel: nowTimeLabel(),
    ...message,
  };
  session.messages.push(entry);
  session.updatedAt = entry.timestamp;
  return entry;
}

// ─── Telegram ─────────────────────────────────────────────────────────────────

async function callTelegram(method, params) {
  const response = await fetch(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    }
  );
  return response.json();
}

async function forwardClientMessageToTelegram(sessionId, senderName, text) {
  const messageText = `Tin nhắn mới từ [session:${sessionId}]\nTên: ${
    senderName || "Khách"
  }\n\n${text}`;
  const result = await callTelegram("sendMessage", {
    chat_id: TELEGRAM_OWNER_CHAT_ID,
    text: messageText,
  });
  if (result.ok) {
    store.telegramMessageToSession[String(result.result.message_id)] =
      sessionId;
  }
  return result;
}

async function pollTelegramUpdates() {
  try {
    const result = await callTelegram("getUpdates", {
      offset: store.lastUpdateId + 1,
      timeout: 10,
      allowed_updates: ["message"],
    });

    if (!result.ok || !result.result.length) return;

    for (const update of result.result) {
      store.lastUpdateId = update.update_id;

      const message = update.message;
      if (!message || !message.reply_to_message) continue;

      const originalMsgId = String(message.reply_to_message.message_id);
      const sessionId = store.telegramMessageToSession[originalMsgId];

      if (sessionId) {
        addMessage(sessionId, {
          role: "owner",
          sender: "Chu web",
          text: message.text,
        });
        console.log(
          `[Telegram] Reply từ chủ web vào session ${sessionId}: ${message.text}`
        );
        await persistStore();
      }
    }
  } catch (error) {
    console.error("[Telegram] Polling error:", error.message);
  }
}

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(express.json());

// Load store before every request
app.use(async (req, res, next) => {
  await ensureStoreLoaded();
  next();
});

// ─── API Routes ───────────────────────────────────────────────────────────────

// Health check
app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

// Get conversation session
app.get("/api/conversations/:sessionId", (req, res) => {
  const session = getSession(req.params.sessionId);
  res.json(session);
});

// Post a message to a conversation
app.post("/api/conversations/:sessionId/messages", async (req, res) => {
  const { sessionId } = req.params;
  const text = String(req.body.text || "").trim();

  if (!text) {
    return res.status(400).json({ error: "Message is required" });
  }

  const message = addMessage(sessionId, {
    role: "client",
    sender: req.body.senderName || "Client",
    text,
  });

  await forwardClientMessageToTelegram(sessionId, req.body.senderName, text);
  await persistStore();

  res.status(201).json({ ok: true, message });
});

// ─── Static Files ─────────────────────────────────────────────────────────────

// Security middleware: block path traversal
app.use((req, res, next) => {
  const filePath = path.join(STATIC_ROOT, req.path);
  if (!filePath.startsWith(STATIC_ROOT)) {
    return res.status(403).send("Forbidden");
  }
  next();
});

app.use(express.static(STATIC_ROOT));

// Catch-all 404 for unmatched routes
app.use((req, res) => {
  res.status(404).send("Not Found");
});

// ─── Start Server ─────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;

ensureStoreLoaded().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
    console.log(`[Telegram] Bắt đầu polling...`);
    setInterval(pollTelegramUpdates, 2000);
  });
});

// Export for Vercel (serverless)
module.exports = app;

