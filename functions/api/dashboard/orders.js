// GET /api/dashboard/orders
// Staff-facing. Active orders (placed/preparing) for the live orders panel,
// newest first, joined to seat number so staff know where to deliver.
//
// PATCH /api/dashboard/orders
// Body: { id, status }  status is 'preparing' or 'delivered'.

import { isAuthenticated, unauthorizedResponse } from "../../lib/auth.js";

export async function onRequestGet({ request, env }) {
  if (!(await isAuthenticated(request, env))) return unauthorizedResponse();

  const { results } = await env.DB.prepare(
    `SELECT id, seat_id, table_id, items_json, total_pence, status, created_at
     FROM orders
     WHERE status != 'delivered'
     ORDER BY created_at ASC`
  ).all();

  // Parsed defensively: one row with bad items_json (shouldn't happen,
  // but a bad write or manual DB edit could cause it) used to 500 the
  // whole endpoint, which would blank out every order on both the
  // dashboard and the kitchen screen, not just the bad one. Now a single
  // broken row just shows as "(unreadable order)" and everything else
  // still comes through.
  const orders = results.map((o) => {
    let items;
    try {
      items = JSON.parse(o.items_json);
    } catch (e) {
      console.error(`orders.js: bad items_json for order ${o.id}`, e);
      items = [{ name: "(unreadable order, check with a manager)", quantity: 1 }];
    }
    return { ...o, items };
  });

  return Response.json({ orders });
}

export async function onRequestPatch({ request, env }) {
  if (!(await isAuthenticated(request, env))) return unauthorizedResponse();

  const { id, status } = await request.json();

  if (!id || !["preparing", "delivered"].includes(status)) {
    return Response.json({ error: "id and a valid status (preparing/delivered) are required" }, { status: 400 });
  }

  await env.DB.prepare(`UPDATE orders SET status = ? WHERE id = ?`).bind(status, id).run();

  return Response.json({ status: "updated" });
}
