// POST /api/contact
// General questions/feedback form at /contact/. Not a booking or a
// corporate enquiry, just routes straight to staff. This didn't exist
// before, the form on the page had no backend at all.

import { sendEmail } from "../lib/email.js";

const STAFF_INBOX = "info@digznlidz.co.uk";

export async function onRequestPost({ request, env }) {
  const body = await request.json().catch(() => ({}));
  const { name, email, message } = body;

  if (!name || !email || !message) {
    return Response.json({ error: "missing required fields" }, { status: 400 });
  }

  try {
    await sendEmail(env, {
      to: STAFF_INBOX,
      subject: `Contact form: ${name}`,
      replyTo: email,
      html: `
        <p>New message from the contact form.</p>
        <p><strong>${name}</strong> · ${email}</p>
        <p>${message.replace(/\n/g, "<br>")}</p>
        <p><small>Reply direct to this email to get back to them.</small></p>
      `,
    });
  } catch (e) {
    console.error("contact form email failed", e);
    return Response.json(
      { error: "Couldn't send that right now, try again in a moment or email us directly." },
      { status: 502 }
    );
  }

  return Response.json({ status: "sent" });
}
