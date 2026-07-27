// POST /api/seats/:id/order
// Food/drink order placed from the seat QR page. Tagged to the seat and
// current session so staff know exactly where to deliver it.
//
// Same card-on-file logic as extend.js: if the session already has a saved
// card, this charges it directly with no card form. Otherwise sourceId is
// required and the card gets saved for next time.

import {
  chargeSourceId,
  chargeCardOnFile,
  createCustomer,
  saveCardFromPayment,
  getMenu,
} from "../../../lib/square.js";

export async function onRequestPost({ params, request, env }) {
  const seatId = params.id;
  const body = await request.json();
  const { items, sourceId } = body; // items: [{ id, quantity }], anything else from the client is ignored

  if (!Array.isArray(items) || items.length === 0) {
    return Response.json({ error: "items required" }, { status: 400 });
  }

  // Re-price every line against the live menu (Square catalog, or the
  // fallback if Square's unreachable). The client only tells us which
  // item and how many, never what it costs, so a tampered request body
  // can't change what actually gets charged.
  const menu = await getMenu(env);
  const menuById = new Map(menu.map((m) => [m.id, m]));

  const cleanItems = [];
  for (const requested of items) {
    const menuItem = menuById.get(requested.id);
    if (!menuItem) {
      return Response.json({ error: `unknown item: ${requested.id}` }, { status: 400 });
    }
    const quantity = Math.max(0, Math.floor(Number(requested.quantity) || 0));
    if (quantity === 0) continue;
    cleanItems.push({ name: menuItem.name, quantity, pricePence: menuItem.pricePence });
  }

  if (cleanItems.length === 0) {
    return Response.json({ error: "items required" }, { status: 400 });
  }

  const seat = await env.DB.prepare(`SELECT current_session_id FROM seats WHERE id = ?`)
    .bind(seatId)
    .first();

  const session = seat?.current_session_id
    ? await env.DB.prepare(`SELECT * FROM sessions WHERE id = ?`).bind(seat.current_session_id).first()
    : null;

  const totalPence = cleanItems.reduce((sum, item) => sum + item.pricePence * item.quantity, 0);

  let payment;
  let customerId = session?.square_customer_id || null;
  let cardId = session?.square_card_id || null;

  if (cardId) {
    payment = await chargeCardOnFile(env, {
      customerId,
      cardId,
      amountPence: totalPence,
      reference: `seat:${seatId}:order`,
    });
  } else {
    if (!sourceId) {
      return Response.json({ error: "sourceId required" }, { status: 400 });
    }
    customerId = customerId || (await createCustomer(env, { referenceId: `seat-${seatId}-${Date.now()}` }));
    payment = await chargeSourceId(env, {
      sourceId,
      amountPence: totalPence,
      reference: `seat:${seatId}:order`,
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

  if (session && (customerId !== session.square_customer_id || cardId !== session.square_card_id)) {
    await env.DB.prepare(
      `UPDATE sessions SET square_customer_id = ?, square_card_id = ? WHERE id = ?`
    )
      .bind(customerId, cardId, session.id)
      .run();
  }

  const insert = await env.DB.prepare(
    `INSERT INTO orders (seat_id, session_id, items_json, total_pence, square_order_id)
     VALUES (?, ?, ?, ?, ?)`
  )
    .bind(seatId, seat?.current_session_id || null, JSON.stringify(cleanItems), totalPence, payment.providerRef)
    .run();

  return Response.json({ orderId: insert.meta.last_row_id, status: "placed" });
}
