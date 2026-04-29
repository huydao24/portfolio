/**
 * auth.js — Module xác thực người dùng
 * ======================================
 * Chịu trách nhiệm:
 *   1. Đọc/ghi database người dùng (file users.json)
 *   2. Hash mật khẩu bằng bcryptjs
 *   3. Ký & verify JWT token
 *   4. Middleware bảo vệ các route yêu cầu đăng nhập
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Đường dẫn file lưu dữ liệu người dùng ──────────────────────────────────
const DATA_DIR  = path.resolve(__dirname, '../data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

// ── Cấu hình JWT ────────────────────────────────────────────────────────────
// JWT_SECRET nên được đặt trong file .env (không được commit lên git!)
const JWT_SECRET  = process.env.JWT_SECRET || 'portfolio_super_secret_change_me_in_production';
const JWT_EXPIRES = '7d'; // Token hết hạn sau 7 ngày

// ── Số vòng hash bcrypt (12 = an toàn, ~250ms/hash) ────────────────────────
const BCRYPT_SALT_ROUNDS = 12;

// ════════════════════════════════════════════════════════════════════════════
// DATABASE HELPERS — Đọc/ghi users.json
// ════════════════════════════════════════════════════════════════════════════

/**
 * Đọc danh sách user từ file JSON.
 * Trả về mảng rỗng nếu file chưa tồn tại.
 * @returns {Promise<Array>}
 */
async function readUsers() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const raw = await fs.readFile(USERS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // File chưa tồn tại hoặc JSON không hợp lệ → trả về mảng rỗng
    return [];
  }
}

/**
 * Ghi danh sách user xuống file JSON.
 * @param {Array} users
 */
async function writeUsers(users) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
}

// ════════════════════════════════════════════════════════════════════════════
// VALIDATION HELPERS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Kiểm tra email hợp lệ bằng regex đơn giản.
 * @param {string} email
 * @returns {boolean}
 */
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

/**
 * Sanitize chuỗi đầu vào: trim, giới hạn độ dài.
 * @param {*} value
 * @param {number} maxLen
 * @returns {string}
 */
function sanitize(value, maxLen = 200) {
  return String(value || '').trim().slice(0, maxLen);
}

// ════════════════════════════════════════════════════════════════════════════
// CORE AUTH FUNCTIONS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Đăng ký tài khoản mới.
 *
 * Schema User:
 * {
 *   id:           string  — UUID duy nhất
 *   name:         string  — Tên hiển thị (tối đa 60 ký tự)
 *   email:        string  — Email (lowercase, tối đa 200 ký tự)
 *   passwordHash: string  — Mật khẩu đã được hash bằng bcrypt
 *   createdAt:    string  — ISO 8601 timestamp
 * }
 *
 * @param {{ name, email, password }} body
 * @returns {{ user: object, token: string }}
 * @throws {Error} nếu validation fail hoặc email đã tồn tại
 */
export async function registerUser({ name, email, password }) {
  // ── 1. Validate đầu vào ─────────────────────────────────────────────────
  const cleanName     = sanitize(name, 60);
  const cleanEmail    = sanitize(email, 200).toLowerCase();
  const cleanPassword = sanitize(password, 200);

  if (!cleanName) {
    throw Object.assign(new Error('Tên không được để trống.'), { statusCode: 400 });
  }
  if (!isValidEmail(cleanEmail)) {
    throw Object.assign(new Error('Email không hợp lệ.'), { statusCode: 400 });
  }
  if (cleanPassword.length < 6) {
    throw Object.assign(new Error('Mật khẩu phải có ít nhất 6 ký tự.'), { statusCode: 400 });
  }
  if (cleanPassword.length > 128) {
    throw Object.assign(new Error('Mật khẩu quá dài (tối đa 128 ký tự).'), { statusCode: 400 });
  }

  // ── 2. Kiểm tra email đã tồn tại chưa ──────────────────────────────────
  const users = await readUsers();
  const exists = users.some(u => u.email === cleanEmail);
  if (exists) {
    throw Object.assign(new Error('Email này đã được đăng ký.'), { statusCode: 409 });
  }

  // ── 3. Hash mật khẩu ────────────────────────────────────────────────────
  // bcrypt tự động tạo salt và nhúng vào hash string
  const passwordHash = await bcrypt.hash(cleanPassword, BCRYPT_SALT_ROUNDS);

  // ── 4. Tạo user record mới ──────────────────────────────────────────────
  const newUser = {
    id:           crypto.randomUUID(),
    name:         cleanName,
    email:        cleanEmail,
    passwordHash,              // ← KHÔNG bao giờ lưu mật khẩu gốc!
    createdAt:    new Date().toISOString(),
  };

  // ── 5. Lưu vào "database" ───────────────────────────────────────────────
  users.push(newUser);
  await writeUsers(users);

  // ── 6. Ký JWT token ─────────────────────────────────────────────────────
  const token = jwt.sign(
    { sub: newUser.id, email: newUser.email, name: newUser.name },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );

  // ── 7. Trả về thông tin user (KHÔNG kèm passwordHash) ──────────────────
  const { passwordHash: _removed, ...safeUser } = newUser;
  return { user: safeUser, token };
}

/**
 * Đăng nhập với email + mật khẩu.
 *
 * @param {{ email, password }} body
 * @returns {{ user: object, token: string }}
 * @throws {Error} nếu thông tin không đúng
 */
export async function loginUser({ email, password }) {
  // ── 1. Validate đầu vào ─────────────────────────────────────────────────
  const cleanEmail    = sanitize(email, 200).toLowerCase();
  const cleanPassword = sanitize(password, 200);

  if (!isValidEmail(cleanEmail) || !cleanPassword) {
    // Thông báo chung chung để tránh user enumeration attack
    throw Object.assign(new Error('Email hoặc mật khẩu không chính xác.'), { statusCode: 401 });
  }

  // ── 2. Tìm user theo email ──────────────────────────────────────────────
  const users = await readUsers();
  const user  = users.find(u => u.email === cleanEmail);

  if (!user) {
    // Vẫn gọi bcrypt để tránh timing attack (không để lộ user tồn tại hay không)
    await bcrypt.compare(cleanPassword, '$2a$12$placeholder.hash.to.prevent.timing.attack.abc');
    throw Object.assign(new Error('Email hoặc mật khẩu không chính xác.'), { statusCode: 401 });
  }

  // ── 3. Kiểm tra mật khẩu ────────────────────────────────────────────────
  const passwordMatch = await bcrypt.compare(cleanPassword, user.passwordHash);
  if (!passwordMatch) {
    throw Object.assign(new Error('Email hoặc mật khẩu không chính xác.'), { statusCode: 401 });
  }

  // ── 4. Ký JWT token ─────────────────────────────────────────────────────
  const token = jwt.sign(
    { sub: user.id, email: user.email, name: user.name },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );

  // ── 5. Trả về thông tin user (KHÔNG kèm passwordHash) ──────────────────
  const { passwordHash: _removed, ...safeUser } = user;
  return { user: safeUser, token };
}

// ════════════════════════════════════════════════════════════════════════════
// EXPRESS MIDDLEWARE
// ════════════════════════════════════════════════════════════════════════════

/**
 * Middleware xác thực JWT cho các protected route.
 *
 * Cách dùng:
 *   app.get('/api/protected', requireAuth, (req, res) => { ... });
 *
 * Client cần gửi token trong header:
 *   Authorization: Bearer <token>
 */
export function requireAuth(req, res, next) {
  try {
    // Lấy token từ Authorization header
    const authHeader = req.headers['authorization'] || '';
    const token      = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) {
      return res.status(401).json({ error: 'Chưa đăng nhập. Vui lòng cung cấp token.' });
    }

    // Verify token: kiểm tra chữ ký và thời hạn
    const payload = jwt.verify(token, JWT_SECRET);

    // Gắn thông tin user vào request để handler tiếp theo dùng
    req.user = { id: payload.sub, email: payload.email, name: payload.name };
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.' });
    }
    return res.status(401).json({ error: 'Token không hợp lệ.' });
  }
}
