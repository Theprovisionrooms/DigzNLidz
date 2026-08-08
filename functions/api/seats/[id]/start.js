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
import { getVehicleAvailabilityNow } from "../../../lib/capacity.js";

export async function onRequestPost({ params, request, env }) {
  const seatId = params.id;
  const body = await request.json();
  const { tier, sourceId, vehicleSlug, trailer } = body; // tier: "tier_1" | "tier_2" | "tier_3"

  if (!["tier_1", "tier_2", "tier_3"].includes(tier)) {
    return Response.json({ error: "invalid tier" }, { status: 400 });
  }

  // vehicleSlug is optional at the API level (older/non-RC sessions could
  // still exist) but the seat page always sends one now that picking a
  // model is part of choosing a session. Re-checked fresh here rather
  // than trusting whatever the client saw a few seconds ago in the
  // picker, someone else could have taken the last free unit in that gap.
  let vehicleModel = null;
  if (vehicleSlug) {
    const { models } = await getVehicleAvailabilityNow(env.DB);
    vehicleModel = models.find((m) => m.slug === vehicleSlug);
    if (!vehicleModel) {
      return Response.json({ error: "That vehicle isn't available." }, { status: 400 });
    }
    if (vehicleModel.available <= 0) {
      return Response.json({ error: `No ${vehicleModel.name} free right now, pick another.` }, { status: 409 });
    }
    if (trailer && !vehicleModel.has_trailer_option) {
      return Response.json({ error: `${vehicleModel.name} doesn't take a trailer.` }, { status: 400 });
    }
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
  //
  // claimed_at is stamped here so a seat that never makes it to a real
  // session (payment never completes, connection drops mid-request, etc.)
  // can be swept back to "free" by the cron job instead of sitting on
  // "starting" - which the dashboard shows as taken - forever.
  const claim = await env.DB.prepare(
    `UPDATE seats SET status = 'starting', claimed_at = ? WHERE id = ? AND status = 'free'`
  )
    .bind(new Date().toISOString(), seatId)
    .run();
  if (!claim.meta.changes) {
    return Response.json({ error: "seat is not free" }, { status: 409 });
  }

  let customerId = null;
  let cardId = null;
  let tierConfig;

  try {
    // getTierConfig lives inside the try now too: it's a DB read like
    // anything else here, and if it throws (bad/missing settings row,
    // D1 hiccup) the seat needs releasing back to free just as much as
    // a failed charge does, not left stuck on "starting".
    tierConfig = await getTierConfig(env.DB, tier);

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
    await env.DB.prepare(`UPDATE seats SET status = 'free', claimed_at = NULL WHERE id = ?`).bind(seatId).run();
    if (e && e.status) return Response.json({ error: e.error }, { status: e.status });
    console.error("Square charge failed (seat start)", e);
    return Response.json({ error: `Payment couldn't be processed: ${e.message || "unknown error"}` }, { status: 502 });
  }

  const startedAt = new Date();
  const endsAt = new Date(startedAt.getTime() + tierConfig.minutes * 60 * 1000);
  // Generated here and only ever returned to this same request, so only
  // the browser that actually started this session ever sees it. See
  // migration 0016 for why this exists.
  const accessToken = crypto.randomUUID();

  const insert = await env.DB.prepare(
    `INSERT INTO sessions (seat_id, tier, started_at, ends_at, square_customer_id, square_card_id, access_token, vehicle_model_id, trailer)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      seatId, tier, startedAt.toISOString(), endsAt.toISOString(), customerId, cardId, accessToken,
      vehicleModel ? vehicleModel.id : null, trailer && vehicleModel?.has_trailer_option ? 1 : 0
    )
    .run();

  const sessionId = insert.meta.last_row_id;

  await env.DB.prepare(`UPDATE seats SET status = 'active', current_session_id = ?, claimed_at = NULL WHERE id = ?`)
    .bind(sessionId, seatId)
    .run();

  return Response.json({ sessionId, endsAt: endsAt.toISOString(), sessionToken: accessToken });
}
