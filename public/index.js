
const cursor = document.getElementById('cursor');
  const ring   = document.getElementById('cursorRing');
  let mx = 0, my = 0, rx = 0, ry = 0;
  document.addEventListener('mousemove', e => { mx = e.clientX; my = e.clientY; });
  function animCursor() {
    cursor.style.left = mx + 'px'; cursor.style.top = my + 'px';
    rx += (mx - rx) * 0.15; ry += (my - ry) * 0.15;
    ring.style.left = rx + 'px'; ring.style.top = ry + 'px';
    requestAnimationFrame(animCursor);
  }
  animCursor();

  document.querySelectorAll('a, button, .project-card, .stat-card, .skill-group').forEach(el => {
    el.addEventListener('mouseenter', () => {
      cursor.style.transform = 'translate(-50%,-50%) scale(2)';
      ring.style.width = '60px'; ring.style.height = '60px';
      ring.style.opacity = '0.3';
    });
    el.addEventListener('mouseleave', () => {
      cursor.style.transform = 'translate(-50%,-50%) scale(1)';
      ring.style.width = '36px'; ring.style.height = '36px';
      ring.style.opacity = '0.5';
    });
  });

  /* ── TYPING STATUS ── */
  const statuses = [
    'Học & Lập trình 📖',
    'Tìm kiếm cơ hội mới 🚀',
    'Đam mê sáng tạo 💡',
    'Open for collaboration'
  ];
  let si = 0, ci = 0, deleting = false;
  const typedEl = document.querySelector('.typed-text');
  function typeEffect() {
    const current = statuses[si];
    if (!deleting) {
      typedEl.textContent = current.substring(0, ci + 1);
      ci++;
      if (ci === current.length) { deleting = true; setTimeout(typeEffect, 1800); return; }
    } else {
      typedEl.textContent = current.substring(0, ci - 1);
      ci--;
      if (ci === 0) { deleting = false; si = (si + 1) % statuses.length; }
    }
    setTimeout(typeEffect, deleting ? 50 : 90);
  }
  setTimeout(typeEffect, 1200);

  /* ── SCROLL REVEAL ── */
  const observer = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add('visible'); }
    });
  }, { threshold: 0.12 });

  document.querySelectorAll('.reveal').forEach(el => observer.observe(el));
  document.querySelectorAll('.timeline-item').forEach(el => observer.observe(el));

  /* ── NAV ACTIVE ── */
  const sections = document.querySelectorAll('section[id]');
  const navLinks = document.querySelectorAll('.nav-links a');
  window.addEventListener('scroll', () => {
    let current = '';
    sections.forEach(s => {
      if (window.scrollY >= s.offsetTop - 200) current = s.id;
    });
    navLinks.forEach(a => {
      a.style.color = a.getAttribute('href') === '#' + current
        ? 'var(--secondary)' : '';
    });
  });
// ==============================chat================================
const chatBtn = document.getElementById('chat-float-btn');
const chatPopover = document.getElementById('chat-popover');
const chatCloseBtn = document.getElementById('chat-close-btn');
const chatMessages = document.getElementById('chat-messages');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');

let socket = null;

chatBtn.onclick = () => {
  chatPopover.classList.remove('hidden');
  chatInput.focus();
  if (!socket) initChatSocket();
};
chatCloseBtn.onclick = () => {
  chatPopover.classList.add('hidden');
};

function appendChatMsg(msg) {
  const div = document.createElement('div');
  div.innerHTML = `<b style="color:#333">${msg.user}</b>: <span style="color:#000">${msg.text}</span> <span style="color:#aaa;font-size:0.85em;float:right">${msg.time}</span>`;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function initChatSocket() {
  socket = io();
  socket.on('chat history', msgs => {
    chatMessages.innerHTML = '';
    msgs.forEach(appendChatMsg);
  });
  socket.on('chat message', appendChatMsg);
}

chatForm.onsubmit = e => {
  e.preventDefault();
  if (chatInput.value.trim()) {
    axios.post('http://localhost:3000/api/messages', {
      text: chatInput.value.trim()
    }).then(res => {
      chatInput.value = '';
    });
  }
};

chatBtn.onclick = () => {
  chatPopover.classList.remove('hidden');
  chatInput.focus();
  // Lấy lịch sử chat bằng axios
  axios.get('http://localhost:3000/api/messages')
    .then(res => {
      chatMessages.innerHTML = '';
      res.data.forEach(appendChatMsg);
    });
  if (!socket) initChatSocket();
};
