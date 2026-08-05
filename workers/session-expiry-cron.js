// Scheduled Worker, runs every minute via Cron Trigger.
// Deployed separately from the Pages site since Cron Triggers need their own
// Worker. Bound to the same D1 database (see wrangler.toml in this folder).
//
// Four jobs each run, in order:
//  1. Session expiry (existing): flips any session past its ends_at from
//     "active" to "expired" and marks the seat "awaiting_extension".
//  2. Auto-hold: for today's paid bookings whose slot is coming up soon,
//     pins free seats to that booking ("held", yellow on the dashboard)
//     so a walk-in can't be given a seat that's about to be needed. Any
//     seat newly pinned in this run gets emailed to the booking straight
//     away, telling them which seat number to head to, since staff can't
//     point a booking to a seat that hasn't been assigned yet.
//  3. No-show release: any held seat whose grace period has passed with
//     no QR scan goes back to "free" so staff can hand it to a walk-in
//     without having to remember to release it themselves.
//  4. Stuck-starting release: a scan claims a seat ("starting") before
//     payment is charged; normally start.js releases it straight back to
//     free itself if the charge fails. But if the customer's connection
//     drops or the tab closes mid-request, that release never runs, and
//     until now nothing else ever put the seat back either, so it sat on
//     "starting" - shown as taken on the dashboard - indefinitely even
//     though nobody paid and no session started. Anything still stuck
//     there a few minutes after being claimed gets swept back to free.

// How far ahead of a booking's slot time to pin a seat for it.
const HOLD_LEAD_MINUTES = 20;

// How long after the slot time a held seat waits for a scan before it's
// treated as a no-show and released back to free.
const NO_SHOW_GRACE_MINUTES = 10;

// How long a seat can sit on "starting" (claimed, payment not yet
// confirmed) before it's treated as abandoned and released back to free.
// A real payment resolves in seconds, so this is generous headroom for a
// slow card network, not something a genuine in-progress payment should
// ever bump into.
const STARTING_TIMEOUT_MINUTES = 5;

const TIERS = ["tier_1", "tier_2", "tier_3"];

// Same thin Resend wrapper as functions/lib/email.js. Kept as a local
// copy rather than an import since this cron worker is its own separate
// Wrangler deployment (see workers/wrangler.toml) with its own bundle,
// not part of the Pages Functions build.
async function sendEmail(env, { to, subject, html }) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${env.RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM || "Digz N' Lidz <bookings@digznlidz.co.uk>",
      to,
      subject,
      html,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Resend error: ${err}`);
  }
  return res.json();
}

// Cloudflare Workers always run in UTC, there's no "local" timezone.
// slot_time and booking_date are wall-clock UK time as a customer or
// staff member typed them though, so comparing them against a plain UTC
// Date used to be off by whatever the UK's current offset from UTC is,
// an hour during BST (roughly late March to late October, which covers
// most of the trading season including right now). That meant seats got
// auto-held and the "your seat's ready" email went out an hour later
// than a booking's actual slot time, not earlier, so it could land after
// the customer had already arrived. Computed via Intl rather than a
// hardcoded +1 so it keeps working across the GMT/BST switchover instead
// of quietly breaking again every spring and autumn.
function londonOffsetMinutes(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/London",
    hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  })
    .formatToParts(date)
    .reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
  const asUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    parts.hour === "24" ? 0 : Number(parts.hour), Number(parts.minute), Number(parts.second)
  );
  return Math.round((asUtc - date.getTime()) / 60000);
}

// "YYYY-MM-DD" London calendar date for a given instant, not UTC's.
function londonDateString(date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(date);
}

// Interprets dateStr + "HH:MM" as London wall-clock time and returns the
// real UTC instant it corresponds to.
function londonSlotToUtcDate(dateStr, timeStr) {
  const [year, month, day] = dateStr.split("-").map(Number);
  const [hour, minute] = timeStr.split(":").map(Number);
  const guessUtc = new Date(Date.UTC(year, month - 1, day, hour, minute));
  return new Date(guessUtc.getTime() - londonOffsetMinutes(guessUtc) * 60000);
}

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
    const today = londonDateString(now);
    const leadCutoff = new Date(now.getTime() + HOLD_LEAD_MINUTES * 60 * 1000);

    const { results: dueBookings } = await env.DB.prepare(
      `SELECT id, name, email, slot_time, tier_breakdown_json, tier_redeemed_json
       FROM bookings
       WHERE booking_date = ? AND payment_status = 'paid'`
    )
      .bind(today)
      .all();

    for (const booking of dueBookings) {
      const slotDate = londonSlotToUtcDate(today, booking.slot_time);

      // Only hold seats once we're inside the lead window and the slot

      // hasn't already passed, no point pinning a seat for something
      // hours away or that's already started.
      if (slotDate > leadCutoff || slotDate < now) continue;

      const breakdown = JSON.parse(booking.tier_breakdown_json || "{}");
      const redeemed = JSON.parse(booking.tier_redeemed_json || "{}");
      const holdUntil = new Date(slotDate.getTime() + NO_SHOW_GRACE_MINUTES * 60 * 1000).toISOString();

      // Seat ids pinned to this booking during this run, across every
      // tier. Only ever contains seats that were "free" a moment ago,
      // so this is exactly the set worth telling the booking about,
      // nothing already-known gets re-emailed on the next tick.
      const newlyHeldSeatIds = [];

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
          newlyHeldSeatIds.push(seat.id);
        }
      }

      // Tell the booking which seat(s) they've been assigned, so a guest
      // isn't relying on staff to spot and point them to a held seat.
      // Wrapped so a Resend hiccup can't stop the rest of this cron run,
      // the seats are already held either way, this is just the notice.
      if (newlyHeldSeatIds.length > 0 && booking.email) {
        const seatNumbers = newlyHeldSeatIds.sort((a, b) => a - b).join(", ");
        const plural = newlyHeldSeatIds.length > 1;
        try {
          await sendEmail(env, {
            to: booking.email,
            subject: `Your seat${plural ? "s are" : " is"} ready at Digz N' Lidz`,
            html: `<p>Hi ${booking.name},</p><p>We've got seat${plural ? "s" : ""} <strong>${seatNumbers}</strong> ready for you. When you arrive, head straight there and scan the QR code at the seat to start your session, no need to queue at the door first. A member of staff will be happy to point you over if you can't spot it.</p>`,
          });
        } catch (err) {
          console.error("seat-hold email failed for booking", booking.id, err);
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

    // --- 4. Stuck-starting release ---
    const startingCutoff = new Date(now.getTime() - STARTING_TIMEOUT_MINUTES * 60 * 1000).toISOString();
    await env.DB.prepare(
      `UPDATE seats
       SET status = 'free', claimed_at = NULL
       WHERE status = 'starting' AND claimed_at IS NOT NULL AND claimed_at <= ?`
    )
      .bind(startingCutoff)
      .run();
  },
};
