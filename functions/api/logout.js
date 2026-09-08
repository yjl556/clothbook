import { json, parseCookies, clearSessionCookie } from '../_lib.js';

// POST /api/logout
export async function onRequestPost(context) {
  const { env, request } = context;
  const cookies = parseCookies(request.headers.get('Cookie') || '');
  if (cookies.session) {
    await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(cookies.session).run();
  }
  const resp = json({ ok: true });
  resp.headers.append('Set-Cookie', clearSessionCookie());
  return resp;
}
