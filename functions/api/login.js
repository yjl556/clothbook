import {
  json, err, readBody, hashPassword, verifyPassword, randomToken,
  sessionCookie, logAction,
} from '../_lib.js';

// POST /api/login
export async function onRequestPost(context) {
  const { env, request } = context;
  const body = await readBody(request);
  if (!body || typeof body.username !== 'string' || typeof body.password !== 'string') {
    return err('参数错误');
  }
  const username = body.username.trim();
  if (!username) return err('请输入账号');

  // 全新数据库：自动创建默认管理员 admin / admin123（首次登录后请立即改密码）
  const cnt = await env.DB.prepare('SELECT COUNT(*) AS c FROM users').first();
  if (cnt.c === 0) {
    const { hash, salt } = await hashPassword('admin123');
    await env.DB.prepare(
      'INSERT INTO users (username, password_hash, salt, role, display_name) VALUES (?, ?, ?, ?, ?)'
    ).bind('admin', hash, salt, 'admin', '管理员').run();
    await logAction(env, null, '系统初始化', '已创建默认管理员 admin（默认密码 admin123）');
  }

  const user = await env.DB.prepare('SELECT * FROM users WHERE username = ?').bind(username).first();
  if (!user) return err('账号或密码错误', 401);
  const ok = await verifyPassword(body.password, user.salt, user.password_hash);
  if (!ok) return err('账号或密码错误', 401);

  const token = randomToken();
  const expiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
  await env.DB.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(token, user.id, expiresAt).run();
  await logAction(env, user, '登录');

  const resp = json({
    user: { id: user.id, username: user.username, display_name: user.display_name, role: user.role },
  });
  resp.headers.append('Set-Cookie', sessionCookie(token));
  return resp;
}
