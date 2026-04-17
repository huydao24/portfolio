const express = require("express");
const path = require("path");
const { kv } = require("@vercel/kv"); // Import KV

const app = express();

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_OWNER_CHAT_ID = process.env.TELEGRAM_OWNER_CHAT_ID;

/* ───────── Hàm tiện ích ───────── */
function nowLabel() {
  return new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
}

/* ───────── Store với Vercel KV ───────── */

async function getSession(id) {
  let session = await kv.get(`session:${id}`);
  if (!session) {
    session = {
      id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [{
        role: "owner",
        sender: "Chu web",
        text: "Xin chào, bạn có thể để lại tin nhắn tại đây.",
        timeLabel: "Bây giờ",
        timestamp: Date.now(),
      }],
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

/* Các API xử lý tương tự, nhưng mỗi khi cần lấy `telegramMessageToSession` bạn truy xuất từ kv.get() */
