const SESSION_STORAGE_KEY = "portfolio-contact-session";
const CLIENT_NAME_STORAGE_KEY = "portfolio-contact-client-name";
const POLL_INTERVAL_MS = 3000;

const telegramForm = document.getElementById("telegramForm");
const telegramInput = document.getElementById("teleInputContact");
const telegramStatus = document.getElementById("teleStatus");
const clientNameInput = document.getElementById("clientName");
const chatMessages = document.getElementById("chatMessages");
const submitButton = telegramForm?.querySelector('button[type="submit"]');

let messages = [];
let lastTimestamp = 0;
let pollTimer = 0;
let syncInFlight = false;

function createSessionId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return `session-${window.crypto.randomUUID()}`;
  }

  return `session-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

function getSessionId() {
  const savedSessionId = localStorage.getItem(SESSION_STORAGE_KEY);
  if (savedSessionId) {
    return savedSessionId;
  }

  const sessionId = createSessionId();
  localStorage.setItem(SESSION_STORAGE_KEY, sessionId);
  return sessionId;
}

const sessionId = getSessionId();

function setStatus(message, state) {
  if (!telegramStatus) {
    return;
  }

  telegramStatus.textContent = message;
  if (state) {
    telegramStatus.dataset.state = state;
  } else {
    delete telegramStatus.dataset.state;
  }
}

function createMessageKey(message) {
  return message.id || `${message.role}-${message.timestamp}-${message.text}`;
}

function updateLastTimestamp(newMessages) {
  for (const message of newMessages) {
    const timestamp = Number(message.timestamp || 0);
    if (timestamp > lastTimestamp) {
      lastTimestamp = timestamp;
    }
  }
}

function sortMessages(list) {
  return [...list].sort(
    (first, second) => Number(first.timestamp || 0) - Number(second.timestamp || 0)
  );
}

function mergeMessages(incomingMessages) {
  const merged = new Map(messages.map((message) => [createMessageKey(message), message]));

  for (const message of incomingMessages) {
    merged.set(createMessageKey(message), message);
  }

  messages = sortMessages([...merged.values()]);
  updateLastTimestamp(incomingMessages);
}

function createMessageElement(message) {
  const article = document.createElement("article");
  article.className = `chat-message ${message.role}`;

  const meta = document.createElement("div");
  meta.className = "chat-meta";
  meta.textContent = `${message.sender} - ${message.timeLabel || "Bay gio"}`;

  const bubble = document.createElement("div");
  bubble.className = "chat-bubble";
  bubble.textContent = message.text;

  article.append(meta, bubble);
  return article;
}

function renderMessages() {
  if (!chatMessages) {
    return;
  }

  chatMessages.innerHTML = "";
  messages.forEach((message) => {
    chatMessages.appendChild(createMessageElement(message));
  });
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

async function readJson(response) {
  try {
    return await response.json();
  } catch (error) {
    return {};
  }
}

async function fetchConversation(since = 0) {
  const query = since > 0 ? `?since=${encodeURIComponent(since)}` : "";
  const response = await fetch(
    `/api/conversations/${encodeURIComponent(sessionId)}${query}`,
    {
      headers: {
        Accept: "application/json",
      },
    }
  );

  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(payload.error || "Failed to load conversation");
  }

  return payload;
}

async function sendConversationMessage(senderName, text) {
  const response = await fetch(
    `/api/conversations/${encodeURIComponent(sessionId)}/messages`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        senderName,
        text,
      }),
    }
  );

  const payload = await readJson(response);
  if (payload.message) {
    mergeMessages([payload.message]);
    renderMessages();
  }

  if (!response.ok) {
    const error = new Error(payload.error || "Failed to send message");
    error.payload = payload;
    throw error;
  }

  return payload;
}

async function syncConversation(options = {}) {
  const { incremental = false, silent = false } = options;

  if (syncInFlight) {
    return;
  }

  syncInFlight = true;

  try {
    const payload = await fetchConversation(incremental ? lastTimestamp : 0);

    if (incremental) {
      if (Array.isArray(payload.messages) && payload.messages.length > 0) {
        mergeMessages(payload.messages);
        renderMessages();
      }
    } else {
      messages = sortMessages(Array.isArray(payload.messages) ? payload.messages : []);
      updateLastTimestamp(messages);
      renderMessages();
    }

    if (payload.updatedAt) {
      lastTimestamp = Math.max(lastTimestamp, Number(payload.updatedAt) || 0);
    }

    if (clientNameInput && !clientNameInput.value && payload.clientName) {
      clientNameInput.value = payload.clientName;
      localStorage.setItem(CLIENT_NAME_STORAGE_KEY, payload.clientName);
    }

    if (!silent) {
      setStatus(
        "Da ket noi chat. Chu web co the tra loi tu Telegram va tin nhan se hien tai day.",
        "success"
      );
    }
  } catch (error) {
    if (!silent) {
      setStatus(
        "Khong ket noi duoc chat. Hay mo trang nay qua server va chay `npm start`.",
        "error"
      );
    }
    console.error(error);
  } finally {
    syncInFlight = false;
  }
}

function startPolling() {
  if (pollTimer) {
    window.clearInterval(pollTimer);
  }

  pollTimer = window.setInterval(() => {
    if (!document.hidden) {
      syncConversation({ incremental: true, silent: true });
    }
  }, POLL_INTERVAL_MS);
}

if (clientNameInput) {
  const savedClientName = localStorage.getItem(CLIENT_NAME_STORAGE_KEY);
  if (savedClientName) {
    clientNameInput.value = savedClientName;
  }

  clientNameInput.addEventListener("change", () => {
    localStorage.setItem(CLIENT_NAME_STORAGE_KEY, clientNameInput.value.trim());
  });
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    syncConversation({ incremental: true, silent: true });
  }
});

if (telegramForm && telegramInput) {
  telegramForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const text = telegramInput.value.trim();
    const senderName = clientNameInput ? clientNameInput.value.trim() : "";

    if (!text) {
      setStatus("Vui long nhap noi dung truoc khi gui.", "error");
      return;
    }

    if (clientNameInput) {
      localStorage.setItem(CLIENT_NAME_STORAGE_KEY, senderName);
    }

    if (submitButton) {
      submitButton.disabled = true;
    }
    setStatus("Dang gui tin nhan...", "loading");

    try {
      await sendConversationMessage(senderName, text);
      telegramInput.value = "";
      setStatus(
        "Da gui sang Telegram. Chu web chi can reply trong Telegram de tra loi lai tren web.",
        "success"
      );
      await syncConversation({ incremental: true, silent: true });
    } catch (error) {
      if (error.payload && error.payload.saved) {
        setStatus(
          "Tin nhan da duoc luu tren web nhung chua day sang Telegram. Vui long thu lai sau.",
          "error"
        );
      } else {
        setStatus("Khong gui duoc tin nhan. Vui long thu lai sau.", "error");
      }
      console.error(error);
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
      }
    }
  });
}

syncConversation();
startPolling();
