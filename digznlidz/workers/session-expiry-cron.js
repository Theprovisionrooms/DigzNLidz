// Scheduled Worker, runs every minute via Cron Trigger.
// Deployed separately from the Pages site since Cron Triggers need their own
// Worker. Bound to the same D1 database (see wrangler.toml in this folder).
//
// Flips any session whose ends_at has passed from "active" to "expired" and
// marks the seat "awaiting_extension", which is what the seat page polls
// for to show the "add 15 minutes for £5" prompt.

export default {
  async scheduled(event, env, ctx) {
    const now = new Date().toISOString();

    const { results: expiring } = await env.DB.prepare(
      `SELECT id, seat_id FROM sessions WHERE status = 'active' AND ends_at <= ?`
    )
      .bind(now)
      .all();

    for (const session of expiring) {
      await env.DB.prepare(`UPDATE sessions SET status = 'expired' WHERE id = ?`)
        .bind(session.id)
        .run();
      await env.DB.prepare(`UPDATE seats SET status = 'awaiting_extension' WHERE id = ?`)
        .bind(session.seat_id)
        .run();
    }
  },
};
