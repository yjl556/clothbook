import {
  json, err, requireAdmin, readBody, logAction, hashPassword,
} from '../_lib.js';

// GET /api/users — 成员列表（管理员）
export async function onRequestGet(context) {
  const auth = await requireAdmin(context.env, context.request);
  if (auth.error) return err(auth.error, auth.status);

  const { results } = await context.env.DB.prepare(
    `SELECT u.id, u.username, u.display_name, u.role, u.created_at,
            (SELECT COUNT(*) FROM records r WHERE r.user_id = u.id) AS record_count
     FROM users u ORDER BY u.id`
  ).all();
  return json({ users: results });
}

// POST /api/users — 添加成员（管理员）
export async function onRequestPost(context) {
  const auth = await requireAdmin(context.env, context.request);
  if (auth.error) return err(auth.error, auth.status);

  const body = await readBody(context.request);
  if (!body) return err('参数错误');

  const username = typeof body.username === 'string' ? body.username.trim() : '';
  if (!username) return err('请填写账号名');
  if (!/^[a-zA-Z0-9_\u4e00-\u9fa5]{2,30}$/.test(username)) return err('账号名需 2-30 位（中文/字母/数字/下划线）');
  const password = typeof body.password === 'string' ? body.password : '';
  if (password.length < 6) return err('密码至少 6 位');
  const displayName = typeof body.display_name === 'string' && body.display_name.trim()
    ? body.display_name.trim().slice(0, 20) : username;
  const role = body.role === 'admin' ? 'admin' : 'user';

  const exists = await context.env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();
  if (exists) return err('该账号名已存在');

  const { hash, salt } = await hashPassword(password);
  const info = await context.env.DB.prepare(
    'INSERT INTO users (username, password_hash, salt, role, display_name) VALUES (?, ?, ?, ?, ?)'
  ).bind(username, hash, salt, role, displayName).run();

  await logAction(context.env, auth.user, '新增用户', `${username}（${displayName}，${role === 'admin' ? '管理员' : '普通用户'}）`);
  const created = await context.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(info.meta.last_row_id).first();
  return json({ user: created }, 201);
}
