// GET /api/seats/:id
// Returns current status for a seat, used by the QR landing page to decide
// whether to show "choose a tier" or "session running, order food".

export async function onRequestGet({ params, env }) {
  const seatId = params.id;

  const seat = await env.DB.prepare(`SELECT * FROM seats WHERE id = ?`).bind(seatId).first();
  if (!seat) {
    return Response.json({ error: "seat not found" }, { status: 404 });
  }

  let session = null;
  if (seat.current_session_id) {
    session = await env.DB.prepare(`SELECT * FROM sessions WHERE id = ?`)
      .bind(seat.current_session_id)
      .first();
  }

  return Response.json({ seat, session });
}
