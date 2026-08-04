// GET /api/seats/next-free-group?size=N
// Public. Called by the group walk-in flow (/group-start/) once the
// guest has said how many are in their party. Claims N free seats
// atomically so the whole group pays once and gets seated together,
// rather than each scanning the shared QR separately.
//
// If there aren't enough free seats, this doesn't just say "no", it
// returns a rough wait estimate (see getGroupWaitEstimate) so the guest
// knows whether it's worth hanging on, and points them at staff, who can
// seat a group manually from the dashboard the moment something frees up
// or if the online flow isn't working for them.

import { getSeatAvailability, getGroupWaitEstimate } from "../../lib/capacity.js";

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const size = Number(url.searchParams.get("size"));

  if (!Number.isInteger(size) || size < 1) {
    return Response.json({ error: "invalid group size" }, { status: 400 });
  }

  const { freeSeatIds, available } = await getSeatAvailability(env.DB);

  if (available < size) {
    const stillNeeded = size - Math.max(available, 0);
    const waitMinutes = await getGroupWaitEstimate(env.DB, stillNeeded);
    return Response.json(
      {
        error:
          waitMinutes != null
            ? `Not quite enough free seats for your group right now, about ${waitMinutes} minute${waitMinutes === 1 ? "" : "s"} until there's room. A member of staff can also help seat you sooner if some of you want to split up.`
            : "Not enough free seats for your group right now. A member of staff can help find you space.",
        waitMinutes,
        availableNow: Math.max(available, 0),
      },
      { status: 409 }
    );
  }

  // Claim `size` seats atomically. Same guarded UPDATE pattern as the
  // single-seat claim in seats/[id]/start.js, just repeated per seat, so
  // two groups racing for the same seats can't both win it. If any claim
  // in the batch loses the race (extremely tight timing, but possible),
  // release everything already claimed back to free rather than leaving
  // the group one seat short.
  //
  // claimed_at is stamped for the same reason it is in start.js: if the
  // group never makes it to group/start.js at all (tab closed, walked
  // off, phone died, before ever attempting payment), nothing else would
  // release these seats. Without this the stuck-starting cron (0011)
  // silently skips them, since its query only picks up seats where
  // claimed_at is actually set, and they'd sit "taken" on the dashboard
  // indefinitely with no way for staff to reclaim them.
  const claimedAt = new Date().toISOString();
  const claimed = [];
  for (const seatId of freeSeatIds.slice(0, size)) {
    const claim = await env.DB.prepare(
      `UPDATE seats SET status = 'starting', claimed_at = ? WHERE id = ? AND status = 'free'`
    )
      .bind(claimedAt, seatId)
      .run();
    if (claim.meta.changes) {
      claimed.push(seatId);
    } else {
      break;
    }
  }

  if (claimed.length < size) {
    // Lost the race on at least one seat, release everything we did
    // manage to claim and ask the guest to try again.
    for (const seatId of claimed) {
      await env.DB.prepare(`UPDATE seats SET status = 'free', claimed_at = NULL WHERE id = ?`).bind(seatId).run();
    }
    return Response.json(
      { error: "Those seats were just taken, try again." },
      { status: 409 }
    );
  }

  return Response.json({ seats: claimed });
}
