const express = require("express");
const path = require("path");
// ... các require khác ...

const app = express();
app.use(express.json());

// ... (Giữ nguyên các hàm helper tạo session, gửi tin nhắn) ...

// 1. API Gửi tin nhắn từ Web lên Telegram (Giữ nguyên)
app.post("/api/conversations/:sessionId/messages", async (req, res) => {
  // ... code cũ của bạn ...
});

// 2. THÊM MỚI: API Nhận tin nhắn từ Telegram trả về Web
app.post("/api/telegram-webhook", async (req, res) => {
  const update = req.body;
  const message = update?.message;

  if (message && message.reply_to_message) {
    const originalMsgId = String(message.reply_to_message.message_id);
    const sessionId = store.telegramMessageToSession[originalMsgId];

    if (sessionId) {
      addMessage(sessionId, {
        role: "owner",
        sender: "Chu web",
        text: message.text,
      });
      // Lưu lại vào DB ở đây
      await persistStore();
    }
  }
  res.status(200).send("OK"); // Phải có dòng này để báo Telegram là đã nhận
});

// 3. Khởi động server (XÓA BỎ setInterval ở đây)
const PORT = process.env.PORT || 3000;
ensureStoreLoaded().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
    // Đã xóa setInterval polling ở đây!
  });
});

module.exports = app;
