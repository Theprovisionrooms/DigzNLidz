// POST /api/corporate
// Corporate/private event enquiry. No payment here, this only logs the
// enquiry for Digz N' Lidz to confirm manually before any payment link
// goes out. Staff get an email so a new enquiry doesn't just sit unseen
// until someone happens to check the dashboard.

import { sendEmail } from "../../lib/email.js";

const STAFF_INBOX = "info@digznlidz.co.uk";

export async function onRequestPost({ request, env }) {
  const body = await request.json();
  const { companyName, contactName, email, phone, eventDate, headcount, eventDetails } = body;

  if (!contactName || !email) {
    return Response.json({ error: "missing required fields" }, { status: 400 });
  }

  const insert = await env.DB.prepare(
    `INSERT INTO corporate_enquiries (company_name, contact_name, email, phone, event_date, headcount, event_details)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(companyName || null, contactName, email, phone || null, eventDate || null, headcount || null, eventDetails || null)
    .run();

  // Best-effort. The enquiry's saved either way, staff will still see it
  // on the dashboard even if this email fails for some reason.
  try {
    await sendEmail(env, {
      to: STAFF_INBOX,
      subject: `New corporate enquiry: ${companyName || contactName}`,
      replyTo: email,
      html: `
        <p>New corporate/private event enquiry.</p>
        <p>
          <strong>${companyName || contactName}</strong><br>
          Contact: ${contactName} · ${email}${phone ? ` · ${phone}` : ""}<br>
          Headcount: ${headcount || "not given"}<br>
          Event date: ${eventDate || "TBC"}
        </p>
        <p>${eventDetails ? eventDetails.replace(/\n/g, "<br>") : "No further details given."}</p>
        <p>Reply direct to this enquiry's email, or confirm/accept it from the dashboard.</p>
      `,
    });
  } catch (e) {
    console.error("corporate enquiry notification email failed", e);
  }

  return Response.json({ enquiryId: insert.meta.last_row_id, status: "new" });
}
