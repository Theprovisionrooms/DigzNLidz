// POST /api/seats/:id/start
// Called when a customer scans the seat QR code and picks a tier. If the
// tier has a price, payment should be taken client-side first (Square Web
// Payments SDK) and the resulting sourceId passed here; free/included tiers
// can start immediately.
//
// On a paid tier, the card used here also gets saved on file for the rest
// of the visit, so extends and food orders later don't ask for it again.

import { getTierConfig } from "../../../lib/settings.js";
import { chargeSourceId, createCustomer, saveCardFromPayment } from "../../../lib/square.js";

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

  let customerId = null;
  let cardId = null;

  if (tierConfig.pricePence > 0) {
    if (!sourceId) {
      return Response.json({ error: "payment required for this tier" }, { status: 402 });
    }

    customerId = await createCustomer(env, { referenceId: `seat-${seatId}-${Date.now()}` });

    const payment = await chargeSourceId(env, {
      sourceId,
      amountPence: tierConfig.pricePence,
      reference: `seat:${seatId}:${tier}`,
      customerId,
    });
    if (payment.status !== "COMPLETED" && payment.status !== "APPROVED") {
      return Response.json({ error: "payment not completed" }, { status: 402 });
    }

    // Best-effort: if this fails, the session still starts fine, it just
    // falls back to asking for card details again on the next charge.
    try {
      cardId = await saveCardFromPayment(env, { paymentId: payment.providerRef, customerId });
    } catch (e) {
      console.error("saveCardFromPayment failed", e);
    }
  }

  const startedAt = new Date();
  const endsAt = new Date(startedAt.getTime() + tierConfig.minutes * 60 * 1000);

  const insert = await env.DB.prepare(
    `INSERT INTO sessions (seat_id, tier, started_at, ends_at, square_customer_id, square_card_id)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(seatId, tier, startedAt.toISOString(), endsAt.toISOString(), customerId, cardId)
    .run();

  const sessionId = insert.meta.last_row_id;

  await env.DB.prepare(`UPDATE seats SET status = 'active', current_session_id = ? WHERE id = ?`)
    .bind(sessionId, seatId)
    .run();

  return Response.json({ sessionId, endsAt: endsAt.toISOString() });
}
