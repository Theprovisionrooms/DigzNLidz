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

import { getSeatAvailability } from "../../lib/capacity.js";

export async function onRequestGet({ env }) {
  const { freeSeatIds, available } = await getSeatAvailability(env.DB);

  if (available <= 0 || freeSeatIds.length === 0) {
    return Response.json(
      { error: "No free seats right now, a member of staff can help you find the next available spot." },
      { status: 409 }
    );
  }

  return Response.json({ seat: freeSeatIds[0] });
}
