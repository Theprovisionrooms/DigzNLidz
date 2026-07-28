// POST /api/seats/:id/extend
// Called when the customer taps "yes" on the "add 15 minutes for £5" prompt
// after their session runs out.
//
// If a card is already on file for this session (the common case, saved on
// whichever payment happened first this visit), this charges it directly,
// one tap, no card form. If the session started on a free tier and this is
// the first payment of the visit, sourceId is still required and the card
// gets saved here instead.

import { getExtensionConfig } from "../../../lib/settings.js";
import { getSeatAvailability } from "../../../lib/capacity.js";
import {
  chargeSourceId,
  chargeCardOnFile,
  createCustomer,
  saveCardFromPayment,
} from "../../../lib/square.js";

export async function onRequestPost({ params, request, env }) {
  const seatId = params.id;
  const body = await request.json().catch(() => ({}));
  const { sourceId } = body;

  const seat = await env.DB.prepare(`SELECT * FROM seats WHERE id = ?`).bind(seatId).first();
  if (!seat || !seat.current_session_id) {
    return Response.json({ error: "no active session on this seat" }, { status: 404 });
  }

  // If seats are already tight for a paid booking due within the next
  // hour (same reservation math next-free.js uses to steer walk-ins away
  // from those seats), don't let this one quietly keep running past that
  // point. This seat is occupied, not free, so it isn't counted in
  // "available" itself, negative or zero just means every other free
  // seat is already spoken for.
  const { available } = await getSeatAvailability(env.DB);
  if (available <= 0) {
    return Response.json(
      {
        error: "We need this seat back shortly for a booking that's due in, a member of staff can help if you'd like to stay longer.",
      },
      { status: 409 }
    );
  }

  const session = await env.DB.prepare(`SELECT * FROM sessions WHERE id = ?`)
    .bind(seat.current_session_id)
    .first();

  const extension = await getExtensionConfig(env.DB);

  let payment;
  let customerId = session.square_customer_id;
  let cardId = session.square_card_id;

  if (cardId) {
    payment = await chargeCardOnFile(env, {
      customerId,
      cardId,
      amountPence: extension.pricePence,
      reference: `seat:${seatId}:extension`,
    });
  } else {
    if (!sourceId) {
      return Response.json({ error: "sourceId required" }, { status: 400 });
    }
    customerId = customerId || (await createCustomer(env, { referenceId: `seat-${seatId}-${Date.now()}` }));
    payment = await chargeSourceId(env, {
      sourceId,
      amountPence: extension.pricePence,
      reference: `seat:${seatId}:extension`,
      customerId,
    });
    if (payment.status === "COMPLETED" || payment.status === "APPROVED") {
      try {
        cardId = await saveCardFromPayment(env, { paymentId: payment.providerRef, customerId });
      } catch (e) {
        console.error("saveCardFromPayment failed", e);
      }
    }
  }

  if (payment.status !== "COMPLETED" && payment.status !== "APPROVED") {
    return Response.json({ error: "payment not completed" }, { status: 402 });
  }

  const newEndsAt = new Date(new Date(session.ends_at).getTime() + extension.minutes * 60 * 1000);

  await env.DB.prepare(
    `UPDATE sessions
     SET ends_at = ?, extensions_count = extensions_count + 1,
         extensions_revenue_pence = extensions_revenue_pence + ?, status = 'active',
         square_customer_id = ?, square_card_id = ?
     WHERE id = ?`
  )
    .bind(newEndsAt.toISOString(), extension.pricePence, customerId, cardId, session.id)
    .run();

  await env.DB.prepare(`UPDATE seats SET status = 'active' WHERE id = ?`).bind(seatId).run();

  return Response.json({ endsAt: newEndsAt.toISOString() });
}
