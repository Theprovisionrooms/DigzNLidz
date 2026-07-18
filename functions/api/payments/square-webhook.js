// POST /api/payments/square-webhook
// Square calls this when a payment updates. Used to confirm deposits for
// bookings and corporate enquiries paid via a payment link. Session
// extensions and QR orders are confirmed synchronously in their own routes
// since those charge a sourceId directly and get an immediate result, this
// webhook is only needed for the payment-link flows.

import { verifyWebhookSignature, getPayment } from "../../lib/square.js";
import { sendEmail } from "../../lib/email.js";

export async function onRequestPost({ request, env }) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-square-hmacsha256-signature") || "";
  const notificationUrl = `${env.SITE_URL}/api/payments/square-webhook`;

  const valid = await verifyWebhookSignature(env, { signature, body: rawBody, notificationUrl });
  if (!valid) {
    return Response.json({ error: "invalid signature" }, { status: 401 });
  }

  const event = JSON.parse(rawBody);

  if (event.type !== "payment.updated") {
    return Response.json({ status: "ignored" });
  }

  const paymentId = event.data.object.payment.id;
  const payment = await getPayment(env, paymentId);

  if (payment.status !== "COMPLETED") {
    return Response.json({ status: "not completed yet" });
  }

  const note = payment.note || "";
  const [refType, refId] = note.split(":");

  if (refType === "booking") {
    const booking = await env.DB.prepare(`SELECT * FROM bookings WHERE id = ?`).bind(refId).first();
    if (booking && booking.deposit_status !== "paid") {
      await env.DB.prepare(`UPDATE bookings SET deposit_status = 'paid' WHERE id = ?`).bind(refId).run();
      await env.DB.prepare(
        `INSERT INTO mailing_list (email, source) VALUES (?, 'booking') ON CONFLICT(email) DO NOTHING`
      ).bind(booking.email).run();
      await sendEmail(env, {
        to: booking.email,
        subject: "Your Digz N' Lidz booking is confirmed",
        html: `<p>Hi ${booking.name},</p><p>Your booking for ${booking.booking_date} at ${booking.slot_time} is confirmed. See you then.</p>`,
      });
    }
  }

  if (refType === "corporate") {
    const enquiry = await env.DB.prepare(`SELECT * FROM corporate_enquiries WHERE id = ?`).bind(refId).first();
    if (enquiry) {
      await sendEmail(env, {
        to: enquiry.email,
        subject: "Your Digz N' Lidz event deposit is confirmed",
        html: `<p>Hi ${enquiry.contact_name},</p><p>Your deposit is in and your event is locked in. We will be in touch with the details.</p>`,
      });
    }
  }

  return Response.json({ status: "processed" });
}
