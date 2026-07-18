// POST /api/seats/:id/extend
// Called when the customer taps "yes" on the "add 15 minutes for £5" prompt
// after their session runs out. sourceId comes from the Square Web Payments
// SDK on the seat page (card, Apple Pay, or Google Pay), so this charges
// instantly without the customer re-entering details from scratch.

import { getExtensionConfig } from "../../../lib/settings.js";
import { chargeSourceId } from "../../../lib/square.js";

export async function onRequestPost({ params, request, env }) {
  const seatId = params.id;
  const body = await request.json();
  const { sourceId } = body;

  if (!sourceId) {
    return Response.json({ error: "sourceId required" }, { status: 400 });
  }

  const seat = await env.DB.prepare(`SELECT * FROM seats WHERE id = ?`).bind(seatId).first();
  if (!seat || !seat.current_session_id) {
    return Response.json({ error: "no active session on this seat" }, { status: 404 });
  }

  const extension = await getExtensionConfig(env.DB);

  const payment = await chargeSourceId(env, {
    sourceId,
    amountPence: extension.pricePence,
    reference: `seat:${seatId}:extension`,
  });

  if (payment.status !== "COMPLETED" && payment.status !== "APPROVED") {
    return Response.json({ error: "payment not completed" }, { status: 402 });
  }

  const session = await env.DB.prepare(`SELECT * FROM sessions WHERE id = ?`)
    .bind(seat.current_session_id)
    .first();

  const newEndsAt = new Date(new Date(session.ends_at).getTime() + extension.minutes * 60 * 1000);

  await env.DB.prepare(
    `UPDATE sessions SET ends_at = ?, extensions_count = extensions_count + 1, status = 'active' WHERE id = ?`
  )
    .bind(newEndsAt.toISOString(), session.id)
    .run();

  await env.DB.prepare(`UPDATE seats SET status = 'active' WHERE id = ?`).bind(seatId).run();

  return Response.json({ endsAt: newEndsAt.toISOString() });
}
