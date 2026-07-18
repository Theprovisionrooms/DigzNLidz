// POST /api/seats/:id/order
// Food/drink order placed from the seat QR page. Tagged to the seat and
// current session so staff know exactly where to deliver it. Payment is
// taken the same way as a session extension, via a Square Web Payments SDK
// sourceId collected on the seat page.

import { chargeSourceId } from "../../../lib/square.js";

export async function onRequestPost({ params, request, env }) {
  const seatId = params.id;
  const body = await request.json();
  const { items, sourceId } = body; // items: [{ name, quantity, pricePence }]

  if (!Array.isArray(items) || items.length === 0) {
    return Response.json({ error: "items required" }, { status: 400 });
  }
  if (!sourceId) {
    return Response.json({ error: "sourceId required" }, { status: 400 });
  }

  const totalPence = items.reduce((sum, item) => sum + item.pricePence * item.quantity, 0);

  const payment = await chargeSourceId(env, {
    sourceId,
    amountPence: totalPence,
    reference: `seat:${seatId}:order`,
  });

  if (payment.status !== "COMPLETED" && payment.status !== "APPROVED") {
    return Response.json({ error: "payment not completed" }, { status: 402 });
  }

  const seat = await env.DB.prepare(`SELECT current_session_id FROM seats WHERE id = ?`)
    .bind(seatId)
    .first();

  const insert = await env.DB.prepare(
    `INSERT INTO orders (seat_id, session_id, items_json, total_pence, square_order_id)
     VALUES (?, ?, ?, ?, ?)`
  )
    .bind(seatId, seat?.current_session_id || null, JSON.stringify(items), totalPence, payment.providerRef)
    .run();

  return Response.json({ orderId: insert.meta.last_row_id, status: "placed" });
}
