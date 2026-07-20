// GET /api/dashboard/summary
// Everything the dashboard front page needs in one call: today/week
// bookings, revenue by source, mailing list size, pending corporate
// enquiries, and live seat status.

import { isAuthenticated, unauthorizedResponse } from "../../lib/auth.js";

export async function onRequestGet({ request, env }) {
  if (!(await isAuthenticated(request, env))) return unauthorizedResponse();

  const db = env.DB;
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [
    bookingsToday,
    bookingsWeek,
    depositRevenue,
    orderRevenue,
    extensionCount,
    seats,
    pendingCorporate,
    mailingListCount,
    mailingListTrend,
    campaignPerformance,
  ] = await Promise.all([
    db.prepare(`SELECT COUNT(*) as n, type FROM bookings WHERE booking_date = ? GROUP BY type`).bind(today).all(),
    db.prepare(`SELECT COUNT(*) as n FROM bookings WHERE created_at >= ?`).bind(weekAgo).first(),
    db.prepare(`SELECT COALESCE(SUM(deposit_amount_pence),0) as total FROM bookings WHERE deposit_status = 'paid'`).first(),
    db.prepare(`SELECT COALESCE(SUM(total_pence),0) as total FROM orders`).first(),
    db.prepare(`SELECT COALESCE(SUM(extensions_count),0) as total FROM sessions`).first(),
    db.prepare(`SELECT * FROM seats ORDER BY id`).all(),
    db.prepare(`SELECT * FROM corporate_enquiries WHERE status = 'new' ORDER BY created_at DESC`).all(),
    db.prepare(`SELECT COUNT(*) as n FROM mailing_list`).first(),
    // Weekly signup counts, last 8 weeks, newest first.
    db.prepare(
      `SELECT strftime('%Y-W%W', created_at) as week, COUNT(*) as n
       FROM mailing_list GROUP BY week ORDER BY week DESC LIMIT 8`
    ).all(),
    // Redemption counts rolled up per campaign, not just per code.
    db.prepare(
      `SELECT c.id, c.name, c.type, c.sent_at,
              COUNT(dc.code) as codeCount,
              COALESCE(SUM(dc.uses),0) as redemptions
       FROM campaigns c
       LEFT JOIN discount_codes dc ON dc.campaign_id = c.id
       GROUP BY c.id ORDER BY c.created_at DESC`
    ).all(),
  ]);

  const extensionRevenue = await db
    .prepare(`SELECT value FROM settings WHERE key = 'extension_price_pence'`)
    .first();
  const extensionPricePence = Number(extensionRevenue?.value || 0);

  return Response.json({
    bookingsToday: bookingsToday.results,
    bookingsThisWeek: bookingsWeek.n,
    revenue: {
      depositsPence: depositRevenue.total,
      foodDrinkPence: orderRevenue.total,
      extensionsPence: extensionCount.total * extensionPricePence,
    },
    seats: seats.results,
    pendingCorporateEnquiries: pendingCorporate.results,
    mailingListCount: mailingListCount.n,
    mailingListTrend: mailingListTrend.results.reverse(),
    campaignPerformance: campaignPerformance.results,
  });
}
