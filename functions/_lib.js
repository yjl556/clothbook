// ============================================================
// 共享工具：响应、会话、密码哈希、日志、数据校验
// 所有 /api 路由都从这里引入
// ============================================================

const enc = new TextEncoder();

export const SHIPPING_CENTS = 500; // 每笔发货自动加 5 元运费（500 分）
export const SESSION_DAYS = 30; // 登录会话有效期（天）
export const PBKDF2_ITERATIONS = 100000;

// ---------- 响应 ----------
export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export function err(message, status = 400) {
  return json({ error: message }, status);
}

// ---------- 字节/hex 工具 ----------
export function bytesToHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function randomToken() {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(24)));
}

// ---------- 密码哈希（PBKDF2-SHA256） ----------
export async function hashPassword(password, saltHex) {
  const salt = saltHex ? hexToBytes(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  return { hash: bytesToHex(new Uint8Array(bits)), salt: bytesToHex(salt) };
}

export async function verifyPassword(password, saltHex, expectedHash) {
  const { hash } = await hashPassword(password, saltHex);
  return hash === expectedHash;
}

// ---------- Cookie / 会话 ----------
export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > -1) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

export function sessionCookie(token) {
  return `session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 24 * 3600}`;
}

export function clearSessionCookie() {
  return 'session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
}

export async function getCurrentUser(env, request) {
  const cookies = parseCookies(request.headers.get('Cookie') || '');
  const token = cookies.session;
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT u.id, u.username, u.display_name, u.role, s.expires_at
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ?`
  ).bind(token).first();
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
    return null;
  }
  return row;
}

// ---------- 权限 ----------
// 返回 { user } 或 { error, status }
export async function requireUser(env, request) {
  const user = await getCurrentUser(env, request);
  if (!user) return { error: '未登录或登录已过期', status: 401 };
  return { user };
}

export async function requireAdmin(env, request) {
  const user = await getCurrentUser(env, request);
  if (!user) return { error: '未登录或登录已过期', status: 401 };
  if (user.role !== 'admin') return { error: '该操作需要管理员权限', status: 403 };
  return { user };
}

// ---------- 操作日志 ----------
export async function logAction(env, user, action, detail = '') {
  await env.DB.prepare(
    'INSERT INTO edit_logs (user_id, username, action, detail) VALUES (?, ?, ?, ?)'
  ).bind(user ? user.id : null, user ? user.username : 'system', action, detail).run();
}

// ---------- 请求体与校验 ----------
export async function readBody(request) {
  try {
    const data = await request.json();
    return data && typeof data === 'object' ? data : null;
  } catch {
    return null;
  }
}

export function isDateStr(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export function todayLocalStr() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

// 把“元”字符串转成“分”（整数），返回 null 表示非法
export function yuanToCents(v) {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

export function isPositiveInt(v) {
  return Number.isInteger(v) && v >= 1;
}
