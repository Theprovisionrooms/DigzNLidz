// POST /api/bookings/:id/redeem-seat
// Staff-only. When a paid booking's party arrives, staff pick a free seat
// and a tier for each person and this starts their session with no
// charge, since it's already paid for as part of the booking. Tracks how
// many of each tier have been redeemed so the same paid seat can't be
// used twice.

import { isAuthenticated, unauthorizedResponse } from "../../../lib/auth.js";
import { getTierConfig } from "../../../lib/settings.js";

export async function onRequestPost({ params, request, env }) {
  if (!(await isAuthenticated(request, env))) return unauthorizedResponse();

  const bookingId = params.id;
  const { seatId, tier } = await request.json();

  if (!seatId || !["tier_1", "tier_2", "tier_3"].includes(tier)) {
    return Response.json({ error: "seatId and a valid tier are required" }, { status: 400 });
  }

  const booking = await env.DB.prepare(`SELECT * FROM bookings WHERE id = ?`).bind(bookingId).first();
  if (!booking) return Response.json({ error: "booking not found" }, { status: 404 });
  if (booking.payment_status !== "paid") {
    return Response.json({ error: "this booking hasn't been paid yet" }, { status: 409 });
  }

  const breakdown = JSON.parse(booking.tier_breakdown_json || "{}");
  const redeemed = JSON.parse(booking.tier_redeemed_json || "{}");
  const paidFor = Number(breakdown[tier]) || 0;
  const alreadyRedeemed = Number(redeemed[tier]) || 0;

  if (alreadyRedeemed >= paidFor) {
    return Response.json({ error: `All ${tier.replace("tier_", "tier ")} seats from this booking are already redeemed` }, { status: 409 });
  }

  const seat = await env.DB.prepare(`SELECT * FROM seats WHERE id = ?`).bind(seatId).first();
  if (!seat) return Response.json({ error: "seat not found" }, { status: 404 });
  if (seat.status !== "free") {
    return Response.json({ error: "seat is not free" }, { status: 409 });
  }

  // Atomic claim, same reasoning as seats/[id]/start.js: if a guest's own
  // scan and a staff member's manual redeem land on the same seat at once,
  // only one should win.
  const claim = await env.DB.prepare(
    `UPDATE seats SET status = 'starting' WHERE id = ? AND status = 'free'`
  )
    .bind(seatId)
    .run();
  if (!claim.meta.changes) {
    return Response.json({ error: "seat is not free" }, { status: 409 });
  }

  const tierConfig = await getTierConfig(env.DB, tier);
  const startedAt = new Date();
  const endsAt = new Date(startedAt.getTime() + tierConfig.minutes * 60 * 1000);

  const insert = await env.DB.prepare(
    `INSERT INTO sessions (seat_id, tier, started_at, ends_at)
     VALUES (?, ?, ?, ?)`
  )
    .bind(seatId, tier, startedAt.toISOString(), endsAt.toISOString())
    .run();

  const sessionId = insert.meta.last_row_id;

  await env.DB.prepare(`UPDATE seats SET status = 'active', current_session_id = ? WHERE id = ?`)
    .bind(sessionId, seatId)
    .run();

  redeemed[tier] = alreadyRedeemed + 1;
  await env.DB.prepare(`UPDATE bookings SET tier_redeemed_json = ? WHERE id = ?`)
    .bind(JSON.stringify(redeemed), bookingId)
    .run();

  return Response.json({ sessionId, endsAt: endsAt.toISOString() });
}
