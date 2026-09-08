import {
  json, err, requireUser, requireAdmin, readBody, logAction, yuanToCents,
} from '../_lib.js';

// GET /api/products — 货号列表（登录用户即可看）
export async function onRequestGet(context) {
  const auth = await requireUser(context.env, context.request);
  if (auth.error) return err(auth.error, auth.status);
  const { results } = await context.env.DB.prepare(
    'SELECT id, product_code, name, price_cents, created_at FROM products ORDER BY id'
  ).all();
  return json({ products: results });
}

// POST /api/products — 添加货号（管理员）
export async function onRequestPost(context) {
  const auth = await requireAdmin(context.env, context.request);
  if (auth.error) return err(auth.error, auth.status);

  const body = await readBody(context.request);
  if (!body) return err('参数错误');

  const code = typeof body.product_code === 'string' ? body.product_code.trim() : '';
  if (!code) return err('请填写货号');
  if (code.length > 50) return err('货号太长（最多 50 字）');
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 100) : '';
  const priceCents = yuanToCents(body.price);
  if (priceCents === null) return err('单价必须是大于等于 0 的数字');

  const exists = await context.env.DB.prepare('SELECT id FROM products WHERE product_code = ?').bind(code).first();
  if (exists) return err('该货号已存在');

  const info = await context.env.DB.prepare(
    'INSERT INTO products (product_code, name, price_cents) VALUES (?, ?, ?)'
  ).bind(code, name, priceCents).run();

  await logAction(context.env, auth.user, '新增货号', `${code} 单价 ${(priceCents / 100).toFixed(2)} 元`);
  const created = await context.env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(info.meta.last_row_id).first();
  return json({ product: created }, 201);
}
