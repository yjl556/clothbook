import {
  json, err, requireUser, requireAdmin, readBody, logAction,
  SHIPPING_CENTS, isDateStr, todayLocalStr, isPositiveInt,
} from '../_lib.js';

// GET /api/records?user_id=&type=&status=&month=&from=&to=
export async function onRequestGet(context) {
  const auth = await requireUser(context.env, context.request);
  if (auth.error) return err(auth.error, auth.status);

  const url = new URL(context.request.url);
  const conds = [];
  const args = [];
  const p = url.searchParams;

  if (p.get('user_id')) { conds.push('r.user_id = ?'); args.push(Number(p.get('user_id'))); }
  if (p.get('type')) { conds.push('r.type = ?'); args.push(p.get('type')); }
  if (p.get('status')) { conds.push('r.status = ?'); args.push(p.get('status')); }
  const month = p.get('month');
  if (month && /^\d{4}-\d{2}$/.test(month)) { conds.push('r.record_date LIKE ?'); args.push(month + '%'); }
  if (p.get('from')) { conds.push('r.record_date >= ?'); args.push(p.get('from')); }
  if (p.get('to')) { conds.push('r.record_date <= ?'); args.push(p.get('to')); }

  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  const sql = `
    SELECT r.*, u.display_name AS user_name, u.username AS user_username,
           c.display_name AS creator_name
    FROM records r
    LEFT JOIN users u ON u.id = r.user_id
    LEFT JOIN users c ON c.id = r.created_by
    ${where}
    ORDER BY r.record_date DESC, r.id DESC
    LIMIT 2000`;
  const { results } = await context.env.DB.prepare(sql).bind(...args).all();
  return json({ records: results });
}

// POST /api/records — 新增发货/退货记录
// 规则：发货 = 数量×单价 + 5元运费；退货 = 数量×单价（不退运费）
export async function onRequestPost(context) {
  const auth = await requireUser(context.env, context.request);
  if (auth.error) return err(auth.error, auth.status);
  const me = auth.user;

  const body = await readBody(context.request);
  if (!body) return err('参数错误');

  if (body.type !== 'ship' && body.type !== 'return') return err('类型必须是发货或退货');
  if (!isPositiveInt(Number(body.quantity))) return err('数量必须是大于等于 1 的整数');
  if (typeof body.product_code !== 'string' || !body.product_code.trim()) return err('请选择货号');
  const productCode = body.product_code.trim();

  const targetUser = await context.env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(Number(body.user_id)).first();
  if (!targetUser) return err('成员不存在');

  const product = await context.env.DB.prepare('SELECT product_code, price_cents FROM products WHERE product_code = ?')
    .bind(productCode).first();
  if (!product) return err('货号不存在，请管理员先在「管理-货号」中添加');

  const recordDate = body.record_date && isDateStr(body.record_date) ? body.record_date : todayLocalStr();
  const quantity = Number(body.quantity);
  const unitPrice = product.price_cents;
  const shipping = body.type === 'ship' ? SHIPPING_CENTS : 0;
  const amount = quantity * unitPrice + shipping;
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 100) : '';

  const info = await context.env.DB.prepare(
    `INSERT INTO records (type, user_id, product_code, quantity, unit_price_cents, shipping_cents, amount_cents, status, record_date, note, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'unsettled', ?, ?, ?)`
  ).bind(body.type, Number(body.user_id), productCode, quantity, unitPrice, shipping, amount, recordDate, note, me.id).run();

  await logAction(context.env, me, body.type === 'ship' ? '新增发货记录' : '新增退货记录',
    `${recordDate} | ${body.type === 'ship' ? '发货' : '退货'} | ${productCode} ×${quantity} | 金额 ${(amount / 100).toFixed(2)} 元`);

  const created = await context.env.DB.prepare('SELECT * FROM records WHERE id = ?').bind(info.meta.last_row_id).first();
  return json({ record: created }, 201);
}
