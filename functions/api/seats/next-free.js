// GET /api/seats/next-free
// Public. Called by the shared walk-in QR page (/start/) to auto-assign a
// free seat rather than making a guest hunt the pit for one themselves.
//
// Deliberately holds back a small reserve of "free" seats when a paid
// booking's slot is close enough that a long walk-in session, sat down
// right now, could still be running when that booking actually needs its
// seat. The auto-hold cron only pins a seat 20 minutes before a slot (see
// HOLD_LEAD_MINUTES in workers/session-expiry-cron.js), so anything closer
// than that is already excluded from "free" automatically, this only
// covers the gap further out than that: 20 to 60 minutes ahead, where a
// seat still shows free but shouldn't be handed to a walk-in who might
// still be sat there when the booking's hold kicks in.
//
// This never turns a walk-in away just because a booking exists later in
// the day, only when one's genuinely due soon and seats are tight, so it
// doesn't cost walk-in trade during quiet periods.

const PROTECT_WINDOW_MINUTES = 60;
const TIERS = ["tier_1", "tier_2", "tier_3"];

export async function onRequestGet({ env }) {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const protectCutoff = new Date(now.getTime() + PROTECT_WINDOW_MINUTES * 60 * 1000);

  const { results: dueBookings } = await env.DB.prepare(
    `SELECT id, slot_time, tier_breakdown_json, tier_redeemed_json
     FROM bookings
     WHERE booking_date = ? AND payment_status = 'paid'`
  )
    .bind(today)
    .all();

  let reserved = 0;
  for (const booking of dueBookings) {
    const [h, m] = booking.slot_time.split(":").map(Number);
    const slotDate = new Date(now);
    slotDate.setHours(h, m, 0, 0);
    // Only reserve for bookings inside the protection window and not
    // already past, anything further out doesn't need protecting yet,
    // and anything already past is either seated or a no-show by now.
    if (slotDate > protectCutoff || slotDate < now) continue;

    const breakdown = JSON.parse(booking.tier_breakdown_json || "{}");
    const redeemed = JSON.parse(booking.tier_redeemed_json || "{}");

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

      // Already-held seats for this booking aren't "free" anyway, so they
      // don't need double protecting, this only counts what's still
      // outstanding for it.
      const stillNeeded = paidFor - alreadyRedeemed - alreadyHeldCount;
      if (stillNeeded > 0) reserved += stillNeeded;
    }
  }

  const { results: freeSeats } = await env.DB.prepare(
    `SELECT id FROM seats WHERE status = 'free' ORDER BY id`
  ).all();

  const available = freeSeats.length - reserved;

  if (available <= 0 || freeSeats.length === 0) {
    return Response.json(
      { error: "No free seats right now, a member of staff can help you find the next available spot." },
      { status: 409 }
    );
  }

  return Response.json({ seat: freeSeats[0].id });
}
