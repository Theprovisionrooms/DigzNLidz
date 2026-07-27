// POST /api/dashboard/discount-codes
// Staff-facing. Creates a discount code, optionally under a named campaign
// so redemptions can be tracked back to whichever email or promo it came
// from.

import { isAuthenticated, unauthorizedResponse } from "../../lib/auth.js";

export async function onRequestPost({ request, env }) {
  if (!(await isAuthenticated(request, env))) return unauthorizedResponse();

  const body = await request.json();
  const { code, discountType, discountValue, expiry, usageLimit, campaignName } = body;

  if (!code || !discountType || !discountValue) {
    return Response.json({ error: "code, discountType, and discountValue are required" }, { status: 400 });
  }

  let campaignId = null;
  if (campaignName) {
    const insert = await env.DB.prepare(
      `INSERT INTO campaigns (name, type, sent_at) VALUES (?, 'promo', datetime('now'))`
    )
      .bind(campaignName)
      .run();
    campaignId = insert.meta.last_row_id;
  }

  await env.DB.prepare(
    `INSERT INTO discount_codes (code, campaign_id, discount_type, discount_value, expiry, usage_limit)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(code.toUpperCase(), campaignId, discountType, discountValue, expiry || null, usageLimit || null)
    .run();

  return Response.json({ status: "created", code: code.toUpperCase() });
}

// GET /api/dashboard/discount-codes
// Lists codes with redemption counts, for the promo performance view.
export async function onRequestGet({ request, env }) {
  if (!(await isAuthenticated(request, env))) return unauthorizedResponse();

  const { results } = await env.DB.prepare(
    `SELECT dc.*, c.name as campaign_name
     FROM discount_codes dc
     LEFT JOIN campaigns c ON c.id = dc.campaign_id
     ORDER BY dc.code`
  ).all();

  return Response.json({ codes: results });
}
