// POST /api/corporate/:id/cancel
// Staff-facing. Customer couldn't do the date after all, or it fell
// through before ever being accepted. Doesn't delete anything, just
// takes it off the active lists.

import { isAuthenticated, unauthorizedResponse } from "../../../lib/auth.js";

export async function onRequestPost({ params, request, env }) {
  if (!(await isAuthenticated(request, env))) return unauthorizedResponse();

  const enquiryId = params.id;

  const enquiry = await env.DB.prepare(`SELECT id FROM corporate_enquiries WHERE id = ?`)
    .bind(enquiryId)
    .first();

  if (!enquiry) {
    return Response.json({ error: "enquiry not found" }, { status: 404 });
  }

  await env.DB.prepare(
    `UPDATE corporate_enquiries SET status = 'cancelled', status_updated_at = datetime('now') WHERE id = ?`
  )
    .bind(enquiryId)
    .run();

  return Response.json({ status: "cancelled" });
}
