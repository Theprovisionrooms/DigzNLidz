// POST /api/seats/:id/start
// Called when a customer scans the seat QR code and picks a tier. If the
// tier has a price, payment should be taken client-side first (Square Web
// Payments SDK) and the resulting sourceId passed here; free/included tiers
// can start immediately.

import { getTierConfig } from "../../../lib/settings.js";
import { chargeSourceId } from "../../../lib/square.js";

export async function onRequestPost({ params, request, env }) {
  const seatId = params.id;
  const body = await request.json();
  const { tier, sourceId } = body; // tier: "tier_1" | "tier_2" | "tier_3"

  if (!["tier_1", "tier_2", "tier_3"].includes(tier)) {
    return Response.json({ error: "invalid tier" }, { status: 400 });
  }

  const seat = await env.DB.prepare(`SELECT * FROM seats WHERE id = ?`).bind(seatId).first();
  if (!seat) return Response.json({ error: "seat not found" }, { status: 404 });
  if (seat.status !== "free") {
    return Response.json({ error: "seat is not free" }, { status: 409 });
  }

  const tierConfig = await getTierConfig(env.DB, tier);

  if (tierConfig.pricePence > 0) {
    if (!sourceId) {
      return Response.json({ error: "payment required for this tier" }, { status: 402 });
    }
    const payment = await chargeSourceId(env, {
      sourceId,
      amountPence: tierConfig.pricePence,
      reference: `seat:${seatId}:${tier}`,
    });
    if (payment.status !== "COMPLETED" && payment.status !== "APPROVED") {
      return Response.json({ error: "payment not completed" }, { status: 402 });
    }
  }

  const startedAt = new Date();
  const endsAt = new Date(startedAt.getTime() + tierConfig.minutes * 60 * 1000);

  const insert = await env.DB.prepare(
    `INSERT INTO sessions (seat_id, tier, started_at, ends_at) VALUES (?, ?, ?, ?)`
  )
    .bind(seatId, tier, startedAt.toISOString(), endsAt.toISOString())
    .run();

  const sessionId = insert.meta.last_row_id;

  await env.DB.prepare(`UPDATE seats SET status = 'active', current_session_id = ? WHERE id = ?`)
    .bind(sessionId, seatId)
    .run();

  return Response.json({ sessionId, endsAt: endsAt.toISOString() });
}
