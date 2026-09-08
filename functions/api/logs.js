import { json, err, requireAdmin } from '../_lib.js';

// GET /api/logs — 操作日志（管理员）
export async function onRequestGet(context) {
  const auth = await requireAdmin(context.env, context.request);
  if (auth.error) return err(auth.error, auth.status);

  const { results } = await context.env.DB.prepare(
    `SELECT id, user_id, username, action, detail, created_at
     FROM edit_logs ORDER BY id DESC LIMIT 500`
  ).all();
  return json({ logs: results });
}
