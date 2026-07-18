// POST /api/mailing-list
// Called from booking confirmation and QR ordering flows when a customer
// opts in. Silently ignores duplicates rather than erroring, since the same
// customer may sign up more than once across different visits.

export async function onRequestPost({ request, env }) {
  const body = await request.json();
  const { email, source, tags } = body;

  if (!email) {
    return Response.json({ error: "email required" }, { status: 400 });
  }

  await env.DB.prepare(
    `INSERT INTO mailing_list (email, source, tags) VALUES (?, ?, ?)
     ON CONFLICT(email) DO NOTHING`
  )
    .bind(email, source || "unknown", tags || null)
    .run();

  return Response.json({ status: "subscribed" });
}
