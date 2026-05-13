// --- KHỞI TẠO BIẾN CHO CON TRỎ CHUỘT TÙY CHỈNH ---
const cursor = document.getElementById('cursor');
const ring = document.getElementById('cursorRing');
let mx = 0; // Tọa độ X mục tiêu
let my = 0; // Tọa độ Y mục tiêu
let rx = 0; // Tọa độ X hiện tại của vòng tròn (để tạo hiệu ứng trễ)
let ry = 0; // Tọa độ Y hiện tại của vòng tròn (để tạo hiệu ứng trễ)

// Chỉ kích hoạt con trỏ tùy chỉnh trên Desktop (thiết bị có chuột)
const isDesktop = window.matchMedia('(pointer: fine)').matches;

if (isDesktop) {
  // Cập nhật tọa độ chuột khi di chuyển
  document.addEventListener('mousemove', e => {
    mx = e.clientX;
    my = e.clientY;
  });

  // Hàm tạo hoạt ảnh mượt mà cho con trỏ và vòng tròn bao quanh
  function animCursor() {
    cursor.style.left = `${mx}px`;
    cursor.style.top = `${my}px`;
    
    // Hiệu ứng "đuổi theo" (vòng tròn di chuyển trễ hơn con trỏ)
    rx += (mx - rx) * 0.15;
    ry += (my - ry) * 0.15;
    ring.style.left = `${rx}px`;
    ring.style.top = `${ry}px`;
    
    requestAnimationFrame(animCursor);
  }

  animCursor();

  // Hiệu ứng phóng to con trỏ khi di chuột vào các phần tử tương tác
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

// --- HIỆU ỨNG ĐÁNH CHỮ (TYPING EFFECT) TRÊN HERO SECTION ---
const statuses = [
  'Học & Lập trình',
  'Tìm kiếm cơ hội mới',
  'Đam mê sáng tạo',
  'Open for collaboration',
];

let si = 0; // Chỉ số của câu hiện tại trong mảng statuses
let ci = 0; // Chỉ số của chữ cái hiện tại đang được đánh ra
let deleting = false; // Trạng thái đang xóa chữ
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

// --- HIỆU ỨNG XUẤT HIỆN KHI CUỘN TRANG (SCROLL REVEAL) ---
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

// --- TỰ ĐỘNG ĐỔI MÀU LINK NAVBAR KHI CUỘN ĐẾN SECTION TƯƠNG ỨNG ---
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

// --- CẤU HÌNH VÀ KHỞI TẠO HỆ THỐNG CHAT ---
const DEFAULT_CHAT_BACKEND_URL =
  window.location.protocol === 'file:' || ['localhost', '127.0.0.1'].includes(window.location.hostname)
    ? 'http://localhost:3000'
    : 'https://portfolio-2-wesv.onrender.com';

const CHAT_BACKEND_URL = window.CHAT_BACKEND_URL || DEFAULT_CHAT_BACKEND_URL;
const CHAT_SESSION_KEY = 'portfolio-chat-session-id'; // Key lưu ID phiên chat vào LocalStorage
const CHAT_NAME_KEY = 'portfolio-chat-user-name';     // Key lưu tên người dùng vào LocalStorage

// Lấy các phần tử DOM liên quan đến Chat
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

if (!isDesktop && chatImageInput) {
  chatImageInput.setAttribute('accept', 'image/*,video/*');
  if (chatImageLabel) chatImageLabel.setAttribute('title', 'Gửi ảnh hoặc video');
}

let selectedImageBase64 = null;
let selectedVideoBase64 = null;
let selectedAudioBase64 = null;

let socket = null;

/**
 * Quản lý Session ID (Định danh người dùng chat)
 * Ưu tiên dùng ID của tài khoản đã đăng nhập để phân tách tin nhắn giữa các user.
 * Nếu chưa đăng nhập thì dùng randomUUID lưu vào LocalStorage.
 */
function getChatSessionId() {
  // 1. Kiểm tra nếu đã đăng nhập thì dùng ID của User
  const authUserJson = localStorage.getItem('portfolio-auth-user');
  if (authUserJson) {
    try {
      const user = JSON.parse(authUserJson);
      if (user && user.id) {
        return `user-${user.id}`;
      }
    } catch (e) {
      console.error('[chat] Error parsing auth user:', e);
    }
  }

  // 2. Nếu là khách (guest) thì dùng ID ngẫu nhiên lưu trong LocalStorage
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

// Lấy sessionId hiện tại (có thể thay đổi khi login/logout)
let chatSessionId = getChatSessionId();

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

/**
 * Hàm thêm một bong bóng tin nhắn vào giao diện chat
 * @param {Object} message - Đối tượng tin nhắn từ server
 */
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
      <div class="chat-bubble-actions">
        ${bubbleType !== 'system' ? `
          <div class="reaction-picker-container">
            <button class="chat-action-btn react" title="Cảm xúc">😀</button>
            <div class="reaction-picker" id="picker-${message.id}">
              <span onclick="sendReaction('${message.id}', '👍')">👍</span>
              <span onclick="sendReaction('${message.id}', '❤️')">❤️</span>
              <span onclick="sendReaction('${message.id}', '🔥')">🔥</span>
              <span onclick="sendReaction('${message.id}', '🤣')">🤣</span>
              <span onclick="sendReaction('${message.id}', '😢')">😢</span>
              <span onclick="sendReaction('${message.id}', '🙏')">🙏</span>
            </div>
          </div>
        ` : ''}
        ${(bubbleType === 'mine' || message.role === 'telegram') ? `
          <button class="chat-action-btn edit" onclick="handleEditMessage('${message.id}')" title="Sửa">✎</button>
          <button class="chat-action-btn delete" onclick="handleDeleteMessage('${message.id}')" title="Thu hồi">🗑</button>
        ` : ''}
      </div>
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
    <div class="chat-bubble-reactions" id="reactions-${message.id}">
      ${renderReactionsHtml(message.id, message.reactions)}
    </div>
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

  // Luôn lấy sessionId mới nhất trước khi tải lịch sử
  chatSessionId = getChatSessionId();

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

/**
 * Khởi tạo kết nối Realtime bằng Socket.io
 */
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
  socket.on('chat:reaction', ({ messageId, reactions }) => {
    const container = document.getElementById(`reactions-${messageId}`);
    if (container) {
      container.innerHTML = renderReactionsHtml(messageId, reactions);
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

  if (typeof attachWebRTCSocketEvents === 'function') {
    attachWebRTCSocketEvents();
  }
}

function openChat() {
  // Cập nhật lại sessionId trước khi mở (đề phòng trường hợp vừa login/logout)
  const oldSessionId = chatSessionId;
  chatSessionId = getChatSessionId();

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

  // Nếu sessionId thay đổi (vd: vừa login/logout), ngắt socket cũ hoàn toàn
  if (oldSessionId !== chatSessionId && socket) {
    socket.disconnect();
    socket = null;
  }

  if (!socket) {
    initChatSocket();
  } else if (socket.connected) {
    socket.emit('chat:join', { sessionId: chatSessionId });
  }
}

/**
 * Cung cấp hàm toàn cục để auth-ui.js gọi sau khi login thành công
 * Ngắt socket cũ hoàn toàn và tạo kết nối mới với sessionId mới
 */
window.refreshChatSession = function() {
  const oldSessionId = chatSessionId;
  chatSessionId = getChatSessionId();

  // Nếu sessionId thay đổi, phải ngắt socket cũ để tránh nhận tin nhắn chéo
  if (oldSessionId !== chatSessionId && socket) {
    socket.disconnect();
    socket = null;
  }

  if (!socket && !chatPopover.classList.contains('hidden')) {
    initChatSocket();
  } else if (socket && socket.connected) {
    socket.emit('chat:join', { sessionId: chatSessionId });
  }

  if (!chatPopover.classList.contains('hidden')) {
    loadChatHistory();
  }
};

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

/**
 * Nén ảnh trước khi gửi để giảm dung lượng (Dùng Canvas)
 */
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
// --- LOGIC GHI ÂM (VOICE MESSAGE) ---
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







// --- XỬ LÝ GỬI TIN NHẮN (SUBMIT FORM) ---
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

window.renderReactionsHtml = function(messageId, reactions) {
  if (!reactions) return '';
  return Object.entries(reactions)
    .filter(([_, count]) => count > 0)
    .map(([emoji, count]) => `
      <span class="reaction-badge" onclick="sendReaction('${messageId}', '${emoji}')">
        ${emoji} <span class="reaction-count">${count}</span>
      </span>
    `).join('');
};

window.sendReaction = function(messageId, emoji) {
  if (socket && socket.connected) {
    socket.emit('chat:reaction', { sessionId: chatSessionId, messageId, emoji });
  }

  // Ẩn thanh chọn cảm xúc trên mobile sau khi click (xóa trạng thái hover dính)
  const picker = document.getElementById(`picker-${messageId}`);
  if (picker) {
    const container = picker.closest('.reaction-picker-container');
    if (container) {
      // Bằng cách clone và replace element, trình duyệt mobile sẽ xóa hoàn toàn 
      // trạng thái :hover (sticky hover) đang dính trên container cũ.
      const clone = container.cloneNode(true);
      container.parentNode.replaceChild(clone, container);
    }
  }
};

// --- VIDEO CALL LOGIC FOR GUEST ---
const videoCallBtn = document.getElementById('chat-video-call-btn');
const videoCallOverlay = document.getElementById('video-call-overlay');
const videoCallStatus = document.getElementById('video-call-status');
const guestLocalVideo = document.getElementById('guest-local-video');
const guestRemoteVideo = document.getElementById('guest-remote-video');
const guestEndCallBtn = document.getElementById('guest-end-call-btn');
const guestMuteBtn = document.getElementById('guest-mute-btn');
const guestVideoBtn = document.getElementById('guest-video-toggle-btn');
const guestFlipBtn = document.getElementById('guest-flip-btn');

let guestPeerConnection;
let guestLocalStream;
let callAdminId = null;
let currentFacingMode = 'user';

const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

async function startVideoCall() {
  if (!socket || !socket.connected) {
    alert('Chưa kết nối với máy chủ chat.');
    return;
  }
  
  try {
    guestLocalStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    guestLocalVideo.srcObject = guestLocalStream;
    
    videoCallOverlay.style.display = 'flex';
    videoCallStatus.innerText = 'Đang gọi cho Huy...';
    guestEndCallBtn.title = 'Hủy cuộc gọi';
    const btnText = guestEndCallBtn.querySelector('.btn-text');
    if (btnText) btnText.innerText = 'Hủy cuộc gọi';
    
    // Yêu cầu gọi điện
    socket.emit('call:request', { sessionId: chatSessionId });
    updateGuestControls();
  } catch (err) {
    alert('Không thể truy cập Camera/Micro: ' + err.message);
  }
}

function endVideoCall() {
  if (guestPeerConnection) {
    guestPeerConnection.close();
    guestPeerConnection = null;
  }
  if (guestLocalStream) {
    guestLocalStream.getTracks().forEach(t => t.stop());
    guestLocalStream = null;
  }
  
  if (callAdminId) {
    socket.emit('call:end', { targetId: callAdminId });
  } else {
    // Trường hợp huỷ trước khi có admin bắt máy
    if (socket) socket.emit('call:end', { targetId: chatSessionId });
  }
  
  callAdminId = null;
  videoCallOverlay.style.display = 'none';
  guestRemoteVideo.srcObject = null;
  guestLocalVideo.srcObject = null;
  
  // Reset buttons
  if(guestMuteBtn) guestMuteBtn.classList.remove('is-off');
  if(guestVideoBtn) guestVideoBtn.classList.remove('is-off');
  const placeholder = document.getElementById('guest-video-placeholder');
  if(placeholder) placeholder.remove();
}

function updateGuestControls() {
  if (!guestLocalStream) return;
  const audioTrack = guestLocalStream.getAudioTracks()[0];
  const videoTrack = guestLocalStream.getVideoTracks()[0];

  // Cập nhật trạng thái nút Mic
  if (guestMuteBtn) {
    const isMuted = !audioTrack.enabled;
    guestMuteBtn.classList.toggle('is-off', isMuted);
    guestMuteBtn.title = isMuted ? "Bật Mic" : "Tắt Mic";
    // Có thể thêm icon gạch chéo cho Mic ở đây nếu muốn
  }

  // Cập nhật trạng thái nút Video & Placeholder
  if (guestVideoBtn) {
    const isVideoOff = !videoTrack.enabled;
    guestVideoBtn.classList.toggle('is-off', isVideoOff);
    guestVideoBtn.title = isVideoOff ? "Bật Camera" : "Tắt Camera";
    
    let placeholder = document.getElementById('guest-video-placeholder');
    if (isVideoOff) {
      if (!placeholder) {
        placeholder = document.createElement('div');
        placeholder.id = 'guest-video-placeholder';
        placeholder.className = 'video-off-placeholder';
        placeholder.innerHTML = `
          <div class="video-off-avatar">👤</div>
          <div style="font-size:12px; font-weight:600; color: #888;">Camera tắt</div>
        `;
        guestLocalVideo.parentElement.appendChild(placeholder);
      }
    } else if (placeholder) {
      placeholder.remove();
    }
  }
}


if (guestMuteBtn) {
  guestMuteBtn.addEventListener('click', () => {
    if (guestLocalStream) {
      const track = guestLocalStream.getAudioTracks()[0];
      track.enabled = !track.enabled;
      updateGuestControls();
    }
  });
}

if (guestVideoBtn) {
  guestVideoBtn.addEventListener('click', () => {
    if (guestLocalStream) {
      const track = guestLocalStream.getVideoTracks()[0];
      track.enabled = !track.enabled;
      updateGuestControls();
    }
  });
}

if (guestFlipBtn) {
  guestFlipBtn.addEventListener('click', async () => {
    if (!guestLocalStream) return;
    
    currentFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';
    
    try {
      // 1. Dừng track cũ
      const oldVideoTrack = guestLocalStream.getVideoTracks()[0];
      if (oldVideoTrack) oldVideoTrack.stop();

      // 2. Lấy stream mới
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: currentFacingMode },
        audio: true
      });
      
      const newVideoTrack = newStream.getVideoTracks()[0];

      // 3. Cập nhật local stream và render lại
      guestLocalStream.removeTrack(oldVideoTrack);
      guestLocalStream.addTrack(newVideoTrack);
      guestLocalVideo.srcObject = guestLocalStream;
      
      // 4. Thay thế track trong PeerConnection để Admin thấy
      if (guestPeerConnection) {
        const senders = guestPeerConnection.getSenders();
        const videoSender = senders.find(s => s.track && s.track.kind === 'video');
        if (videoSender) {
          await videoSender.replaceTrack(newVideoTrack);
        }
      }
      
      updateGuestControls();
    } catch (err) {
      console.error("Flip camera failed:", err);
      currentFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';
    }
  });
}


// Check on load (No longer hiding button)


if (videoCallBtn) {
  videoCallBtn.addEventListener('click', startVideoCall);
}
if (guestEndCallBtn) {
  guestEndCallBtn.addEventListener('click', endVideoCall);
}

function attachWebRTCSocketEvents() {
  socket.on('call:accepted', async ({ adminId }) => {
    callAdminId = adminId;
    videoCallStatus.innerText = 'Đã kết nối!';
    guestEndCallBtn.title = 'Kết thúc cuộc gọi';
    const btnText = guestEndCallBtn.querySelector('.btn-text');
    if (btnText) btnText.innerText = 'Kết thúc cuộc gọi';
    
    guestPeerConnection = new RTCPeerConnection(rtcConfig);
    
    guestLocalStream.getTracks().forEach(track => {
      guestPeerConnection.addTrack(track, guestLocalStream);
    });

    guestPeerConnection.ontrack = (event) => {
      guestRemoteVideo.srcObject = event.streams[0];
    };

    guestPeerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('webrtc:signal', { targetId: callAdminId, signal: event.candidate });
      }
    };

    try {
      const offer = await guestPeerConnection.createOffer();
      await guestPeerConnection.setLocalDescription(offer);
      socket.emit('webrtc:signal', { targetId: callAdminId, signal: guestPeerConnection.localDescription });
    } catch (e) {
      console.error(e);
    }
  });

  socket.on('call:rejected', () => {
    alert('Cuộc gọi bị từ chối hoặc Admin đang bận.');
    endVideoCall();
  });

  socket.on('call:ended', () => {
    alert('Cuộc gọi đã kết thúc.');
    endVideoCall();
  });

  socket.on('webrtc:signal', async ({ senderId, signal }) => {
    if (senderId !== callAdminId) return;
    if (!guestPeerConnection) return;
    
    if (signal.type === 'answer') {
      await guestPeerConnection.setRemoteDescription(new RTCSessionDescription(signal));
    } else if (signal.candidate) {
      try {
        await guestPeerConnection.addIceCandidate(new RTCIceCandidate(signal));
      } catch (e) {
        console.error(e);
      }
    }
  });
}
