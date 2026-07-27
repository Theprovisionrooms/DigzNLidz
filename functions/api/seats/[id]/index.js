// GET /api/seats/:id
// Returns current status for a seat, used by the QR landing page to decide
// whether to show "choose a tier" or "session running, order food".
//
// Exposes whether a card is already on file for the session (cardOnFile)
// so the frontend knows to skip the card form on extends/orders, but never
// sends the actual Square customer/card IDs to the browser.

export async function onRequestGet({ params, env }) {
  const seatId = params.id;

  const seat = await env.DB.prepare(`SELECT * FROM seats WHERE id = ?`).bind(seatId).first();
  if (!seat) {
    return Response.json({ error: "seat not found" }, { status: 404 });
  }

  let session = null;
  if (seat.current_session_id) {
    const row = await env.DB.prepare(`SELECT * FROM sessions WHERE id = ?`)
      .bind(seat.current_session_id)
      .first();
    if (row) {
      const { square_customer_id, square_card_id, ...safeSession } = row;
      session = { ...safeSession, cardOnFile: !!square_card_id };
    }
  }

  return Response.json({ seat, session });
}
