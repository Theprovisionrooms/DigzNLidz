// Scheduled Worker, runs every minute via Cron Trigger.
// Deployed separately from the Pages site since Cron Triggers need their own
// Worker. Bound to the same D1 database (see wrangler.toml in this folder).
//
// Three jobs each run, in order:
//  1. Session expiry (existing): flips any session past its ends_at from
//     "active" to "expired" and marks the seat "awaiting_extension".
//  2. Auto-hold: for today's paid bookings whose slot is coming up soon,
//     pins free seats to that booking ("held", yellow on the dashboard)
//     so a walk-in can't be given a seat that's about to be needed.
//  3. No-show release: any held seat whose grace period has passed with
//     no QR scan goes back to "free" so staff can hand it to a walk-in
//     without having to remember to release it themselves.

// How far ahead of a booking's slot time to pin a seat for it.
const HOLD_LEAD_MINUTES = 20;

// How long after the slot time a held seat waits for a scan before it's
// treated as a no-show and released back to free.
const NO_SHOW_GRACE_MINUTES = 5;

const TIERS = ["tier_1", "tier_2", "tier_3"];

export default {
  async scheduled(event, env, ctx) {
    const now = new Date();
    const nowIso = now.toISOString();

    // --- 1. Session expiry (unchanged) ---
    const { results: expiring } = await env.DB.prepare(
      `SELECT id, seat_id FROM sessions WHERE status = 'active' AND ends_at <= ?`
    )
      .bind(nowIso)
      .all();

    for (const session of expiring) {
      await env.DB.prepare(`UPDATE sessions SET status = 'expired' WHERE id = ?`)
        .bind(session.id)
        .run();
      await env.DB.prepare(`UPDATE seats SET status = 'awaiting_extension' WHERE id = ?`)
        .bind(session.seat_id)
        .run();
    }

    // --- 2. Auto-hold: pin seats for bookings coming up soon ---
    const today = now.toISOString().slice(0, 10);
    const leadCutoff = new Date(now.getTime() + HOLD_LEAD_MINUTES * 60 * 1000);

    const { results: dueBookings } = await env.DB.prepare(
      `SELECT id, slot_time, tier_breakdown_json, tier_redeemed_json
       FROM bookings
       WHERE booking_date = ? AND payment_status = 'paid'`
    )
      .bind(today)
      .all();

    for (const booking of dueBookings) {
      const [h, m] = booking.slot_time.split(":").map(Number);
      const slotDate = new Date(now);
      slotDate.setHours(h, m, 0, 0);

      // Only hold seats once we're inside the lead window and the slot
      // hasn't already passed, no point pinning a seat for something
      // hours away or that's already started.
      if (slotDate > leadCutoff || slotDate < now) continue;

      const breakdown = JSON.parse(booking.tier_breakdown_json || "{}");
      const redeemed = JSON.parse(booking.tier_redeemed_json || "{}");
      const holdUntil = new Date(slotDate.getTime() + NO_SHOW_GRACE_MINUTES * 60 * 1000).toISOString();

      for (const tier of TIERS) {
        const paidFor = Number(breakdown[tier]) || 0;
        if (paidFor === 0) continue;
        const alreadyRedeemed = Number(redeemed[tier]) || 0;

        const { results: alreadyHeld } = await env.DB.prepare(
          `SELECT COUNT(*) as n FROM seats WHERE held_booking_id = ? AND held_tier = ?`
        )
          .bind(booking.id, tier)
          .all();
        const alreadyHeldCount = alreadyHeld[0]?.n || 0;

        const stillNeeded = paidFor - alreadyRedeemed - alreadyHeldCount;
        if (stillNeeded <= 0) continue;

        const { results: freeSeats } = await env.DB.prepare(
          `SELECT id FROM seats WHERE status = 'free' ORDER BY id LIMIT ?`
        )
          .bind(stillNeeded)
          .all();

        for (const seat of freeSeats) {
          await env.DB.prepare(
            `UPDATE seats SET status = 'held', held_booking_id = ?, held_tier = ?, held_until = ? WHERE id = ?`
          )
            .bind(booking.id, tier, holdUntil, seat.id)
            .run();
        }
      }
    }

    // --- 3. No-show release ---
    await env.DB.prepare(
      `UPDATE seats
       SET status = 'free', held_booking_id = NULL, held_tier = NULL, held_until = NULL
       WHERE status = 'held' AND held_until <= ?`
    )
      .bind(nowIso)
      .run();
  },
};
