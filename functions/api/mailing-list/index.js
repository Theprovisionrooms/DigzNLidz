// POST /api/mailing-list
// Called from booking confirmation and QR ordering flows when a customer
// opts in. Duplicates don't error, since the same customer may sign up
// more than once across different visits, instead their tags merge, so
// someone who's booked as both a couple and later a family keeps both
// tags rather than getting stuck on whichever came first. Used to
// target promos by party type later (see dashboard mailing list panel).

export async function onRequestPost({ request, env }) {
  const body = await request.json();
  const { email, source, tags } = body;

  if (!email) {
    return Response.json({ error: "email required" }, { status: 400 });
  }

  const existing = await env.DB.prepare(`SELECT tags FROM mailing_list WHERE email = ?`)
    .bind(email)
    .first();

  if (existing) {
    if (tags) {
      const existingTags = (existing.tags || "").split(",").map((t) => t.trim()).filter(Boolean);
      if (!existingTags.includes(tags)) {
        const mergedTags = [...existingTags, tags].join(",");
        await env.DB.prepare(`UPDATE mailing_list SET tags = ? WHERE email = ?`)
          .bind(mergedTags, email)
          .run();
      }
    }
    return Response.json({ status: "subscribed" });
  }

  await env.DB.prepare(
    `INSERT INTO mailing_list (email, source, tags) VALUES (?, ?, ?)`
  )
    .bind(email, source || "unknown", tags || null)
    .run();

  return Response.json({ status: "subscribed" });
}
