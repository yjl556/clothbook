import {
  json, err, requireAdmin, readBody, logAction, yuanToCents,
} from '../../_lib.js';

// PUT /api/products/:id — 修改货号（管理员）
// DELETE /api/products/:id — 删除货号（管理员）

export async function onRequestPut(context) {
  const auth = await requireAdmin(context.env, context.request);
  if (auth.error) return err(auth.error, auth.status);

  const id = Number(context.params.id);
  const product = await context.env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(id).first();
  if (!product) return err('货号不存在', 404);

  const body = await readBody(context.request);
  if (!body) return err('参数错误');

  const code = typeof body.product_code === 'string' ? body.product_code.trim() : product.product_code;
  if (!code) return err('货号不能为空');
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 100) : product.name;
  let priceCents = product.price_cents;
  if (body.price !== undefined) {
    const v = yuanToCents(body.price);
    if (v === null) return err('单价必须是大于等于 0 的数字');
    priceCents = v;
  }

  if (code !== product.product_code) {
    const exists = await context.env.DB.prepare('SELECT id FROM products WHERE product_code = ?').bind(code).first();
    if (exists) return err('该货号已存在');
  }

  await context.env.DB.prepare(
    'UPDATE products SET product_code = ?, name = ?, price_cents = ? WHERE id = ?'
  ).bind(code, name, priceCents, id).run();

  await logAction(context.env, auth.user, '修改货号',
    `${product.product_code} → ${code}，单价 ${(priceCents / 100).toFixed(2)} 元`);
  const updated = await context.env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(id).first();
  return json({ product: updated });
}

export async function onRequestDelete(context) {
  const auth = await requireAdmin(context.env, context.request);
  if (auth.error) return err(auth.error, auth.status);

  const id = Number(context.params.id);
  const product = await context.env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(id).first();
  if (!product) return err('货号不存在', 404);

  // 已有关联记录不影响删除（记录中保存了货号快照）
  await context.env.DB.prepare('DELETE FROM products WHERE id = ?').bind(id).run();
  await logAction(context.env, auth.user, '删除货号', product.product_code);
  return json({ ok: true });
}
