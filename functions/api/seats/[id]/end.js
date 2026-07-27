// POST /api/seats/:id/end
// Called when the customer says they're done, either from the "no I'm
// done" prompt after a session runs out, or from an "I'm finished" button
// during an active session.
//
// Frees the seat for the next QR scan and disables any card on file for
// this visit, so we're not holding onto a customer's card after they've
// left the building.

import { disableCard } from "../../../lib/square.js";

export async function onRequestPost({ params, env }) {
  const seatId = params.id;

  const seat = await env.DB.prepare(`SELECT * FROM seats WHERE id = ?`).bind(seatId).first();
  if (!seat) return Response.json({ error: "seat not found" }, { status: 404 });

  if (seat.current_session_id) {
    const session = await env.DB.prepare(`SELECT * FROM sessions WHERE id = ?`)
      .bind(seat.current_session_id)
      .first();

    if (session?.square_card_id) {
      await disableCard(env, session.square_card_id);
    }

    await env.DB.prepare(`UPDATE sessions SET status = 'ended' WHERE id = ?`)
      .bind(seat.current_session_id)
      .run();
  }

  await env.DB.prepare(`UPDATE seats SET status = 'free', current_session_id = NULL WHERE id = ?`)
    .bind(seatId)
    .run();

  return Response.json({ status: "ended" });
}
