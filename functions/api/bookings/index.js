// POST /api/bookings
// Family or group booking. Creates the booking record then returns a Square
// checkout link for the deposit. The booking stays "unpaid" until the
// webhook confirms payment. Accepts an optional discount code, applied to
// the deposit amount before the Square link is generated.

import { createPaymentLink } from "../../lib/square.js";
import { sendEmail } from "../../lib/email.js";

const DEPOSIT_PENCE = {
  family: 1000, // placeholder, confirm real amount with Digz N' Lidz
  group: 2000,  // placeholder
};

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
  const { type, name, email, phone, partySize, bookingDate, slotTime, notes, discountCode } = body;

  if (!["family", "group"].includes(type)) {
    return Response.json({ error: "type must be family or group" }, { status: 400 });
  }
  if (!name || !email || !bookingDate || !slotTime) {
    return Response.json({ error: "missing required fields" }, { status: 400 });
  }

  const baseDeposit = DEPOSIT_PENCE[type];
  const { finalAmountPence, discountCode: appliedCode, error: discountError } =
    await applyDiscount(env.DB, discountCode, baseDeposit);

  if (discountError) {
    return Response.json({ error: discountError }, { status: 400 });
  }

  const insert = await env.DB.prepare(
    `INSERT INTO bookings (type, name, email, phone, party_size, booking_date, slot_time, deposit_amount_pence, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(type, name, email, phone || null, partySize || null, bookingDate, slotTime, finalAmountPence, notes || null)
    .run();

  const bookingId = insert.meta.last_row_id;

  const payment = await createPaymentLink(env, {
    amountPence: finalAmountPence,
    reference: `booking:${bookingId}`,
    description: `Digz N' Lidz deposit - ${type} booking`,
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
    depositAmountPence: finalAmountPence,
  });
}
