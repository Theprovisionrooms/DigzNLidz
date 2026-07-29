// POST /api/corporate/:id/accept
// Staff-facing. For events where Mark and Danny are taking the deposit in
// person (cash, or card on the venue's own machine) rather than sending a
// Square payment link. No Square call here at all, this just marks the
// enquiry as accepted so it shows on the upcoming-events list instead of
// sitting in "awaiting confirmation" forever.

import { isAuthenticated, unauthorizedResponse } from "../../../lib/auth.js";

export async function onRequestPost({ params, request, env }) {
  if (!(await isAuthenticated(request, env))) return unauthorizedResponse();

  const enquiryId = params.id;
  const body = await request.json().catch(() => ({}));
  const depositMethod = body.depositMethod || "cash"; // "cash" | "card_on_site" | "none"
  const depositNote = body.depositNote || null;

  const enquiry = await env.DB.prepare(`SELECT * FROM corporate_enquiries WHERE id = ?`)
    .bind(enquiryId)
    .first();

  if (!enquiry) {
    return Response.json({ error: "enquiry not found" }, { status: 404 });
  }

  await env.DB.prepare(
    `UPDATE corporate_enquiries
     SET status = 'accepted', deposit_method = ?, deposit_note = ?, status_updated_at = datetime('now')
     WHERE id = ?`
  )
    .bind(depositMethod, depositNote, enquiryId)
    .run();

  return Response.json({ status: "accepted" });
}
