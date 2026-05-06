const cursor = document.getElementById('cursor');
const ring = document.getElementById('cursorRing');
let mx = 0;
let my = 0;
let rx = 0;
let ry = 0;

// Only initialize custom cursor on desktop (precise pointer)
const isDesktop = window.matchMedia('(pointer: fine)').matches;

if (isDesktop) {
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
} else {
  // Hide cursor elements on touch devices
  if (cursor) cursor.style.display = 'none';
  if (ring) ring.style.display = 'none';
}

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
const chatImageInput = document.getElementById('chat-image-input');
const chatVideoInput = document.getElementById('chat-video-input');
const chatCameraInput = document.getElementById('chat-camera-input');
const chatImagePreviewContainer = document.getElementById('chat-image-preview-container');
const chatImagePreview = document.getElementById('chat-image-preview');
const chatVideoPreview = document.getElementById('chat-video-preview');
const removeImageBtn = document.getElementById('remove-image-btn');
const chatImageLabel = document.getElementById('chat-image-label');
const chatAudioRecBtn = document.getElementById('chat-audio-rec-btn');
const chatAudioPreview = document.getElementById('chat-audio-preview');
const audioPreviewEl = document.getElementById('audio-preview-el');
const chatNotiBadge = document.getElementById('chat-noti-badge');
const NOTI_SOUND_URL = 'https://assets.mixkit.co/active_storage/sfx/2358/2358-preview.mp3';
const notiAudio = new Audio(NOTI_SOUND_URL);

if (!isDesktop && chatImageInput) {
  chatImageInput.setAttribute('accept', 'image/*,video/*');
  if (chatImageLabel) chatImageLabel.setAttribute('title', 'Gửi ảnh hoặc video');
}

let selectedImageBase64 = null;
let selectedVideoBase64 = null;
let selectedAudioBase64 = null;

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
  if (!message?.text && !message?.image && !message?.video && !message?.audio) {
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
      ${bubbleType === 'mine' ? `
        <div class="chat-bubble-actions">
          <button class="chat-action-btn edit" onclick="handleEditMessage('${message.id}')" title="Sửa">✎</button>
          <button class="chat-action-btn delete" onclick="handleDeleteMessage('${message.id}')" title="Thu hồi">🗑</button>
        </div>
      ` : ''}
    </div>
    ${message.image ? `<img src="${message.image}" class="chat-bubble-image" onclick="window.open(this.src, '_blank')" />` : ''}
    ${message.video ? `
      <div class="video-wrapper">
        <video src="${message.video}" class="chat-bubble-video" controls playsinline></video>
        <button class="video-expand-btn" onclick="this.previousElementSibling.requestFullscreen()" title="Phóng to">⛶</button>
      </div>
    ` : ''}
    ${message.audio ? `
      <div class="audio-wrapper">
        <audio src="${message.audio}" class="chat-bubble-audio" controls></audio>
      </div>
    ` : ''}
    ${message.text ? `
      <div class="chat-bubble-text">
        ${escapeHtml(message.text)}
        ${message.isEdited ? '<span class="edited-tag">(đã sửa)</span>' : ''}
      </div>
    ` : ''}
  `;
  bubble.setAttribute('data-id', message.id);

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
  socket.on('chat message', message => {
    appendChatMsg(message);
    
    // Only notify if message is from Telegram/System and chat is closed or tab is inactive
    const isFromOthers = message.role === 'telegram' || message.role === 'system';
    const isChatHidden = chatPopover.classList.contains('hidden');
    const isTabInactive = document.visibilityState !== 'visible';

    if (isFromOthers && (isChatHidden || isTabInactive)) {
      if (chatNotiBadge) chatNotiBadge.style.display = 'block';
      notiAudio.play().catch(() => {}); // Browser might block autoplay without user interaction
      
      // Vibrate on mobile
      if (navigator.vibrate) {
        navigator.vibrate([200, 100, 200]); // Vibrate pattern: 200ms on, 100ms off, 200ms on
      }

      // Browser notification
      if ('Notification' in window && Notification.permission === 'granted') {
        const noti = new Notification('Huy đã phản hồi', {
          body: message.text || 'Bạn nhận được một tệp đính kèm',
          icon: 'https://cdn-icons-png.flaticon.com/512/134/134914.png', // Dùng icon đẹp hơn
          badge: 'https://cdn-icons-png.flaticon.com/512/134/134914.png',
          tag: 'chat-notification', // Tránh trùng lặp nhiều thông báo
          renotify: true
        });

        noti.onclick = () => {
          window.focus();
          openChat();
          noti.close();
        };
      }
    }
  });
  socket.on('chat:message_deleted', ({ messageId }) => {
    const el = document.querySelector(`.chat-bubble[data-id="${messageId}"]`);
    if (el) {
      el.classList.add('deleted-anim');
      setTimeout(() => el.remove(), 300);
    }
  });
  socket.on('chat:message_edited', ({ messageId, text }) => {
    const el = document.querySelector(`.chat-bubble[data-id="${messageId}"]`);
    if (el) {
      const textEl = el.querySelector('.chat-bubble-text');
      if (textEl) {
        textEl.innerHTML = `${escapeHtml(text)} <span class="edited-tag">(đã sửa)</span>`;
      }
    }
  });
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
  if (chatNotiBadge) chatNotiBadge.style.display = 'none';
  
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

async function compressImage(file, maxWidth = 1280, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;

      if (width > height) {
        if (width > maxWidth) {
          height *= maxWidth / width;
          width = maxWidth;
        }
      } else {
        if (height > maxWidth) {
          width *= maxWidth / height;
          height = maxWidth;
        }
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };

    img.onerror = (err) => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Trình duyệt không thể đọc định dạng ảnh này.'));
    };

    img.src = objectUrl;
  });
}

async function handleVideoFile(file) {
  if (!file) return;
  // Tăng giới hạn lên 50MB để hỗ trợ quay video trực tiếp từ iPhone
  if (file.size > 50 * 1024 * 1024) { 
    alert('Video quá lớn. Vui lòng gửi video dưới 50MB.');
    return;
  }

  const reader = new FileReader();
  reader.onload = e => {
    selectedVideoBase64 = e.target.result;
    selectedImageBase64 = null;
    
    chatVideoPreview.src = selectedVideoBase64;
    chatVideoPreview.style.display = 'block';
    chatImagePreview.style.display = 'none';
    chatImagePreviewContainer.classList.remove('hidden');
    
    if (chatPopover.classList.contains('hidden')) {
      openChat();
    }
  };
  reader.onerror = () => {
    alert('Không thể đọc tệp video này.');
  };
  reader.readAsDataURL(file);
}

async function handleMediaFile(file) {
  if (!file) return;
  
  // Xử lý một số định dạng video đặc biệt trên iOS (như .mov)
  const isVideo = file.type.startsWith('video/') || file.name.toLowerCase().endsWith('.mov');
  
  if (isVideo) {
    handleVideoFile(file);
  } else {
    handleImageFile(file);
  }
}

async function handleImageFile(file) {
  if (!file) return;
  try {
    const compressedBase64 = await compressImage(file);
    selectedImageBase64 = compressedBase64;
    selectedVideoBase64 = null;

    chatImagePreview.src = selectedImageBase64;
    chatImagePreview.style.display = 'block';
    chatVideoPreview.style.display = 'none';
    chatVideoPreview.src = '';
    chatImagePreviewContainer.classList.remove('hidden');
    
    if (chatPopover.classList.contains('hidden')) {
      openChat();
    }
  } catch (err) {
    console.error('Lỗi nén ảnh:', err);
    alert('Không thể xử lý ảnh này. Vui lòng thử lại.');
  }
}

if (chatImageInput) {
  chatImageInput.addEventListener('change', e => {
    handleMediaFile(e.target.files[0]);
  });
}

if (chatVideoInput) {
  chatVideoInput.addEventListener('change', e => {
    handleVideoFile(e.target.files[0]);
  });
}

if (chatCameraInput) {
  chatCameraInput.addEventListener('change', e => {
    handleMediaFile(e.target.files[0]);
  });
}

// Hỗ trợ Paste ảnh từ Clipboard
document.addEventListener('paste', e => {
  const items = (e.clipboardData || e.originalEvent.clipboardData).items;
  for (let i = 0; i < items.length; i++) {
    if (items[i].type.indexOf('image') !== -1) {
      const file = items[i].getAsFile();
      handleImageFile(file);
    } else if (items[i].type.indexOf('video') !== -1) {
      const file = items[i].getAsFile();
      handleVideoFile(file);
    }
  }
});

if (removeImageBtn) {
  removeImageBtn.addEventListener('click', () => {
    selectedImageBase64 = null;
    selectedVideoBase64 = null;
    selectedAudioBase64 = null;
    chatImageInput.value = '';
    if (chatVideoInput) chatVideoInput.value = '';
    chatImagePreviewContainer.classList.add('hidden');
    chatImagePreview.src = '';
    chatVideoPreview.src = '';
    chatVideoPreview.style.display = 'none';
    chatImagePreview.style.display = 'none';
    chatAudioPreview.style.display = 'none';
    audioPreviewEl.src = '';
  });
}

// Recording Logic
let mediaRecorder = null;
let audioChunks = [];

if (chatAudioRecBtn) {
  chatAudioRecBtn.onclick = async () => {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.stop();
      chatAudioRecBtn.classList.remove('recording');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(stream);
      audioChunks = [];

      mediaRecorder.ondataavailable = (event) => {
        audioChunks.push(event.data);
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunks, { type: 'audio/ogg; codecs=opus' });
        const reader = new FileReader();
        reader.onloadend = () => {
          selectedAudioBase64 = reader.result;
          selectedImageBase64 = null;
          selectedVideoBase64 = null;

          audioPreviewEl.src = selectedAudioBase64;
          chatAudioPreview.style.display = 'block';
          chatImagePreview.style.display = 'none';
          chatVideoPreview.style.display = 'none';
          chatImagePreviewContainer.classList.remove('hidden');
        };
        reader.readAsDataURL(audioBlob);
        
        // Stop all tracks to release microphone
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      chatAudioRecBtn.classList.add('recording');
    } catch (err) {
      console.error('Microphone access denied:', err);
      alert('Không thể truy cập microphone. Vui lòng kiểm tra quyền cài đặt.');
    }
  };
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
  const image = selectedImageBase64;
  const video = selectedVideoBase64;
  const audio = selectedAudioBase64;

  if (!text && !image && !video && !audio) {
    return;
  }

  const submitButton = chatForm.querySelector('button[type="submit"]');
  const originalSubmitText = submitButton.innerHTML;
  
  chatInput.disabled = true;
  submitButton.disabled = true;
  submitButton.innerHTML = 'Đang gửi...';

  try {
    await axios.post(`${CHAT_BACKEND_URL}/api/messages`, {
      sessionId: chatSessionId,
      user,
      text,
      image,
      video,
      audio,
    });
    chatInput.value = '';
    if (removeImageBtn) removeImageBtn.click();
  } catch (error) {
    console.error('Chat error:', error);
    let errorMsg = 'Khong ket noi duoc server chat.';
    if (error.response?.status === 413) {
      errorMsg = 'Video/Ảnh quá lớn so với giới hạn của máy chủ (Môi trường ngoài). Vui lòng gửi tệp dưới 10MB.';
    } else if (error.response?.data?.error) {
      errorMsg = error.response.data.error;
    } else if (error.message) {
      errorMsg = error.message;
    }

    appendChatMsg({
      role: 'system',
      user: 'He thong',
      text: `Lỗi: ${errorMsg}`,
      time: '',
    });
  } finally {
    chatInput.disabled = false;
    submitButton.disabled = false;
    submitButton.innerHTML = originalSubmitText;
    chatInput.focus();
  }
};

window.handleDeleteMessage = function(messageId) {
  if (confirm('Bạn có chắc chắn muốn thu hồi tin nhắn này?')) {
    socket.emit('chat:delete', { sessionId: chatSessionId, messageId });
  }
};

window.handleEditMessage = function(messageId) {
  const el = document.querySelector(`.chat-bubble[data-id="${messageId}"]`);
  if (!el) return;
  const textEl = el.querySelector('.chat-bubble-text');
  if (!textEl) return;
  
  const originalText = textEl.innerText.replace('(đã sửa)', '').trim();
  const newText = prompt('Sửa tin nhắn:', originalText);
  
  if (newText !== null && newText.trim() !== '' && newText.trim() !== originalText) {
    socket.emit('chat:edit', { 
      sessionId: chatSessionId, 
      messageId, 
      text: newText.trim() 
    });
  }
};

// Register Service Worker for PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(err => {
      console.log('ServiceWorker registration failed: ', err);
    });
  });
}

// Request Notification Permission on first click anywhere
document.addEventListener('click', () => {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}, { once: true });
