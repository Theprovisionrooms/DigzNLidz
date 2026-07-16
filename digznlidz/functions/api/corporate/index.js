// POST /api/corporate
// Corporate/private event enquiry. No payment here, this only logs the
// enquiry for Digz N' Lidz to confirm manually before any payment link
// goes out.

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

  return Response.json({ enquiryId: insert.meta.last_row_id, status: "new" });
}
