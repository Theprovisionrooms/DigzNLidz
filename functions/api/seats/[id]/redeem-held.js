// POST /api/seats/:id/redeem-held
// Called automatically by the seat page (see public/assets/js/seat.js)
// the moment a guest scans a seat that's been held for their booking.
// No staff involved and no payment screen: the seat already knows which
// booking and which tier it's holding (set by the auto-hold pass in
// workers/session-expiry-cron.js), so this just starts the session, the
// same as functions/api/bookings/[id]/redeem-seat.js but triggered by
// the guest's own scan instead of a staff member picking a seat.

import { getTierConfig } from "../../../lib/settings.js";

export async function onRequestPost({ params, env }) {
  const seatId = params.id;

  const seat = await env.DB.prepare(`SELECT * FROM seats WHERE id = ?`).bind(seatId).first();
  if (!seat) return Response.json({ error: "seat not found" }, { status: 404 });
  if (seat.status !== "held" || !seat.held_booking_id || !seat.held_tier) {
    return Response.json({ error: "seat is not being held for a booking" }, { status: 409 });
  }

  // Atomic claim: two people from the same mixed-tier booking could both
  // tap "confirm" on the same held seat within the same moment (see the
  // comment in seat.js about holds not being tied to a named person).
  // Only one should be able to redeem it.
  const claim = await env.DB.prepare(
    `UPDATE seats SET status = 'starting' WHERE id = ? AND status = 'held'`
  )
    .bind(seatId)
    .run();
  if (!claim.meta.changes) {
    return Response.json({ error: "seat is not being held for a booking" }, { status: 409 });
  }

  const booking = await env.DB.prepare(`SELECT * FROM bookings WHERE id = ?`)
    .bind(seat.held_booking_id)
    .first();
  if (!booking) return Response.json({ error: "booking not found" }, { status: 404 });

  const tier = seat.held_tier;
  const tierConfig = await getTierConfig(env.DB, tier);
  const startedAt = new Date();
  const endsAt = new Date(startedAt.getTime() + tierConfig.minutes * 60 * 1000);

  const insert = await env.DB.prepare(
    `INSERT INTO sessions (seat_id, tier, started_at, ends_at) VALUES (?, ?, ?, ?)`
  )
    .bind(seatId, tier, startedAt.toISOString(), endsAt.toISOString())
    .run();
  const sessionId = insert.meta.last_row_id;

  await env.DB.prepare(
    `UPDATE seats
     SET status = 'active', current_session_id = ?, held_booking_id = NULL, held_tier = NULL, held_until = NULL
     WHERE id = ?`
  )
    .bind(sessionId, seatId)
    .run();

  // Same tier_redeemed_json bookkeeping as the staff-driven redeem-seat
  // flow, so the "hold seats today" panel and any future redemptions
  // for this booking stay accurate either way.
  const redeemed = JSON.parse(booking.tier_redeemed_json || "{}");
  redeemed[tier] = (Number(redeemed[tier]) || 0) + 1;
  await env.DB.prepare(`UPDATE bookings SET tier_redeemed_json = ? WHERE id = ?`)
    .bind(JSON.stringify(redeemed), booking.id)
    .run();

  return Response.json({ sessionId, endsAt: endsAt.toISOString() });
}
