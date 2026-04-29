/**
 * auth-ui.js — Frontend Authentication Module
 * =============================================
 * Quản lý toàn bộ luồng Auth phía client:
 *   1. Hiển thị Auth Overlay (che toàn trang) nếu chưa đăng nhập
 *   2. Form Đăng ký (Register) + Đăng nhập (Login) với validate
 *   3. Lưu JWT token vào localStorage
 *   4. Verify token với backend khi load trang
 *   5. Nút Đăng xuất (Logout)
 *
 * Cách hoạt động (Protected Route):
 *   - Khi trang load: kiểm tra token trong localStorage
 *   - Nếu không có token → hiện Auth Overlay, ẩn nội dung Portfolio
 *   - Nếu có token → gọi /api/auth/verify để xác nhận còn hợp lệ không
 *   - Token hợp lệ → ẩn Overlay, hiện Portfolio
 *   - Token hết hạn/lỗi → xóa token cũ, hiện Overlay đăng nhập lại
 */

// ── Cấu hình ────────────────────────────────────────────────────────────────
const AUTH_TOKEN_KEY = 'portfolio-auth-token';
const AUTH_USER_KEY  = 'portfolio-auth-user';

// Lấy BACKEND URL đã được khai báo trong index.html
const BACKEND_URL =
  window.CHAT_BACKEND_URL ||
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:3000'
    : 'https://portfolio-1-yjvu.onrender.com');

// ════════════════════════════════════════════════════════════════════════════
// KHỞI TẠO DOM — Inject Auth Overlay vào trang
// ════════════════════════════════════════════════════════════════════════════

/**
 * Tạo và inject Auth Overlay HTML vào <body>.
 * Overlay sẽ che toàn bộ nội dung Portfolio.
 */
function createAuthOverlay() {
  const overlay = document.createElement('div');
  overlay.id = 'auth-overlay';
  overlay.innerHTML = `
    <div class="auth-glass">

      <!-- Logo / Brand -->
      <div class="auth-brand">
        <span class="auth-brand-logo">DNH<span class="auth-brand-dot">.</span>dev</span>
        <p class="auth-brand-sub">Khu vực riêng tư · Yêu cầu đăng nhập</p>
      </div>

      <!-- Tabs: Đăng nhập / Đăng ký -->
      <div class="auth-tabs" role="tablist">
        <button id="tab-login"    class="auth-tab active" role="tab" aria-selected="true">Đăng nhập</button>
        <button id="tab-register" class="auth-tab"        role="tab" aria-selected="false">Đăng ký</button>
      </div>

      <!-- ── FORM ĐĂNG NHẬP ────────────────────────────────────── -->
      <form id="login-form" class="auth-form" novalidate>
        <div class="auth-field">
          <label for="login-email">Email</label>
          <input id="login-email" type="email" placeholder="ban@email.com" autocomplete="email" required />
          <span class="auth-field-error" id="login-email-err"></span>
        </div>
        <div class="auth-field">
          <label for="login-password">Mật khẩu</label>
          <div class="auth-password-wrap">
            <input id="login-password" type="password" placeholder="••••••••" autocomplete="current-password" required />
            <button type="button" class="auth-eye-btn" data-target="login-password" aria-label="Hiện mật khẩu">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            </button>
          </div>
          <span class="auth-field-error" id="login-password-err"></span>
        </div>
        <div class="auth-server-error" id="login-server-err"></div>
        <button type="submit" class="auth-submit-btn" id="login-submit">
          <span class="btn-text">Đăng nhập</span>
          <span class="btn-spinner" hidden>
            <svg viewBox="0 0 24 24" class="spin-icon"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" fill="none" stroke-dasharray="31.4" stroke-dashoffset="10"/></svg>
          </span>
        </button>
        <div class="auth-forgot-link-wrap">
          <button type="button" id="forgot-password-link" class="auth-forgot-link">Quên mật khẩu?</button>
        </div>
      </form>

      <!-- ── FORM ĐĂNG KÝ ──────────────────────────────────────── -->
      <form id="register-form" class="auth-form hidden" novalidate>
        <div class="auth-field">
          <label for="reg-name">Tên của bạn</label>
          <input id="reg-name" type="text" placeholder="Nguyễn Văn A" autocomplete="name" required maxlength="60" />
          <span class="auth-field-error" id="reg-name-err"></span>
        </div>
        <div class="auth-field">
          <label for="reg-email">Email</label>
          <input id="reg-email" type="email" placeholder="ban@email.com" autocomplete="email" required />
          <span class="auth-field-error" id="reg-email-err"></span>
        </div>
        <div class="auth-field">
          <label for="reg-password">Mật khẩu <small>(ít nhất 6 ký tự)</small></label>
          <div class="auth-password-wrap">
            <input id="reg-password" type="password" placeholder="••••••••" autocomplete="new-password" required />
            <button type="button" class="auth-eye-btn" data-target="reg-password" aria-label="Hiện mật khẩu">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            </button>
          </div>
          <span class="auth-field-error" id="reg-password-err"></span>
        </div>
        <div class="auth-field">
          <label for="reg-confirm">Xác nhận mật khẩu</label>
          <div class="auth-password-wrap">
            <input id="reg-confirm" type="password" placeholder="••••••••" autocomplete="new-password" required />
            <button type="button" class="auth-eye-btn" data-target="reg-confirm" aria-label="Hiện mật khẩu">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            </button>
          </div>
          <span class="auth-field-error" id="reg-confirm-err"></span>
        </div>
        <div class="auth-server-error" id="reg-server-err"></div>
        <button type="submit" class="auth-submit-btn" id="reg-submit">
          <span class="btn-text">Tạo tài khoản</span>
          <span class="btn-spinner" hidden>
            <svg viewBox="0 0 24 24" class="spin-icon"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" fill="none" stroke-dasharray="31.4" stroke-dashoffset="10"/></svg>
          </span>
        </button>
      </form>

      <!-- Thông báo thành công -->
      <div class="auth-success" id="auth-success" hidden></div>

      <!-- ── FORM QUÊN MẬT KHẨU ────────────────────────────── -->
      <div id="forgot-password-section" class="auth-form hidden">
        <!-- Bước 1: Nhập email -->
        <form id="forgot-step1-form" class="auth-forgot-step" novalidate>
          <div class="auth-forgot-header">
            <button type="button" id="forgot-back-btn" class="auth-back-btn" title="Quay lại đăng nhập">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
            </button>
            <div>
              <h3 class="auth-forgot-title">Quên mật khẩu</h3>
              <p class="auth-forgot-desc">Nhập email để nhận mã đặt lại mật khẩu qua hộp thư</p>
            </div>
          </div>
          <div class="auth-field">
            <label for="forgot-email">Email</label>
            <input id="forgot-email" type="email" placeholder="ban@email.com" autocomplete="email" required />
            <span class="auth-field-error" id="forgot-email-err"></span>
          </div>
          <div class="auth-server-error" id="forgot-server-err"></div>
          <button type="submit" class="auth-submit-btn" id="forgot-submit">
            <span class="btn-text">Gửi mã xác nhận</span>
            <span class="btn-spinner" hidden>
              <svg viewBox="0 0 24 24" class="spin-icon"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" fill="none" stroke-dasharray="31.4" stroke-dashoffset="10"/></svg>
            </span>
          </button>
        </form>

        <!-- Bước 2: Nhập mã + Mật khẩu mới -->
        <form id="forgot-step2-form" class="auth-forgot-step hidden" novalidate>
          <div class="auth-forgot-header">
            <button type="button" id="forgot-back-step1-btn" class="auth-back-btn" title="Quay lại nhập email">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
            </button>
            <div>
              <h3 class="auth-forgot-title">Nhập mã xác nhận</h3>
              <p class="auth-forgot-desc">Mã 6 số đã được gửi đến email của bạn. Kiểm tra hộp thư (và Spam).</p>
            </div>
          </div>
          <div class="auth-field">
            <label for="reset-code">Mã xác nhận (6 số)</label>
            <input id="reset-code" type="text" placeholder="123456" maxlength="6" inputmode="numeric" autocomplete="one-time-code" required />
            <span class="auth-field-error" id="reset-code-err"></span>
          </div>
          <div class="auth-field">
            <label for="reset-new-password">Mật khẩu mới <small>(ít nhất 6 ký tự)</small></label>
            <div class="auth-password-wrap">
              <input id="reset-new-password" type="password" placeholder="••••••••" autocomplete="new-password" required />
              <button type="button" class="auth-eye-btn" data-target="reset-new-password" aria-label="Hiện mật khẩu">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              </button>
            </div>
            <span class="auth-field-error" id="reset-new-password-err"></span>
          </div>
          <div class="auth-field">
            <label for="reset-confirm-password">Xác nhận mật khẩu mới</label>
            <div class="auth-password-wrap">
              <input id="reset-confirm-password" type="password" placeholder="••••••••" autocomplete="new-password" required />
              <button type="button" class="auth-eye-btn" data-target="reset-confirm-password" aria-label="Hiện mật khẩu">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              </button>
            </div>
            <span class="auth-field-error" id="reset-confirm-password-err"></span>
          </div>
          <div class="auth-server-error" id="reset-server-err"></div>
          <button type="submit" class="auth-submit-btn" id="reset-submit">
            <span class="btn-text">Đặt lại mật khẩu</span>
            <span class="btn-spinner" hidden>
              <svg viewBox="0 0 24 24" class="spin-icon"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" fill="none" stroke-dasharray="31.4" stroke-dashoffset="10"/></svg>
            </span>
          </button>
        </form>

        <!-- Thông báo thành công khi reset xong -->
        <div class="auth-success" id="reset-success" hidden></div>
      </div>

    </div><!-- .auth-glass -->
  `;

  // Chèn overlay vào đầu body (trước tất cả nội dung portfolio)
  document.body.insertBefore(overlay, document.body.firstChild);
}

/**
 * Tạo nút Đăng xuất và thêm vào Nav bar.
 */
function createLogoutButton() {
  const nav = document.querySelector('nav .nav-links');
  if (!nav) return;

  const li = document.createElement('li');
  li.id = 'logout-nav-item';
  li.innerHTML = `
    <button id="logout-btn" class="nav-logout-btn" title="Đăng xuất">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
        <polyline points="16 17 21 12 16 7"/>
        <line x1="21" y1="12" x2="9" y2="12"/>
      </svg>
      Đăng xuất
    </button>
  `;
  nav.appendChild(li);

  document.getElementById('logout-btn').addEventListener('click', handleLogout);
}

// ════════════════════════════════════════════════════════════════════════════
// TOKEN HELPERS
// ════════════════════════════════════════════════════════════════════════════

function getToken() {
  return localStorage.getItem(AUTH_TOKEN_KEY);
}

function saveAuthData(token, user) {
  localStorage.setItem(AUTH_TOKEN_KEY, token);
  localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
}

function clearAuthData() {
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(AUTH_USER_KEY);
}

// ════════════════════════════════════════════════════════════════════════════
// UI STATE HELPERS
// ════════════════════════════════════════════════════════════════════════════

/** Ẩn overlay → cho phép xem Portfolio */
function showPortfolio() {
  const overlay = document.getElementById('auth-overlay');
  if (overlay) {
    overlay.classList.add('auth-overlay--hidden');
    // Sau animation xong thì bỏ khỏi DOM để không block interaction
    setTimeout(() => overlay.remove(), 500);
  }
  // Hiện logout button
  const logoutItem = document.getElementById('logout-nav-item');
  if (logoutItem) logoutItem.style.display = '';
}

/** Hiện overlay → chặn Portfolio */
function showAuthOverlay() {
  const overlay = document.getElementById('auth-overlay');
  if (overlay) overlay.classList.remove('auth-overlay--hidden');
  const logoutItem = document.getElementById('logout-nav-item');
  if (logoutItem) logoutItem.style.display = 'none';
}

function setLoading(form, loading) {
  const btn       = form.querySelector('.auth-submit-btn');
  const btnText   = btn?.querySelector('.btn-text');
  const btnSpinner = btn?.querySelector('.btn-spinner');
  if (btn)       btn.disabled = loading;
  if (btnText)   btnText.style.opacity = loading ? '0.5' : '1';
  if (btnSpinner) btnSpinner.hidden = !loading;
}

function clearErrors(form) {
  form.querySelectorAll('.auth-field-error').forEach(el => el.textContent = '');
  const serverErr = form.querySelector('.auth-server-error');
  if (serverErr) serverErr.textContent = '';
}

function showFieldError(id, msg) {
  const el = document.getElementById(id);
  if (el) { el.textContent = msg; el.classList.add('shake'); setTimeout(() => el.classList.remove('shake'), 400); }
}

function showServerError(id, msg) {
  const el = document.getElementById(id);
  if (el) { el.textContent = msg; el.hidden = false; }
}

// ════════════════════════════════════════════════════════════════════════════
// VALIDATION
// ════════════════════════════════════════════════════════════════════════════

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/**
 * Validate form đăng nhập.
 * @returns {boolean} true nếu hợp lệ
 */
function validateLoginForm() {
  const email    = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;
  let valid = true;

  if (!email.trim()) {
    showFieldError('login-email-err', 'Email không được để trống.'); valid = false;
  } else if (!validateEmail(email)) {
    showFieldError('login-email-err', 'Email không đúng định dạng.'); valid = false;
  }

  if (!password) {
    showFieldError('login-password-err', 'Mật khẩu không được để trống.'); valid = false;
  }

  return valid;
}

/**
 * Validate form đăng ký.
 * @returns {boolean} true nếu hợp lệ
 */
function validateRegisterForm() {
  const name     = document.getElementById('reg-name').value;
  const email    = document.getElementById('reg-email').value;
  const password = document.getElementById('reg-password').value;
  const confirm  = document.getElementById('reg-confirm').value;
  let valid = true;

  if (!name.trim()) {
    showFieldError('reg-name-err', 'Tên không được để trống.'); valid = false;
  }

  if (!email.trim()) {
    showFieldError('reg-email-err', 'Email không được để trống.'); valid = false;
  } else if (!validateEmail(email)) {
    showFieldError('reg-email-err', 'Email không đúng định dạng.'); valid = false;
  }

  if (!password) {
    showFieldError('reg-password-err', 'Mật khẩu không được để trống.'); valid = false;
  } else if (password.length < 6) {
    showFieldError('reg-password-err', 'Mật khẩu phải có ít nhất 6 ký tự.'); valid = false;
  }

  if (!confirm) {
    showFieldError('reg-confirm-err', 'Vui lòng xác nhận mật khẩu.'); valid = false;
  } else if (password && confirm !== password) {
    showFieldError('reg-confirm-err', 'Mật khẩu xác nhận không khớp.'); valid = false;
  }

  return valid;
}

// ════════════════════════════════════════════════════════════════════════════
// API CALLS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Gọi API đăng nhập.
 * Trả về { user, token } hoặc throw Error.
 */
async function apiLogin(email, password) {
  const res = await fetch(`${BACKEND_URL}/api/auth/login`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ email: email.trim().toLowerCase(), password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Đăng nhập thất bại.');
  return data;
}

/**
 * Gọi API đăng ký.
 */
async function apiRegister(name, email, password) {
  const res = await fetch(`${BACKEND_URL}/api/auth/register`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ name: name.trim(), email: email.trim().toLowerCase(), password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Đăng ký thất bại.');
  return data;
}

/**
 * Verify JWT token với backend.
 * Trả về { valid: true, user } hoặc throw Error.
 */
async function apiVerifyToken(token) {
  const res = await fetch(`${BACKEND_URL}/api/auth/verify`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Token không hợp lệ.');
  return data;
}

/**
 * Gọi API quên mật khẩu — gửi email để nhận mã reset.
 */
async function apiForgotPassword(email) {
  const res = await fetch(`${BACKEND_URL}/api/auth/forgot-password`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ email: email.trim().toLowerCase() }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Yêu cầu thất bại.');
  return data;
}

/**
 * Gọi API đặt lại mật khẩu bằng mã xác nhận.
 */
async function apiResetPassword(email, resetCode, newPassword) {
  const res = await fetch(`${BACKEND_URL}/api/auth/reset-password`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ email: email.trim().toLowerCase(), resetCode, newPassword }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Đặt lại mật khẩu thất bại.');
  return data;
}

// ════════════════════════════════════════════════════════════════════════════
// EVENT HANDLERS
// ════════════════════════════════════════════════════════════════════════════

async function handleLoginSubmit(e) {
  e.preventDefault();
  const form = document.getElementById('login-form');
  clearErrors(form);
  if (!validateLoginForm()) return;

  const email    = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;

  setLoading(form, true);
  try {
    const { user, token } = await apiLogin(email, password);
    saveAuthData(token, user);
    showSuccessMessage(`Chào mừng trở lại, ${user.name}! 🎉`);
    setTimeout(showPortfolio, 1200);
  } catch (err) {
    showServerError('login-server-err', err.message);
  } finally {
    setLoading(form, false);
  }
}

async function handleRegisterSubmit(e) {
  e.preventDefault();
  const form = document.getElementById('register-form');
  clearErrors(form);
  if (!validateRegisterForm()) return;

  const name     = document.getElementById('reg-name').value;
  const email    = document.getElementById('reg-email').value;
  const password = document.getElementById('reg-password').value;

  setLoading(form, true);
  try {
    const { user, token } = await apiRegister(name, email, password);
    saveAuthData(token, user);
    showSuccessMessage(`Đăng ký thành công! Chào ${user.name} 🚀`);
    setTimeout(showPortfolio, 1400);
  } catch (err) {
    showServerError('reg-server-err', err.message);
  } finally {
    setLoading(form, false);
  }
}

function handleLogout() {
  clearAuthData();
  // Reload trang → Auth Overlay sẽ xuất hiện lại
  window.location.reload();
}

function showSuccessMessage(msg) {
  const el = document.getElementById('auth-success');
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  // Ẩn tất cả form khi đang hiện success
  document.querySelectorAll('.auth-form').forEach(f => f.style.opacity = '0.4');
}

// ── Biến lưu email đang reset ─────────────────────────────────────────────
let _forgotEmail = '';

/**
 * Hiện section Quên mật khẩu, ẩn Login/Register.
 */
function showForgotPassword() {
  // Ẩn tabs, login form, register form
  document.querySelector('.auth-tabs').classList.add('hidden');
  document.getElementById('login-form').classList.add('hidden');
  document.getElementById('register-form').classList.add('hidden');
  document.getElementById('auth-success').hidden = true;
  document.querySelectorAll('.auth-form').forEach(f => f.style.opacity = '');

  // Hiện forgot section + step 1
  const section = document.getElementById('forgot-password-section');
  section.classList.remove('hidden');
  document.getElementById('forgot-step1-form').classList.remove('hidden');
  document.getElementById('forgot-step2-form').classList.add('hidden');
  document.getElementById('reset-success').hidden = true;

  // Clear errors
  clearErrors(document.getElementById('forgot-step1-form'));
  clearErrors(document.getElementById('forgot-step2-form'));
}

/**
 * Quay lại giao diện Login từ Forgot Password.
 */
function backToLogin() {
  // Ẩn forgot section
  document.getElementById('forgot-password-section').classList.add('hidden');

  // Hiện lại tabs + login form
  document.querySelector('.auth-tabs').classList.remove('hidden');
  document.getElementById('login-form').classList.remove('hidden');
  document.getElementById('register-form').classList.add('hidden');
  document.getElementById('auth-success').hidden = true;
  document.querySelectorAll('.auth-form').forEach(f => f.style.opacity = '');

  // Reset tab states
  document.getElementById('tab-login').classList.add('active');
  document.getElementById('tab-login').setAttribute('aria-selected', 'true');
  document.getElementById('tab-register').classList.remove('active');
  document.getElementById('tab-register').setAttribute('aria-selected', 'false');
}

/**
 * Xử lý Step 1: Gửi email để nhận mã reset.
 */
async function handleForgotStep1(e) {
  e.preventDefault();
  const form = document.getElementById('forgot-step1-form');
  clearErrors(form);

  const email = document.getElementById('forgot-email').value;
  if (!email.trim()) {
    showFieldError('forgot-email-err', 'Email không được để trống.');
    return;
  }
  if (!validateEmail(email)) {
    showFieldError('forgot-email-err', 'Email không đúng định dạng.');
    return;
  }

  setLoading(form, true);
  try {
    const data = await apiForgotPassword(email);
    // Lưu email để dùng ở step 2
    _forgotEmail = email.trim().toLowerCase();
    // Chuyển sang step 2
    document.getElementById('forgot-step1-form').classList.add('hidden');
    document.getElementById('forgot-step2-form').classList.remove('hidden');
  } catch (err) {
    showServerError('forgot-server-err', err.message);
  } finally {
    setLoading(form, false);
  }
}

/**
 * Xử lý Step 2: Nhập mã + mật khẩu mới.
 */
async function handleForgotStep2(e) {
  e.preventDefault();
  const form = document.getElementById('forgot-step2-form');
  clearErrors(form);

  const code        = document.getElementById('reset-code').value.trim();
  const newPassword = document.getElementById('reset-new-password').value;
  const confirmPwd  = document.getElementById('reset-confirm-password').value;
  let valid = true;

  if (!code) {
    showFieldError('reset-code-err', 'Mã xác nhận không được để trống.'); valid = false;
  } else if (!/^\d{6}$/.test(code)) {
    showFieldError('reset-code-err', 'Mã xác nhận phải là 6 chữ số.'); valid = false;
  }

  if (!newPassword) {
    showFieldError('reset-new-password-err', 'Mật khẩu mới không được để trống.'); valid = false;
  } else if (newPassword.length < 6) {
    showFieldError('reset-new-password-err', 'Mật khẩu phải có ít nhất 6 ký tự.'); valid = false;
  }

  if (!confirmPwd) {
    showFieldError('reset-confirm-password-err', 'Vui lòng xác nhận mật khẩu.'); valid = false;
  } else if (newPassword && confirmPwd !== newPassword) {
    showFieldError('reset-confirm-password-err', 'Mật khẩu xác nhận không khớp.'); valid = false;
  }

  if (!valid) return;

  setLoading(form, true);
  try {
    const data = await apiResetPassword(_forgotEmail, code, newPassword);
    // Hiện thông báo thành công
    document.getElementById('forgot-step2-form').classList.add('hidden');
    const successEl = document.getElementById('reset-success');
    successEl.textContent = data.message || 'Mật khẩu đã được đặt lại thành công! 🎉';
    successEl.hidden = false;
    // Tự động quay lại Login sau 2.5 giây
    setTimeout(() => {
      backToLogin();
      successEl.hidden = true;
    }, 2500);
  } catch (err) {
    showServerError('reset-server-err', err.message);
  } finally {
    setLoading(form, false);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// PROTECTED ROUTE GUARD — Chạy khi load trang
// ════════════════════════════════════════════════════════════════════════════

/**
 * Đây là "Protected Route Guard" phía client.
 * Tương đương router.beforeEach trong Vue hoặc middleware trong Next.js.
 *
 * Quy trình:
 *   1. Không có token → hiện Auth Overlay ngay lập tức (không gọi API)
 *   2. Có token → verify với backend
 *      a. Token hợp lệ → ẩn Overlay, hiện Portfolio
 *      b. Token lỗi/hết hạn → xóa token cũ, hiện Overlay (yêu cầu login lại)
 */
async function initAuthGuard() {
  const token = getToken();

  if (!token) {
    // Chưa có token → chặn ngay, không cần gọi API
    showAuthOverlay();
    return;
  }

  // Đã có token → verify với server
  try {
    await apiVerifyToken(token);
    // Token hợp lệ → cho vào Portfolio
    showPortfolio();
  } catch {
    // Token hết hạn hoặc không hợp lệ → đăng nhập lại
    clearAuthData();
    showAuthOverlay();
  }
}

// ════════════════════════════════════════════════════════════════════════════
// SETUP UI EVENTS
// ════════════════════════════════════════════════════════════════════════════

function setupTabSwitching() {
  const tabLogin    = document.getElementById('tab-login');
  const tabRegister = document.getElementById('tab-register');
  const loginForm   = document.getElementById('login-form');
  const regForm     = document.getElementById('register-form');

  tabLogin.addEventListener('click', () => {
    tabLogin.classList.add('active');    tabLogin.setAttribute('aria-selected', 'true');
    tabRegister.classList.remove('active'); tabRegister.setAttribute('aria-selected', 'false');
    loginForm.classList.remove('hidden');
    regForm.classList.add('hidden');
    clearErrors(loginForm);
    clearErrors(regForm);
    document.getElementById('auth-success').hidden = true;
    document.querySelectorAll('.auth-form').forEach(f => f.style.opacity = '');
  });

  tabRegister.addEventListener('click', () => {
    tabRegister.classList.add('active');    tabRegister.setAttribute('aria-selected', 'true');
    tabLogin.classList.remove('active');   tabLogin.setAttribute('aria-selected', 'false');
    regForm.classList.remove('hidden');
    loginForm.classList.add('hidden');
    clearErrors(loginForm);
    clearErrors(regForm);
    document.getElementById('auth-success').hidden = true;
    document.querySelectorAll('.auth-form').forEach(f => f.style.opacity = '');
  });
}

function setupPasswordToggle() {
  document.querySelectorAll('.auth-eye-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.target);
      if (!input) return;
      input.type = input.type === 'password' ? 'text' : 'password';
    });
  });
}

// ════════════════════════════════════════════════════════════════════════════
// ENTRY POINT
// ════════════════════════════════════════════════════════════════════════════

/**
 * Khởi động Auth System.
 * Gọi hàm này sau khi DOM đã sẵn sàng.
 */
function initAuth() {
  // 1. Chèn Auth Overlay vào DOM
  createAuthOverlay();

  // 2. Chèn nút Logout vào Nav
  createLogoutButton();
  // Ẩn logout button mặc định (sẽ hiện sau khi verify thành công)
  const logoutItem = document.getElementById('logout-nav-item');
  if (logoutItem) logoutItem.style.display = 'none';

  // 3. Gắn sự kiện submit form
  document.getElementById('login-form').addEventListener('submit', handleLoginSubmit);
  document.getElementById('register-form').addEventListener('submit', handleRegisterSubmit);

  // 3b. Gắn sự kiện Forgot Password
  document.getElementById('forgot-password-link').addEventListener('click', showForgotPassword);
  document.getElementById('forgot-back-btn').addEventListener('click', backToLogin);
  document.getElementById('forgot-back-step1-btn').addEventListener('click', () => {
    document.getElementById('forgot-step2-form').classList.add('hidden');
    document.getElementById('forgot-step1-form').classList.remove('hidden');
    clearErrors(document.getElementById('forgot-step2-form'));
  });
  document.getElementById('forgot-step1-form').addEventListener('submit', handleForgotStep1);
  document.getElementById('forgot-step2-form').addEventListener('submit', handleForgotStep2);

  // 4. Gắn sự kiện chuyển tab
  setupTabSwitching();

  // 5. Gắn sự kiện hiện/ẩn mật khẩu
  setupPasswordToggle();

  // 6. Chạy Protected Route Guard
  initAuthGuard();
}

// Đảm bảo DOM đã load xong trước khi chạy
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAuth);
} else {
  initAuth();
}
