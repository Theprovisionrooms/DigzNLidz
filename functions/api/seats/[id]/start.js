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

  // Claim the seat atomically before doing anything else, including the
  // Square charge. The WHERE status = 'free' guard means only one of two
  // near-simultaneous requests for the same seat (two scans of the same
  // QR at once, say) can win this; the loser gets a clean "not free"
  // error here instead of both charging a card and racing to overwrite
  // each other's session on the same seat afterwards.
  const claim = await env.DB.prepare(
    `UPDATE seats SET status = 'starting' WHERE id = ? AND status = 'free'`
  )
    .bind(seatId)
    .run();
  if (!claim.meta.changes) {
    return Response.json({ error: "seat is not free" }, { status: 409 });
  }

  const tierConfig = await getTierConfig(env.DB, tier);

  let customerId = null;
  let cardId = null;

  try {
    if (tierConfig.pricePence > 0) {
      if (!sourceId) {
        throw { status: 402, error: "payment required for this tier" };
      }

      customerId = await createCustomer(env, { referenceId: `seat-${seatId}-${Date.now()}` });

      const payment = await chargeSourceId(env, {
        sourceId,
        amountPence: tierConfig.pricePence,
        reference: `seat:${seatId}:${tier}`,
        customerId,
      });
      if (payment.status !== "COMPLETED" && payment.status !== "APPROVED") {
        throw { status: 402, error: "payment not completed" };
      }

      // Best-effort: if this fails, the session still starts fine, it just
      // falls back to asking for card details again on the next charge.
      try {
        cardId = await saveCardFromPayment(env, { paymentId: payment.providerRef, customerId });
      } catch (e) {
        console.error("saveCardFromPayment failed", e);
      }
    }
  } catch (e) {
    // Release the claim so the seat goes back to free rather than being
    // stuck on "starting" because payment failed or was never attempted.
    await env.DB.prepare(`UPDATE seats SET status = 'free' WHERE id = ?`).bind(seatId).run();
    if (e && e.status) return Response.json({ error: e.error }, { status: e.status });
    throw e;
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
