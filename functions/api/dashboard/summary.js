// GET /api/dashboard/summary
// Everything the dashboard front page needs in one call: today/week
// bookings, revenue by source, mailing list size, pending corporate
// enquiries, and live seat status.

import { isAuthenticated, unauthorizedResponse } from "../../lib/auth.js";

export async function onRequestGet({ request, env }) {
  if (!(await isAuthenticated(request, env))) return unauthorizedResponse();

  const db = env.DB;
  const today = new Date().toISOString().slice(0, 10);

  const [
    bookingsToday,
    bookingsTodayDetail,
    bookingsWeek,
    bookingRevenue,
    orderRevenue,
    extensionRevenue,
    seats,
    pendingCorporate,
    acceptedCorporate,
    mailingListCount,
    mailingListTrend,
    mailingListBySegment,
    campaignPerformance,
  ] = await Promise.all([
    db.prepare(`SELECT COUNT(*) as n, type FROM bookings WHERE booking_date = ? GROUP BY type`).bind(today).all(),
    // Full detail for today, sorted by slot, so staff know exactly how
    // many seats to hold free and when, not just a headline count.
    db.prepare(
      `SELECT id, name, type, party_size, slot_time, payment_status, tier_breakdown_json, tier_redeemed_json
       FROM bookings WHERE booking_date = ? ORDER BY slot_time ASC`
    ).bind(today).all(),
    // created_at is SQLite's own datetime('now') default ("YYYY-MM-DD
    // HH:MM:SS"), so the cutoff needs to be computed by SQLite too, a JS
    // toISOString() string uses a "T" separator instead of a space and
    // silently fails to match on same-day comparisons (space sorts before
    // "T", so "today, spot on 7 days ago" could look earlier than it is).
    db.prepare(`SELECT COUNT(*) as n FROM bookings WHERE created_at >= datetime('now', '-7 days')`).first(),
    db.prepare(`SELECT COALESCE(SUM(total_amount_pence),0) as total FROM bookings WHERE payment_status = 'paid'`).first(),
    db.prepare(`SELECT COALESCE(SUM(total_pence),0) as total FROM orders`).first(),
    // Actual amount charged for extensions, recorded per session at the
    // time each one was charged, not (count * today's price), which used
    // to silently misreport history any time the price setting changed.
    db.prepare(`SELECT COALESCE(SUM(extensions_revenue_pence),0) as total FROM sessions`).first(),
    db.prepare(`SELECT * FROM seats ORDER BY id`).all(),
    db.prepare(`SELECT * FROM corporate_enquiries WHERE status = 'new' ORDER BY created_at DESC`).all(),
    // Accepted and confirmed both mean "this event is happening", just via
    // different payment routes (cash on site vs a Square link). Shown
    // together so staff can see everything actually coming up, not just
    // the ones still waiting on a first response.
    db.prepare(
      `SELECT * FROM corporate_enquiries WHERE status IN ('accepted', 'confirmed') ORDER BY event_date ASC`
    ).all(),
    db.prepare(`SELECT COUNT(*) as n FROM mailing_list`).first(),
    // Weekly signup counts, last 8 weeks, newest first.
    db.prepare(
      `SELECT strftime('%Y-W%W', created_at) as week, COUNT(*) as n
       FROM mailing_list GROUP BY week ORDER BY week DESC LIMIT 8`
    ).all(),
    // Party-type segments for targeting promos, e.g. a couples offer
    // only going to people who've booked as a couple. tags is a
    // comma-separated list (see functions/api/mailing-list/index.js),
    // so this is counted in JS below rather than with SQL GROUP BY.
    db.prepare(`SELECT tags FROM mailing_list WHERE tags IS NOT NULL AND tags != ''`).all(),
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

  const segmentCounts = {};
  for (const row of mailingListBySegment.results) {
    for (const tag of row.tags.split(",").map((t) => t.trim()).filter(Boolean)) {
      segmentCounts[tag] = (segmentCounts[tag] || 0) + 1;
    }
  }
  const mailingListSegments = Object.entries(segmentCounts)
    .map(([tag, n]) => ({ tag, n }))
    .sort((a, b) => b.n - a.n);

  return Response.json({
    bookingsToday: bookingsToday.results,
    bookingsTodayDetail: bookingsTodayDetail.results,
    bookingsThisWeek: bookingsWeek.n,
    revenue: {
      bookingsPence: bookingRevenue.total,
      foodDrinkPence: orderRevenue.total,
      extensionsPence: extensionRevenue.total,
    },
    seats: seats.results,
    pendingCorporateEnquiries: pendingCorporate.results,
    upcomingCorporateEvents: acceptedCorporate.results,
    mailingListCount: mailingListCount.n,
    mailingListTrend: mailingListTrend.results.reverse(),
    mailingListSegments,
    campaignPerformance: campaignPerformance.results,
  });
}
