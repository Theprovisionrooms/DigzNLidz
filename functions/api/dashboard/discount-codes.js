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
    const existingCampaign = await env.DB.prepare(
      `SELECT id FROM campaigns WHERE name = ? AND type = 'promo'`
    )
      .bind(campaignName)
      .first();

    if (existingCampaign) {
      campaignId = existingCampaign.id;
    } else {
      const insert = await env.DB.prepare(
        `INSERT INTO campaigns (name, type, sent_at) VALUES (?, 'promo', datetime('now'))`
      )
        .bind(campaignName)
        .run();
      campaignId = insert.meta.last_row_id;
    }
  }

  try {
    await env.DB.prepare(
      `INSERT INTO discount_codes (code, campaign_id, discount_type, discount_value, expiry, usage_limit)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
      .bind(code.toUpperCase(), campaignId, discountType, discountValue, expiry || null, usageLimit || null)
      .run();
  } catch (err) {
    // D1 throws on the UNIQUE constraint (code is the primary key) if this
    // code already exists. Give staff a plain answer instead of a raw
    // database error.
    if (String(err.message || err).toLowerCase().includes("unique")) {
      return Response.json({ error: `Code "${code.toUpperCase()}" already exists. Pick a different code.` }, { status: 409 });
    }
    throw err;
  }

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
