// POST /api/bookings
// Family or group booking. Creates the booking record then returns a Square
// checkout link for the deposit. The booking stays "unpaid" until the
// webhook confirms payment.

import { createPaymentLink } from "../../lib/square.js";
import { sendEmail } from "../../lib/email.js";

const DEPOSIT_PENCE = {
  family: 1000, // placeholder, confirm real amount with Digz N' Lidz
  group: 2000,  // placeholder
};

export async function onRequestPost({ request, env }) {
  const body = await request.json();
  const { type, name, email, phone, partySize, bookingDate, slotTime, notes } = body;

  if (!["family", "group"].includes(type)) {
    return Response.json({ error: "type must be family or group" }, { status: 400 });
  }
  if (!name || !email || !bookingDate || !slotTime) {
    return Response.json({ error: "missing required fields" }, { status: 400 });
  }

  const depositAmount = DEPOSIT_PENCE[type];

  const insert = await env.DB.prepare(
    `INSERT INTO bookings (type, name, email, phone, party_size, booking_date, slot_time, deposit_amount_pence, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(type, name, email, phone || null, partySize || null, bookingDate, slotTime, depositAmount, notes || null)
    .run();

  const bookingId = insert.meta.last_row_id;

  const payment = await createPaymentLink(env, {
    amountPence: depositAmount,
    reference: `booking:${bookingId}`,
    description: `Digz N' Lidz deposit - ${type} booking`,
    redirectUrl: `${env.SITE_URL}/booking-confirmed?booking=${bookingId}`,
  });

  await env.DB.prepare(`UPDATE bookings SET square_payment_id = ? WHERE id = ?`)
    .bind(payment.providerRef, bookingId)
    .run();

  return Response.json({
    bookingId,
    checkoutUrl: payment.checkoutUrl,
  });
}
