// POST /api/corporate/:id/confirm
// Staff-facing. Called once Digz N' Lidz have spoken to the customer and
// agreed the event. Generates the deposit payment link and emails it,
// nothing is charged until the customer pays that link.

import { createPaymentLink } from "../../../lib/square.js";
import { sendEmail } from "../../../lib/email.js";

export async function onRequestPost({ params, request, env }) {
  const enquiryId = params.id;
  const body = await request.json().catch(() => ({}));
  const depositPence = body.depositPence; // larger corporate deposit, set per event

  if (!depositPence) {
    return Response.json({ error: "depositPence required" }, { status: 400 });
  }

  const enquiry = await env.DB.prepare(`SELECT * FROM corporate_enquiries WHERE id = ?`)
    .bind(enquiryId)
    .first();

  if (!enquiry) {
    return Response.json({ error: "enquiry not found" }, { status: 404 });
  }

  const payment = await createPaymentLink(env, {
    amountPence: depositPence,
    reference: `corporate:${enquiryId}`,
    description: `Digz N' Lidz corporate event deposit - ${enquiry.company_name || enquiry.contact_name}`,
    redirectUrl: `${env.SITE_URL}/corporate-confirmed?enquiry=${enquiryId}`,
  });

  await env.DB.prepare(
    `UPDATE corporate_enquiries SET status = 'confirmed', payment_link_sent = 1, square_payment_link = ? WHERE id = ?`
  )
    .bind(payment.checkoutUrl, enquiryId)
    .run();

  await sendEmail(env, {
    to: enquiry.email,
    subject: "Your Digz N' Lidz event, deposit link",
    html: `<p>Hi ${enquiry.contact_name},</p>
<p>Thanks for confirming your event with Digz N' Lidz. Pay your deposit here to lock it in:</p>
<p><a href="${payment.checkoutUrl}">${payment.checkoutUrl}</a></p>`,
  });

  return Response.json({ status: "confirmed", checkoutUrl: payment.checkoutUrl });
}
