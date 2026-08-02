// POST /api/seats/group/start
// Called after next-free-group has claimed a set of seats (status
// 'starting') and the guest has picked a tier. One Square charge for
// the whole group, tier price × headcount, then a session is started on
// every seat in the group with the same card on file, so food orders
// later at any of those seats don't ask for card details again.
//
// Same tier for everyone in the group, by design, keeps the payment to
// one charge instead of a per-person breakdown. If a group wants mixed
// tiers they scan individually as before.

import { getTierConfig } from "../../../lib/settings.js";
import { chargeSourceId, createCustomer, saveCardFromPayment } from "../../../lib/square.js";

export async function onRequestPost({ request, env }) {
  const body = await request.json();
  const { seatIds, tier, sourceId } = body;

  if (!Array.isArray(seatIds) || seatIds.length === 0) {
    return Response.json({ error: "seatIds required" }, { status: 400 });
  }
  if (![ "tier_1", "tier_2", "tier_3" ].includes(tier)) {
    return Response.json({ error: "invalid tier" }, { status: 400 });
  }

  // Every seat in the group must actually be held by this claim (status
  // 'starting'), not free, not already active. Guards against a stale or
  // tampered seatIds list being used to start sessions on seats that
  // were never claimed for this group.
  const placeholders = seatIds.map(() => "?").join(",");
  const { results: seatRows } = await env.DB.prepare(
    `SELECT id, status FROM seats WHERE id IN (${placeholders})`
  )
    .bind(...seatIds)
    .all();

  if (seatRows.length !== seatIds.length || seatRows.some((s) => s.status !== "starting")) {
    return Response.json({ error: "one or more seats in this group are no longer held" }, { status: 409 });
  }

  const tierConfig = await getTierConfig(env.DB, tier);
  const totalPence = tierConfig.pricePence * seatIds.length;

  let customerId = null;
  let cardId = null;

  try {
    if (totalPence > 0) {
      if (!sourceId) {
        throw { status: 402, error: "payment required for this tier" };
      }

      customerId = await createCustomer(env, { referenceId: `group-${seatIds.join("-")}-${Date.now()}` });

      const payment = await chargeSourceId(env, {
        sourceId,
        amountPence: totalPence,
        reference: `group:${seatIds.join(",")}:${tier}`,
        customerId,
      });
      if (payment.status !== "COMPLETED" && payment.status !== "APPROVED") {
        throw { status: 402, error: "payment not completed" };
      }

      try {
        cardId = await saveCardFromPayment(env, { paymentId: payment.providerRef, customerId });
      } catch (e) {
        console.error("saveCardFromPayment failed", e);
      }
    }
  } catch (e) {
    // Release every seat in the group back to free, not just one, if
    // payment failed or was never attempted.
    for (const seatId of seatIds) {
      await env.DB.prepare(`UPDATE seats SET status = 'free' WHERE id = ?`).bind(seatId).run();
    }
    if (e && e.status) return Response.json({ error: e.error }, { status: e.status });
    console.error("Square charge failed (group start)", e);
    return Response.json({ error: `Payment couldn't be processed: ${e.message || "unknown error"}` }, { status: 502 });
  }

  const startedAt = new Date();
  const endsAt = new Date(startedAt.getTime() + tierConfig.minutes * 60 * 1000);
  const sessionIds = [];

  for (const seatId of seatIds) {
    const insert = await env.DB.prepare(
      `INSERT INTO sessions (seat_id, tier, started_at, ends_at, square_customer_id, square_card_id)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
      .bind(seatId, tier, startedAt.toISOString(), endsAt.toISOString(), customerId, cardId)
      .run();

    const sessionId = insert.meta.last_row_id;
    sessionIds.push(sessionId);

    await env.DB.prepare(`UPDATE seats SET status = 'active', current_session_id = ? WHERE id = ?`)
      .bind(sessionId, seatId)
      .run();
  }

  return Response.json({ seats: seatIds, sessionIds, endsAt: endsAt.toISOString() });
}
