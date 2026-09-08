import {
  json, err, requireAdmin, readBody, logAction, hashPassword,
} from '../../_lib.js';

// PUT /api/users/:id — 修改成员（昵称/角色/重置密码，管理员）
// DELETE /api/users/:id — 删除成员（管理员；不能删除自己，也不能删除最后一个管理员）

export async function onRequestPut(context) {
  const auth = await requireAdmin(context.env, context.request);
  if (auth.error) return err(auth.error, auth.status);
  const me = auth.user;

  const id = Number(context.params.id);
  const target = await context.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
  if (!target) return err('用户不存在', 404);

  const body = await readBody(context.request);
  if (!body) return err('参数错误');

  const displayName = typeof body.display_name === 'string' && body.display_name.trim()
    ? body.display_name.trim().slice(0, 20) : target.display_name;

  let role = target.role;
  if (body.role === 'admin' || body.role === 'user') {
    role = body.role;
    if (id === me.id && role !== 'admin') return err('不能取消自己的管理员权限');
    if (target.role === 'admin' && role === 'user') {
      const admins = await context.env.DB.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'").first();
      if (admins.c <= 1) return err('至少要保留一个管理员');
    }
  }

  let passwordClause = '';
  let passwordArgs = [];
  if (typeof body.password === 'string' && body.password !== '') {
    if (body.password.length < 6) return err('密码至少 6 位');
    const { hash, salt } = await hashPassword(body.password);
    passwordClause = ', password_hash = ?, salt = ?';
    passwordArgs = [hash, salt];
  }

  await context.env.DB.prepare(
    `UPDATE users SET display_name = ?, role = ? ${passwordClause} WHERE id = ?`
  ).bind(displayName, role, ...passwordArgs, id).run();

  const parts = [];
  if (displayName !== target.display_name) parts.push('昵称');
  if (role !== target.role) parts.push('角色');
  if (passwordArgs.length) parts.push('重置密码');
  await logAction(context.env, me, '修改用户', `${target.username}（${parts.join('、') || '无变更'}）`);

  const updated = await context.env.DB.prepare(
    'SELECT id, username, display_name, role, created_at FROM users WHERE id = ?'
  ).bind(id).first();
  return json({ user: updated });
}

export async function onRequestDelete(context) {
  const auth = await requireAdmin(context.env, context.request);
  if (auth.error) return err(auth.error, auth.status);
  const me = auth.user;

  const id = Number(context.params.id);
  if (id === me.id) return err('不能删除自己');

  const target = await context.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
  if (!target) return err('用户不存在', 404);

  if (target.role === 'admin') {
    const admins = await context.env.DB.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'").first();
    if (admins.c <= 1) return err('至少要保留一个管理员');
  }

  await context.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id).run();
  await context.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(id).run();
  await logAction(context.env, me, '删除用户', `${target.username}（${target.display_name}）`);
  return json({ ok: true });
}
