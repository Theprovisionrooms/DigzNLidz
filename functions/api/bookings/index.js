// POST /api/bookings
// Family or group booking. Takes how many people want each tier, works
// out the real total from the same settings-driven tier prices used at
// the seats, and returns a Square checkout link for that full amount.
// The booking stays "unpaid" until the webhook confirms payment.
// No separate "deposit", this is the actual session cost paid upfront;
// each paid seat gets redeemed by staff against a real seat when the
// party arrives (see /api/bookings/:id/redeem-seat). Accepts an optional
// discount code, applied to the total before the Square link is generated.

import { createPaymentLink } from "../../lib/square.js";
import { BUSINESS_HOURS } from "../config.js";
import { getSettings } from "../../lib/settings.js";

const TIER_KEYS = ["tier_1", "tier_2", "tier_3"];

// bookingDate is "YYYY-MM-DD", parsed as UTC midnight which is fine here
// since we only need the day of week, not a precise instant.
function checkWithinHours(bookingDate, slotTime) {
  const day = new Date(`${bookingDate}T00:00:00Z`).getUTCDay();
  const hours = BUSINESS_HOURS[day];
  if (!hours) return { ok: false, error: "We're closed that day. Open Wednesday to Sunday." };
  if (slotTime < hours.open || slotTime >= hours.close) {
    return { ok: false, error: `That time's outside our hours for that day, ${hours.open} to ${hours.close}.` };
  }
  return { ok: true };
}

async function applyDiscount(db, code, amountPence) {
  if (!code) return { finalAmountPence: amountPence, discountCode: null };

  const discount = await db.prepare(`SELECT * FROM discount_codes WHERE code = ?`).bind(code).first();
  if (!discount) return { finalAmountPence: amountPence, discountCode: null, error: "Discount code not found" };
  if (discount.expiry && new Date(discount.expiry) < new Date()) {
    return { finalAmountPence: amountPence, discountCode: null, error: "Discount code expired" };
  }
  if (discount.usage_limit && discount.uses >= discount.usage_limit) {
    return { finalAmountPence: amountPence, discountCode: null, error: "Discount code no longer available" };
  }

  const reduction = discount.discount_type === "percent"
    ? Math.round(amountPence * (discount.discount_value / 100))
    : discount.discount_value;

  const finalAmountPence = Math.max(0, amountPence - reduction);
  return { finalAmountPence, discountCode: discount.code };
}

export async function onRequestPost({ request, env }) {
  const body = await request.json();
  const { type, name, email, phone, tierCounts, bookingDate, slotTime, notes, discountCode } = body;
  // tierCounts: { tier_1: 2, tier_2: 0, tier_3: 1 }, how many people want each tier

  if (!["family", "group"].includes(type)) {
    return Response.json({ error: "type must be family or group" }, { status: 400 });
  }
  if (!name || !email || !bookingDate || !slotTime) {
    return Response.json({ error: "missing required fields" }, { status: 400 });
  }
  if (!tierCounts || TIER_KEYS.every((k) => !tierCounts[k])) {
    return Response.json({ error: "pick at least one person for a tier" }, { status: 400 });
  }

  const hoursCheck = checkWithinHours(bookingDate, slotTime);
  if (!hoursCheck.ok) {
    return Response.json({ error: hoursCheck.error }, { status: 400 });
  }

  // Real prices come from settings, same source the seats themselves use.
  // Never trust a client-supplied total, someone could tamper with it.
  const settings = await getSettings(env.DB, [
    "tier_1_price_pence", "tier_2_price_pence", "tier_3_price_pence",
  ]);

  let baseTotal = 0;
  const cleanCounts = {};
  for (const key of TIER_KEYS) {
    const count = Math.max(0, Number(tierCounts[key]) || 0);
    cleanCounts[key] = count;
    baseTotal += count * Number(settings[`${key}_price_pence`]);
  }

  const partySize = TIER_KEYS.reduce((sum, k) => sum + cleanCounts[k], 0);

  const { finalAmountPence, discountCode: appliedCode, error: discountError } =
    await applyDiscount(env.DB, discountCode, baseTotal);

  if (discountError) {
    return Response.json({ error: discountError }, { status: 400 });
  }

  const insert = await env.DB.prepare(
    `INSERT INTO bookings (type, name, email, phone, party_size, booking_date, slot_time, total_amount_pence, tier_breakdown_json, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(type, name, email, phone || null, partySize, bookingDate, slotTime, finalAmountPence, JSON.stringify(cleanCounts), notes || null)
    .run();

  const bookingId = insert.meta.last_row_id;

  const payment = await createPaymentLink(env, {
    amountPence: finalAmountPence,
    reference: `booking:${bookingId}`,
    description: `Digz N' Lidz booking - ${type}, ${partySize} ${partySize === 1 ? "person" : "people"}`,
    redirectUrl: `${env.SITE_URL}/booking-confirmed?booking=${bookingId}`,
  });

  await env.DB.prepare(`UPDATE bookings SET square_payment_id = ? WHERE id = ?`)
    .bind(payment.providerRef, bookingId)
    .run();

  if (appliedCode) {
    await env.DB.prepare(`UPDATE discount_codes SET uses = uses + 1 WHERE code = ?`).bind(appliedCode).run();
  }

  return Response.json({
    bookingId,
    checkoutUrl: payment.checkoutUrl,
    totalAmountPence: finalAmountPence,
  });
}
