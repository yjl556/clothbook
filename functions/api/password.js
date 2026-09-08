import {
  json, err, requireUser, readBody, hashPassword, verifyPassword, logAction, parseCookies,
} from '../_lib.js';

// PUT /api/password — 修改自己的密码
export async function onRequestPut(context) {
  const auth = await requireUser(context.env, context.request);
  if (auth.error) return err(auth.error, auth.status);
  const me = auth.user;

  const body = await readBody(context.request);
  if (!body || typeof body.old_password !== 'string' || typeof body.new_password !== 'string') {
    return err('参数错误');
  }
  if (body.new_password.length < 6) return err('新密码至少 6 位');

  const row = await context.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(me.id).first();
  const ok = await verifyPassword(body.old_password, row.salt, row.password_hash);
  if (!ok) return err('原密码不正确');

  const { hash, salt } = await hashPassword(body.new_password);
  await context.env.DB.prepare('UPDATE users SET password_hash = ?, salt = ? WHERE id = ?')
    .bind(hash, salt, me.id).run();

  // 修改密码后让其他设备下线（保留当前登录）
  const cookies = parseCookies(context.request.headers.get('Cookie') || '');
  await context.env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?')
    .bind(me.id, cookies.session || '').run();
  await logAction(context.env, me, '修改密码', '账号密码已修改，其他登录已失效');

  return json({ ok: true });
}
