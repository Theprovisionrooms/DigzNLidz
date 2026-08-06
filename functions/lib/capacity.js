// Shared seat-capacity logic. Originally lived only in
// functions/api/seats/next-free.js; pulled out here so extend.js can use
// the exact same numbers rather than a second, possibly-drifting copy.
//
// "reserved" is how many currently-free seats need to stay free (or become
// free) to cover paid bookings due inside PROTECT_WINDOW_MINUTES. See
// next-free.js's original comment for the fuller reasoning: the auto-hold
// cron only pins a seat 20 minutes before a slot, so this only needs to
// cover the gap further out than that, 20 to 60 minutes ahead.

const PROTECT_WINDOW_MINUTES = 60;
const TIERS = ["tier_1", "tier_2", "tier_3"];

// Same issue and same fix as workers/session-expiry-cron.js: Cloudflare
// Pages Functions run in UTC too, but slot_time is UK wall-clock time,
// so comparing it against a plain UTC Date used to be off by the UK's
// current offset from UTC, an hour during BST. That's roughly Apr-Oct,
// so most of the trading season, and it's what this exact function uses
// to decide how many free seats need to stay reserved for bookings due
// soon, i.e. it could tell a walk-in group seats are free when they're
// about to be needed for a paid booking, or hold seats back that didn't
// need holding yet. This can't share code with the cron worker, they're
// separate Cloudflare deploy targets with separate builds (see
// HANDOVER.md), so the same small helpers are duplicated here.
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

export function londonDateString(date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(date);
}

function londonSlotToUtcDate(dateStr, timeStr) {
  const [year, month, day] = dateStr.split("-").map(Number);
  const [hour, minute] = timeStr.split(":").map(Number);
  const guessUtc = new Date(Date.UTC(year, month - 1, day, hour, minute));
  return new Date(guessUtc.getTime() - londonOffsetMinutes(guessUtc) * 60000);
}

export async function getSeatAvailability(db) {
  const now = new Date();
  const today = londonDateString(now);
  const protectCutoff = new Date(now.getTime() + PROTECT_WINDOW_MINUTES * 60 * 1000);

  const { results: dueBookings } = await db.prepare(
    `SELECT id, slot_time, tier_breakdown_json, tier_redeemed_json
     FROM bookings
     WHERE booking_date = ? AND payment_status = 'paid'`
  )
    .bind(today)
    .all();

  let reserved = 0;
  for (const booking of dueBookings) {
    const slotDate = londonSlotToUtcDate(today, booking.slot_time);
    if (slotDate > protectCutoff || slotDate < now) continue;

    const breakdown = JSON.parse(booking.tier_breakdown_json || "{}");
    const redeemed = JSON.parse(booking.tier_redeemed_json || "{}");

    for (const tier of TIERS) {
      const paidFor = Number(breakdown[tier]) || 0;
      if (paidFor === 0) continue;
      const alreadyRedeemed = Number(redeemed[tier]) || 0;

      const { results: alreadyHeld } = await db.prepare(
        `SELECT COUNT(*) as n FROM seats WHERE held_booking_id = ? AND held_tier = ?`
      )
        .bind(booking.id, tier)
        .all();
      const alreadyHeldCount = alreadyHeld[0]?.n || 0;

      const stillNeeded = paidFor - alreadyRedeemed - alreadyHeldCount;
      if (stillNeeded > 0) reserved += stillNeeded;
    }
  }

  const { results: freeSeats } = await db.prepare(
    `SELECT id FROM seats WHERE status = 'free' ORDER BY id`
  ).all();

  return {
    freeSeatIds: freeSeats.map((s) => s.id),
    reserved,
    available: freeSeats.length - reserved,
  };
}

// Rough wait estimate for a walk-in group bigger than what's free right
// now. Looks at the soonest-ending active sessions, since a seat is only
// actually usable by the group once it's ended, and takes the Nth
// soonest end time, where N is how many more seats the group still
// needs. Deliberately approximate, this ignores the reserved-for-bookings
// logic in getSeatAvailability above, it's a "roughly how long" figure
// for the guest waiting at the counter, not a guarantee.
export async function getGroupWaitEstimate(db, stillNeeded) {
  if (stillNeeded <= 0) return 0;

  const { results } = await db.prepare(
    `SELECT ends_at FROM sessions WHERE status = 'active' ORDER BY ends_at ASC LIMIT ?`
  )
    .bind(stillNeeded)
    .all();

  if (results.length < stillNeeded) {
    // Not even enough active sessions to free up that many seats, at
    // this point it's not really a "wait", it's "come back later" or
    // "ask staff", so don't pretend to give a precise number.
    return null;
  }

  const nthEndsAt = new Date(results[results.length - 1].ends_at).getTime();
  const waitMs = nthEndsAt - Date.now();
  return Math.max(1, Math.ceil(waitMs / 60000));
}
