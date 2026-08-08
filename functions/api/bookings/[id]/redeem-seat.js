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
  const { seatId, tier, vehicleSlug, trailer } = await request.json();

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

  // Which of the booking's paid-for vehicle picks this particular person
  // is claiming, same "paid for vs already handed out" check as tiers
  // above, just against vehicle_breakdown_json instead. Required since
  // every seat on this booking has a model attached to it (see 0018).
  let vehicleModel = null;
  const vehicleBreakdown = JSON.parse(booking.vehicle_breakdown_json || "{}");
  const vehicleRedeemed = JSON.parse(booking.vehicle_redeemed_json || "{}");
  if (vehicleSlug) {
    const vehiclePaidFor = Number(vehicleBreakdown[vehicleSlug]) || 0;
    const vehicleAlreadyRedeemed = Number(vehicleRedeemed[vehicleSlug]) || 0;
    if (vehicleAlreadyRedeemed >= vehiclePaidFor) {
      return Response.json({ error: `All ${vehicleSlug} picks from this booking are already redeemed` }, { status: 409 });
    }
    vehicleModel = await env.DB.prepare(`SELECT * FROM vehicle_models WHERE slug = ?`).bind(vehicleSlug).first();
    if (!vehicleModel) return Response.json({ error: "vehicle not found" }, { status: 404 });
    if (trailer && !vehicleModel.has_trailer_option) {
      return Response.json({ error: `${vehicleModel.name} doesn't take a trailer.` }, { status: 400 });
    }
    if (trailer && (Number(booking.trailer_redeemed) || 0) >= (Number(booking.trailer_count) || 0)) {
      return Response.json({ error: "No trailer left on this booking to hand out." }, { status: 409 });
    }
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

  const useTrailer = trailer && vehicleModel?.has_trailer_option ? 1 : 0;

  const insert = await env.DB.prepare(
    `INSERT INTO sessions (seat_id, tier, started_at, ends_at, vehicle_model_id, trailer)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(seatId, tier, startedAt.toISOString(), endsAt.toISOString(), vehicleModel ? vehicleModel.id : null, useTrailer)
    .run();

  const sessionId = insert.meta.last_row_id;

  await env.DB.prepare(`UPDATE seats SET status = 'active', current_session_id = ? WHERE id = ?`)
    .bind(sessionId, seatId)
    .run();

  redeemed[tier] = alreadyRedeemed + 1;
  if (vehicleSlug) vehicleRedeemed[vehicleSlug] = (Number(vehicleRedeemed[vehicleSlug]) || 0) + 1;

  await env.DB.prepare(
    `UPDATE bookings SET tier_redeemed_json = ?, vehicle_redeemed_json = ?, trailer_redeemed = trailer_redeemed + ? WHERE id = ?`
  )
    .bind(JSON.stringify(redeemed), JSON.stringify(vehicleRedeemed), useTrailer, bookingId)
    .run();

  return Response.json({ sessionId, endsAt: endsAt.toISOString() });
}
