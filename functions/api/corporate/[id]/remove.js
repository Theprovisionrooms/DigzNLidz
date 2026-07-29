// POST /api/corporate/:id/remove
// Staff-facing. For enquiries whose event date has already been and
// gone, whether it happened or not, this just clears it off the active
// dashboard view. Soft delete only, sets status = 'removed' rather than
// deleting the row, so the record's still there if you ever need to
// look a past event back up.

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
    `UPDATE corporate_enquiries SET status = 'removed', status_updated_at = datetime('now') WHERE id = ?`
  )
    .bind(enquiryId)
    .run();

  return Response.json({ status: "removed" });
}
