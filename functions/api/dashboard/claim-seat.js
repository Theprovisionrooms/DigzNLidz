// POST /api/dashboard/claim-seat
// Staff-only fallback for when a customer's phone won't cooperate (no
// signal, no Apple/Google Pay, card declining online, etc). Staff take
// payment their own way at the counter (card machine or cash) and start
// the session directly, no Square call happens here at all, same
// approach as corporate_enquiries' cash/card-on-site accept flow.
//
// Any seat can be claimed this way, free or held, but claiming a held
// seat needs a second, explicit confirmation (force: true) once staff
// have seen who it's actually held for. This is the "double check
// bookings first" step: the first call always tells you, it never lets
// a held seat get silently overridden by accident.
//
// Won't touch a seat that's already active or awaiting an extension
// decision, that's a live session, not something to claim over.

import { isAuthenticated, unauthorizedResponse } from "../../lib/auth.js";
import { getTierConfig } from "../../lib/settings.js";

const CLAIM_METHODS = ["card_machine", "cash", "other"];

export async function onRequestPost({ request, env }) {
  if (!(await isAuthenticated(request, env))) return unauthorizedResponse();

  const { seatId, tier, claimMethod, note, force } = await request.json();

  if (!seatId || !["tier_1", "tier_2", "tier_3"].includes(tier)) {
    return Response.json({ error: "seatId and a valid tier are required" }, { status: 400 });
  }
  if (!CLAIM_METHODS.includes(claimMethod)) {
    return Response.json({ error: "claimMethod must be card_machine, cash, or other" }, { status: 400 });
  }

  const seat = await env.DB.prepare(`SELECT * FROM seats WHERE id = ?`).bind(seatId).first();
  if (!seat) return Response.json({ error: "seat not found" }, { status: 404 });

  if (seat.status === "active" || seat.status === "awaiting_extension" || seat.status === "starting") {
    return Response.json({ error: "This seat's already in use, end that session first if it needs correcting." }, { status: 409 });
  }

  // Held for a real booking, staff need to see that before overriding it.
  if (seat.status === "held" && !force) {
    const booking = seat.held_booking_id
      ? await env.DB.prepare(`SELECT name, slot_time FROM bookings WHERE id = ?`).bind(seat.held_booking_id).first()
      : null;
    return Response.json(
      {
        error: "held",
        held: {
          bookingId: seat.held_booking_id,
          bookingName: booking?.name || null,
          slotTime: booking?.slot_time || null,
          tier: seat.held_tier,
        },
        message: booking
          ? `Seat ${seatId} is held for ${booking.name}'s ${seat.held_tier.replace("tier_", "tier ")} booking at ${booking.slot_time}. Check they're not about to arrive before claiming it for someone else.`
          : `Seat ${seatId} is currently held for a booking. Check the booking isn't about to arrive before claiming it for someone else.`,
      },
      { status: 409 }
    );
  }

  // Atomic claim, same reasoning as start.js and redeem-seat.js: only one
  // request should ever win a given seat, whether that's a customer's own
  // scan landing at the same moment or two staff members both trying to
  // seat someone here.
  const claim = await env.DB.prepare(
    `UPDATE seats SET status = 'starting', claimed_at = ? WHERE id = ?`
  )
    .bind(new Date().toISOString(), seatId)
    .run();
  if (!claim.meta.changes) {
    return Response.json({ error: "Couldn't claim that seat, try again." }, { status: 409 });
  }

  const tierConfig = await getTierConfig(env.DB, tier);
  const startedAt = new Date();
  const endsAt = new Date(startedAt.getTime() + tierConfig.minutes * 60 * 1000);

  const insert = await env.DB.prepare(
    `INSERT INTO sessions (seat_id, tier, started_at, ends_at, staff_claimed, claim_method, claim_note)
     VALUES (?, ?, ?, ?, 1, ?, ?)`
  )
    .bind(seatId, tier, startedAt.toISOString(), endsAt.toISOString(), claimMethod, note || null)
    .run();

  const sessionId = insert.meta.last_row_id;

  await env.DB.prepare(
    `UPDATE seats
     SET status = 'active', current_session_id = ?, claimed_at = NULL,
         held_booking_id = NULL, held_tier = NULL, held_until = NULL
     WHERE id = ?`
  )
    .bind(sessionId, seatId)
    .run();

  return Response.json({ sessionId, endsAt: endsAt.toISOString() });
}
