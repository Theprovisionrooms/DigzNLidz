// POST /api/dashboard/campaigns/send
// Staff-facing. Sends a one-off email to everyone in the mailing list
// tagged with the given party type (single/couple/family/group).
//
// Resend's free tier caps at 100 emails/day. This checks how many have
// already gone out today across all campaigns and only sends up to
// whatever's left of that cap, so a big segment on a day that's already
// used some quota can't blow past it and start failing mid-send. Anything
// left over just needs the same send run again tomorrow.

import { isAuthenticated, unauthorizedResponse } from "../../../lib/auth.js";
import { sendEmail } from "../../../lib/email.js";

const DAILY_SEND_CAP = 100; // Resend free tier

export async function onRequestPost({ request, env }) {
  if (!(await isAuthenticated(request, env))) return unauthorizedResponse();

  const body = await request.json().catch(() => ({}));
  const { tag, subject, html } = body;

  if (!tag || !subject || !html) {
    return Response.json({ error: "tag, subject, and html are required" }, { status: 400 });
  }

  // tags is a comma-separated list per subscriber (e.g. "couple,family"),
  // so this matches the tag as a whole segment, not a substring of
  // another tag.
  const { results: recipients } = await env.DB.prepare(
    `SELECT email FROM mailing_list
     WHERE (',' || tags || ',') LIKE '%,' || ? || ',%'`
  )
    .bind(tag)
    .all();

  if (recipients.length === 0) {
    return Response.json({ error: `no subscribers tagged "${tag}"` }, { status: 400 });
  }

  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const { results: sentTodayRows } = await env.DB.prepare(
    `SELECT COUNT(*) as n FROM campaign_sends WHERE sent_at >= ?`
  )
    .bind(todayStart.toISOString())
    .all();
  const sentToday = sentTodayRows[0]?.n || 0;
  const remaining = DAILY_SEND_CAP - sentToday;

  if (remaining <= 0) {
    return Response.json(
      { error: "today's free-tier send limit (100 emails) is already used up, try again tomorrow" },
      { status: 429 }
    );
  }

  const toSend = recipients.slice(0, remaining);
  const deferred = recipients.length - toSend.length;

  const insert = await env.DB.prepare(
    `INSERT INTO campaigns (name, type, sent_at, segment_tag, subject, body_html, sent_count)
     VALUES (?, 'targeted', datetime('now'), ?, ?, ?, ?)`
  )
    .bind(`${tag}: ${subject}`, tag, subject, html, toSend.length)
    .run();
  const campaignId = insert.meta.last_row_id;

  const footer = `<p style="font-size:12px;color:#888;margin-top:24px;">You're getting this because you signed up at Digz N' Lidz. Reply and let us know if you'd rather not hear from us again.</p>`;

  let sentCount = 0;
  for (const r of toSend) {
    try {
      await sendEmail(env, { to: r.email, subject, html: html + footer });
      await env.DB.prepare(`INSERT INTO campaign_sends (campaign_id, email) VALUES (?, ?)`)
        .bind(campaignId, r.email)
        .run();
      sentCount++;
    } catch (e) {
      console.error(`campaign send failed for ${r.email}`, e);
    }
  }

  // Keep sent_count accurate if any individual sends failed above.
  if (sentCount !== toSend.length) {
    await env.DB.prepare(`UPDATE campaigns SET sent_count = ? WHERE id = ?`)
      .bind(sentCount, campaignId)
      .run();
  }

  return Response.json({
    status: "sent",
    tag,
    sent: sentCount,
    deferred,
    message:
      deferred > 0
        ? `sent to ${sentCount}, ${deferred} more tagged "${tag}" left for tomorrow (today's free-tier cap of 100 emails is used up)`
        : `sent to ${sentCount} subscribers tagged "${tag}"`,
  });
}
