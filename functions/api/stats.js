import { json, err, requireUser } from '../_lib.js';

// GET /api/stats — 按成员汇总：发货/退货条数、金额、结算情况、未收回金额
// 未收回总额 = 未结算的发货货款 + 未退款的退货金额
export async function onRequestGet(context) {
  const auth = await requireUser(context.env, context.request);
  if (auth.error) return err(auth.error, auth.status);

  const sql = `
    SELECT u.id AS user_id, u.display_name, u.username,
      COALESCE(SUM(CASE WHEN r.type='ship' THEN r.quantity ELSE 0 END), 0) AS ship_qty,
      COALESCE(COUNT(CASE WHEN r.type='ship' THEN 1 END), 0) AS ship_count,
      COALESCE(SUM(CASE WHEN r.type='ship' THEN r.amount_cents ELSE 0 END), 0) AS ship_amount,
      COALESCE(SUM(CASE WHEN r.type='ship' AND r.status='settled' THEN r.amount_cents ELSE 0 END), 0) AS ship_settled,
      COALESCE(SUM(CASE WHEN r.type='ship' AND r.status='unsettled' THEN r.amount_cents ELSE 0 END), 0) AS ship_unsettled,
      COALESCE(SUM(CASE WHEN r.type='return' THEN r.quantity ELSE 0 END), 0) AS return_qty,
      COALESCE(COUNT(CASE WHEN r.type='return' THEN 1 END), 0) AS return_count,
      COALESCE(SUM(CASE WHEN r.type='return' THEN r.amount_cents ELSE 0 END), 0) AS return_amount,
      COALESCE(SUM(CASE WHEN r.type='return' AND r.status='settled' THEN r.amount_cents ELSE 0 END), 0) AS return_settled,
      COALESCE(SUM(CASE WHEN r.type='return' AND r.status='unsettled' THEN r.amount_cents ELSE 0 END), 0) AS return_unsettled
    FROM users u
    LEFT JOIN records r ON r.user_id = u.id
    GROUP BY u.id
    ORDER BY u.id`;

  const { results } = await context.env.DB.prepare(sql).all();

  const users = results.map((r) => ({
    user_id: r.user_id,
    display_name: r.display_name || r.username || '（已删除）',
    ship_qty: r.ship_qty,
    ship_count: r.ship_count,
    ship_amount: r.ship_amount,
    ship_settled: r.ship_settled,
    ship_unsettled: r.ship_unsettled,
    return_qty: r.return_qty,
    return_count: r.return_count,
    return_amount: r.return_amount,
    return_settled: r.return_settled,
    return_unsettled: r.return_unsettled,
    outstanding: r.ship_unsettled + r.return_unsettled,
  }));

  const total = users.reduce(
    (t, u) => ({
      ship_qty: t.ship_qty + u.ship_qty,
      ship_count: t.ship_count + u.ship_count,
      ship_amount: t.ship_amount + u.ship_amount,
      ship_settled: t.ship_settled + u.ship_settled,
      ship_unsettled: t.ship_unsettled + u.ship_unsettled,
      return_qty: t.return_qty + u.return_qty,
      return_count: t.return_count + u.return_count,
      return_amount: t.return_amount + u.return_amount,
      return_settled: t.return_settled + u.return_settled,
      return_unsettled: t.return_unsettled + u.return_unsettled,
      outstanding: t.outstanding + u.outstanding,
    }),
    { ship_qty: 0, ship_count: 0, ship_amount: 0, ship_settled: 0, ship_unsettled: 0,
      return_qty: 0, return_count: 0, return_amount: 0, return_settled: 0, return_unsettled: 0, outstanding: 0 }
  );

  return json({ users, total });
}
