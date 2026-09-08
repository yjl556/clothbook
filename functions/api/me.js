import { json } from '../_lib.js';

// GET /api/me — 返回当前登录用户
export async function onRequestGet(context) {
  const { env, request } = context;
  const cookies = Object.fromEntries(
    (request.headers.get('Cookie') || '').split(';').filter(Boolean).map((p) => {
      const i = p.indexOf('=');
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    })
  );
  if (!cookies.session) return json({ user: null }, 401);

  const row = await env.DB.prepare(
    `SELECT u.id, u.username, u.display_name, u.role, s.expires_at
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ?`
  ).bind(cookies.session).first();

  if (!row || new Date(row.expires_at).getTime() < Date.now()) return json({ user: null }, 401);
  return json({ user: { id: row.id, username: row.username, display_name: row.display_name, role: row.role } });
}
