// POST /api/tables/:id/order
// Food/drink order from one of the 8 cafe tables, no digger session
// attached. Every order is a fresh one-off charge since there's no
// ongoing session to save a card against, unlike the RC seat flow.

import { chargeSourceId, createCustomer } from "../../../lib/square.js";

const VALID_TABLES = [1, 2, 3, 4, 5, 6, 7, 8];

export async function onRequestPost({ params, request, env }) {
  const tableId = Number(params.id);
  if (!VALID_TABLES.includes(tableId)) {
    return Response.json({ error: "not a valid table" }, { status: 400 });
  }

  const { items, sourceId } = await request.json(); // items: [{ name, quantity, pricePence }]

  if (!Array.isArray(items) || items.length === 0) {
    return Response.json({ error: "items required" }, { status: 400 });
  }
  if (!sourceId) {
    return Response.json({ error: "sourceId required" }, { status: 400 });
  }

  const totalPence = items.reduce((sum, item) => sum + item.pricePence * item.quantity, 0);

  const customerId = await createCustomer(env, { referenceId: `table-${tableId}-${Date.now()}` });
  const payment = await chargeSourceId(env, {
    sourceId,
    amountPence: totalPence,
    reference: `table:${tableId}:order`,
    customerId,
  });

  if (payment.status !== "COMPLETED" && payment.status !== "APPROVED") {
    return Response.json({ error: "payment not completed" }, { status: 402 });
  }

  const insert = await env.DB.prepare(
    `INSERT INTO orders (table_id, items_json, total_pence, square_order_id)
     VALUES (?, ?, ?, ?)`
  )
    .bind(tableId, JSON.stringify(items), totalPence, payment.providerRef)
    .run();

  return Response.json({ orderId: insert.meta.last_row_id, status: "placed" });
}
