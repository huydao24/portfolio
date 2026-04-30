const cursor = document.getElementById('cursor');
const ring = document.getElementById('cursorRing');
let mx = 0;
let my = 0;
let rx = 0;
let ry = 0;

document.addEventListener('mousemove', e => {
  mx = e.clientX;
  my = e.clientY;
});

function animCursor() {
  cursor.style.left = `${mx}px`;
  cursor.style.top = `${my}px`;
  rx += (mx - rx) * 0.15;
  ry += (my - ry) * 0.15;
  ring.style.left = `${rx}px`;
  ring.style.top = `${ry}px`;
  requestAnimationFrame(animCursor);
}

animCursor();

document.querySelectorAll('a, button, .project-card, .stat-card, .skill-group').forEach(el => {
  el.addEventListener('mouseenter', () => {
    cursor.style.transform = 'translate(-50%,-50%) scale(2)';
    ring.style.width = '60px';
    ring.style.height = '60px';
    ring.style.opacity = '0.3';
  });

  el.addEventListener('mouseleave', () => {
    cursor.style.transform = 'translate(-50%,-50%) scale(1)';
    ring.style.width = '36px';
    ring.style.height = '36px';
    ring.style.opacity = '0.5';
  });
});

const statuses = [
  'Học & Lập trình',
  'Tìm kiếm cơ hội mới',
  'Đam mê sáng tạo',
  'Open for collaboration',
];

let si = 0;
let ci = 0;
let deleting = false;
const typedEl = document.querySelector('.typed-text');

function typeEffect() {
  const current = statuses[si];

  if (!deleting) {
    typedEl.textContent = current.substring(0, ci + 1);
    ci += 1;
    if (ci === current.length) {
      deleting = true;
      setTimeout(typeEffect, 1800);
      return;
    }
  } else {
    typedEl.textContent = current.substring(0, ci - 1);
    ci -= 1;
    if (ci === 0) {
      deleting = false;
      si = (si + 1) % statuses.length;
    }
  }

  setTimeout(typeEffect, deleting ? 50 : 90);
}

setTimeout(typeEffect, 1200);

const observer = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
    }
  });
}, { threshold: 0.12 });

document.querySelectorAll('.reveal').forEach(el => observer.observe(el));
document.querySelectorAll('.timeline-item').forEach(el => observer.observe(el));

const sections = document.querySelectorAll('section[id]');
const navLinks = document.querySelectorAll('.nav-links a');

window.addEventListener('scroll', () => {
  let current = '';
  sections.forEach(section => {
    if (window.scrollY >= section.offsetTop - 200) {
      current = section.id;
    }
  });

  navLinks.forEach(link => {
    link.style.color = link.getAttribute('href') === `#${current}`
      ? 'var(--secondary)'
      : '';
  });
});

// --- MOBILE MENU LOGIC ---
const mobileMenuBtn = document.getElementById('mobile-menu-btn');
const mobileMenuClose = document.getElementById('mobile-menu-close');
const mobileMenu = document.getElementById('mobile-menu');
const mobileLinks = document.querySelectorAll('.mobile-nav-links a');

function toggleMobileMenu() {
  if (mobileMenu) {
    mobileMenu.classList.toggle('active');
    document.body.style.overflow = mobileMenu.classList.contains('active') ? 'hidden' : '';
  }
}

if (mobileMenuBtn) mobileMenuBtn.addEventListener('click', toggleMobileMenu);
if (mobileMenuClose) mobileMenuClose.addEventListener('click', toggleMobileMenu);

mobileLinks.forEach(link => {
  link.addEventListener('click', () => {
    mobileMenu.classList.remove('active');
    document.body.style.overflow = '';
  });
});

const DEFAULT_CHAT_BACKEND_URL =
  window.location.protocol === 'file:' || ['localhost', '127.0.0.1'].includes(window.location.hostname)
    ? 'http://localhost:3000'
    : 'https://portfolio-1-yjvu.onrender.com';

const CHAT_BACKEND_URL = window.CHAT_BACKEND_URL || DEFAULT_CHAT_BACKEND_URL;
const CHAT_SESSION_KEY = 'portfolio-chat-session-id';
const CHAT_NAME_KEY = 'portfolio-chat-user-name';

const chatBtn = document.getElementById('chat-float-btn');
const chatPopover = document.getElementById('chat-popover');
const chatCloseBtn = document.getElementById('chat-close-btn');
const chatMessages = document.getElementById('chat-messages');
const chatForm = document.getElementById('chat-form');
const chatNameInput = document.getElementById('chat-name-input');
const chatInput = document.getElementById('chat-input');

let socket = null;

function getChatSessionId() {
  const existing = localStorage.getItem(CHAT_SESSION_KEY);
  if (existing) {
    return existing;
  }

  const generated = window.crypto?.randomUUID?.()
    ? window.crypto.randomUUID()
    : `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  localStorage.setItem(CHAT_SESSION_KEY, generated);
  return generated;
}

const chatSessionId = getChatSessionId();

function normalizeChatName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 40);
}

function getStoredChatName() {
  return normalizeChatName(localStorage.getItem(CHAT_NAME_KEY));
}

function persistChatName() {
  const normalizedName = normalizeChatName(chatNameInput?.value);

  if (normalizedName) {
    localStorage.setItem(CHAT_NAME_KEY, normalizedName);
  } else {
    localStorage.removeItem(CHAT_NAME_KEY);
  }

  if (chatNameInput) {
    chatNameInput.value = normalizedName;
  }

  return normalizedName || 'Ban';
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

function appendChatMsg(message) {
  if (!message?.text) {
    return;
  }

  const bubble = document.createElement('div');
  const bubbleType = message.role === 'visitor'
    ? 'mine'
    : message.role === 'system'
      ? 'system'
      : 'theirs';

  bubble.className = `chat-bubble ${bubbleType}`;
  bubble.innerHTML = `
    <div class="chat-bubble-head">
      <span class="chat-bubble-user">${escapeHtml(message.user || 'Chat')}</span>
      <span class="chat-bubble-time">${escapeHtml(message.time || '')}</span>
    </div>
    <div class="chat-bubble-text">${escapeHtml(message.text)}</div>
  `;

  chatMessages.appendChild(bubble);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function renderChatHistory(messages = []) {
  chatMessages.innerHTML = '';
  messages.forEach(appendChatMsg);
}

function loadChatHistory() {
  if (typeof axios === 'undefined') {
    appendChatMsg({
      role: 'system',
      user: 'He thong',
      text: 'Thu vien HTTP chua san sang.',
      time: '',
    });
    return Promise.resolve();
  }

  return axios.get(`${CHAT_BACKEND_URL}/api/messages`, {
    params: { sessionId: chatSessionId },
  }).then(response => {
    renderChatHistory(response.data);
  }).catch(() => {
    appendChatMsg({
      role: 'system',
      user: 'He thong',
      text: 'Khong tai duoc lich su chat.',
      time: '',
    });
  });
}

function initChatSocket() {
  if (typeof io !== 'function') {
    appendChatMsg({
      role: 'system',
      user: 'He thong',
      text: 'Khong nap duoc ket noi realtime tu server.',
      time: '',
    });
    return;
  }

  socket = io(CHAT_BACKEND_URL);

  socket.on('connect', () => {
    socket.emit('chat:join', { sessionId: chatSessionId });
  });

  socket.on('chat history', renderChatHistory);
  socket.on('chat message', appendChatMsg);
  socket.on('chat error', payload => {
    appendChatMsg({
      role: 'system',
      user: 'He thong',
      text: payload?.error || 'Ket noi chat gap loi.',
      time: '',
    });
  });
}

function openChat() {
  chatPopover.classList.remove('hidden');
  if (chatNameInput) {
    chatNameInput.value = getStoredChatName();
  }

  if (chatNameInput && !chatNameInput.value) {
    chatNameInput.focus();
  } else {
    chatInput.focus();
  }
  loadChatHistory();

  if (!socket) {
    initChatSocket();
  }
}

chatBtn.onclick = () => {
  if (chatPopover.classList.contains('hidden')) {
    openChat();
  } else {
    chatPopover.classList.add('hidden');
  }
};
chatCloseBtn.onclick = () => {
  chatPopover.classList.add('hidden');
};

if (chatNameInput) {
  chatNameInput.value = getStoredChatName();
  chatNameInput.addEventListener('change', persistChatName);
  chatNameInput.addEventListener('blur', persistChatName);
}

chatForm.onsubmit = async e => {
  e.preventDefault();
  if (typeof axios === 'undefined') {
    appendChatMsg({
      role: 'system',
      user: 'He thong',
      text: 'Thu vien HTTP chua san sang.',
      time: '',
    });
    return;
  }

  const text = chatInput.value.trim();
  const user = persistChatName();
  if (!text) {
    return;
  }

  const submitButton = chatForm.querySelector('button[type="submit"]');
  chatInput.disabled = true;
  submitButton.disabled = true;

  try {
    await axios.post(`${CHAT_BACKEND_URL}/api/messages`, {
      sessionId: chatSessionId,
      user,
      text,
    });
    chatInput.value = '';
  } catch (error) {
    if (!error.response) {
      appendChatMsg({
        role: 'system',
        user: 'He thong',
        text: 'Khong ket noi duoc server chat.',
        time: '',
      });
    }
  } finally {
    chatInput.disabled = false;
    submitButton.disabled = false;
    chatInput.focus();
  }
};
