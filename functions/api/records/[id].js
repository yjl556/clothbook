import {
  json, err, requireUser, requireAdmin, readBody, logAction,
  SHIPPING_CENTS, isDateStr, todayLocalStr, isPositiveInt,
} from '../../_lib.js';

// PUT /api/records/:id — 编辑记录（管理员或记录创建人），管理员可单独改结算状态
// DELETE /api/records/:id — 删除记录（管理员或记录创建人）

export async function onRequestPut(context) {
  const auth = await requireUser(context.env, context.request);
  if (auth.error) return err(auth.error, auth.status);
  const me = auth.user;

  const id = Number(context.params.id);
  if (!Number.isInteger(id) || id <= 0) return err('参数错误');

  const record = await context.env.DB.prepare('SELECT * FROM records WHERE id = ?').bind(id).first();
  if (!record) return err('记录不存在', 404);

  const isAdmin = me.role === 'admin';
  const isCreator = record.created_by === me.id;
  if (!isAdmin && !isCreator) return err('只能编辑自己创建的记录', 403);

  const body = await readBody(context.request);
  if (!body) return err('参数错误');

  // 仅改状态（管理员）：发货 未结算<->已结算；退货 未退款<->已退款
  if (body.status !== undefined) {
    if (!isAdmin) return err('只有管理员可以标记结算状态', 403);
    if (body.status !== 'unsettled' && body.status !== 'settled') return err('状态值非法');
    await context.env.DB.prepare('UPDATE records SET status = ?, updated_by = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .bind(body.status, me.id, id).run();
    const label = record.type === 'ship'
      ? (body.status === 'settled' ? '标记发货为已结算' : '标记发货为未结算')
      : (body.status === 'settled' ? '标记退货为已退款' : '标记退货为未退款');
    await logAction(context.env, me, label, `记录 #${id} ${record.product_code}`);
    const updated = await context.env.DB.prepare('SELECT * FROM records WHERE id = ?').bind(id).first();
    return json({ record: updated });
  }

  // 编辑内容
  const changes = [];
  let type = record.type;
  let userId = record.user_id;
  let productCode = record.product_code;
  let quantity = record.quantity;
  let recordDate = record.record_date;
  let note = record.note;

  if (body.type === 'ship' || body.type === 'return') { type = body.type; changes.push('类型'); }
  if (body.user_id !== undefined) {
    const t = await context.env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(Number(body.user_id)).first();
    if (!t) return err('成员不存在');
    userId = Number(body.user_id); changes.push('成员');
  }
  if (typeof body.product_code === 'string' && body.product_code.trim()) {
    const newCode = body.product_code.trim();
    if (newCode !== record.product_code) {
      const prod = await context.env.DB.prepare('SELECT product_code, price_cents FROM products WHERE product_code = ?')
        .bind(newCode).first();
      if (!prod) return err('货号不存在');
      productCode = prod.product_code; changes.push('货号');
    } else {
      productCode = record.product_code;
    }
  }
  if (body.quantity !== undefined) {
    if (!isPositiveInt(Number(body.quantity))) return err('数量必须是大于等于 1 的整数');
    quantity = Number(body.quantity); changes.push('数量');
  }
  if (body.record_date !== undefined) {
    if (!isDateStr(body.record_date)) return err('日期格式应为 YYYY-MM-DD');
    recordDate = body.record_date; changes.push('日期');
  }
  if (body.note !== undefined) { note = String(body.note).trim().slice(0, 100); changes.push('备注'); }

  // 取最新单价重算金额（发货加运费，退货不加）
  const product = await context.env.DB.prepare('SELECT price_cents FROM products WHERE product_code = ?')
    .bind(productCode).first();
  const unitPrice = product ? product.price_cents : record.unit_price_cents;
  const shipping = type === 'ship' ? SHIPPING_CENTS : 0;
  const amount = quantity * unitPrice + shipping;

  await context.env.DB.prepare(
    `UPDATE records SET type = ?, user_id = ?, product_code = ?, quantity = ?,
     unit_price_cents = ?, shipping_cents = ?, amount_cents = ?, record_date = ?, note = ?,
     updated_by = ?, updated_at = datetime('now') WHERE id = ?`
  ).bind(type, userId, productCode, quantity, unitPrice, shipping, amount, recordDate, note, me.id, id).run();

  await logAction(context.env, me, '修改记录', `记录 #${id} ${productCode}（${changes.join('、')}）金额 ${(amount / 100).toFixed(2)} 元`);

  const updated = await context.env.DB.prepare('SELECT * FROM records WHERE id = ?').bind(id).first();
  return json({ record: updated });
}

export async function onRequestDelete(context) {
  const auth = await requireUser(context.env, context.request);
  if (auth.error) return err(auth.error, auth.status);
  const me = auth.user;

  const id = Number(context.params.id);
  if (!Number.isInteger(id) || id <= 0) return err('参数错误');

  const record = await context.env.DB.prepare('SELECT * FROM records WHERE id = ?').bind(id).first();
  if (!record) return err('记录不存在', 404);

  const isAdmin = me.role === 'admin';
  const isCreator = record.created_by === me.id;
  if (!isAdmin && !isCreator) return err('只能删除自己创建的记录', 403);

  await context.env.DB.prepare('DELETE FROM records WHERE id = ?').bind(id).run();
  await logAction(context.env, me, '删除记录', `记录 #${id} ${record.product_code}（${record.type === 'ship' ? '发货' : '退货'}）`);
  return json({ ok: true });
}
