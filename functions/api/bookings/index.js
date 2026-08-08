// POST /api/bookings
// Family or group booking. Takes how many people want each tier, works
// out the real total from the same settings-driven tier prices used at
// the seats, and returns a Square checkout link for that full amount.
// The booking stays "unpaid" until the webhook confirms payment.
// No separate "deposit", this is the actual session cost paid upfront;
// each paid seat gets redeemed by staff against a real seat when the
// party arrives (see /api/bookings/:id/redeem-seat). Accepts an optional
// discount code, applied to the total before the Square link is generated.

import { createPaymentLink } from "../../lib/square.js";
import { BUSINESS_HOURS } from "../config.js";
import { getSettings } from "../../lib/settings.js";
import { getVehicleCatalog } from "../../lib/capacity.js";

const TIER_KEYS = ["tier_1", "tier_2", "tier_3"];
// tier_1 (the 15 minute slot) is walk-in only, there's no point pre-booking
// online for something that short, see the tier_1 check below. Still fully
// valid at the seat itself (see lib/settings.js getTierConfig / dashboard
// claim-seat), this only blocks it from the online booking form/endpoint.
const TOTAL_SEATS = 16;
// An unpaid booking that never completes checkout shouldn't hold capacity
// hostage forever, but someone genuinely mid-checkout right now needs
// their seats protected so a second booking can't be confirmed underneath
// them. 20 minutes covers a normal checkout with room to spare.
const PENDING_HOLD_MINUTES = 20;

// bookingDate is "YYYY-MM-DD", parsed as UTC midnight which is fine here
// since we only need the day of week, not a precise instant.
function checkWithinHours(bookingDate, slotTime) {
  const day = new Date(`${bookingDate}T00:00:00Z`).getUTCDay();
  const hours = BUSINESS_HOURS[day];
  if (!hours) return { ok: false, error: "We're closed that day. Open Wednesday to Sunday." };
  if (slotTime < hours.open || slotTime >= hours.close) {
    return { ok: false, error: `That time's outside our hours for that day, ${hours.open} to ${hours.close}.` };
  }
  return { ok: true };
}

// The date picker on /book has a min= set so it won't offer a past date,
// but that's client-side only, nothing stopped someone (or a direct
// hit on this endpoint) paying for a slot that's already gone. Compared
// in Europe/London terms, not UTC or the server runtime's own clock,
// same reasoning as the cron worker's timezone handling.
function checkNotPast(bookingDate, slotTime) {
  const now = new Date();
  const todayLondon = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(now);
  const nowTimeLondon = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(now);
  if (bookingDate < todayLondon || (bookingDate === todayLondon && slotTime <= nowTimeLondon)) {
    return { ok: false, error: "That date or time has already passed, pick an upcoming slot." };
  }
  return { ok: true };
}

// The shop isn't taking bookings for any date before it's actually open,
// even though the form itself is live ahead of that so people can browse
// pricing and see when to come back. Client side (book.js) also blocks
// this on the date picker, but that's just UX, this is what actually
// stops a direct hit on this endpoint paying for a date before go-live.
function checkBookingOpen(bookingDate, opensDate) {
  if (!opensDate) return { ok: true }; // no go-live date set, don't block anything
  if (bookingDate < opensDate) {
    return {
      ok: false,
      error: `We're not taking bookings for that date yet, online booking opens from ${opensDate}.`,
    };
  }
  return { ok: true };
}

// Turns a slot_time + { tier_1: n, tier_2: n, tier_3: n } breakdown into
// one [start, end, seats] interval per tier actually used, in minutes
// from midnight. Different tiers in the same booking can run different
// lengths, so a family booking's tier_3 (60 min) people are still taking
// up seats after its tier_1 (15 min) people have finished.
function bookingIntervals(slotTime, breakdown, settings) {
  const [h, m] = slotTime.split(":").map(Number);
  const start = h * 60 + m;
  const intervals = [];
  for (const key of TIER_KEYS) {
    const seats = Number(breakdown[key]) || 0;
    if (seats === 0) continue;
    const minutes = Number(settings[`${key}_minutes`]);
    intervals.push({ start, end: start + minutes, seats });
  }
  return intervals;
}

// Sweeps every interval boundary and checks total concurrent seats at
// each point, this is what catches a 14:00-for-60-min booking and a
// 14:30-for-15-min booking both being fine individually but overlapping
// in the middle, which a simple "same slot_time" check would miss.
function exceedsCapacity(existingIntervals, newIntervals) {
  const all = [...existingIntervals, ...newIntervals];
  const boundaries = [...new Set(all.flatMap((iv) => [iv.start, iv.end]))];
  for (const t of boundaries) {
    const seatsAtT = all.reduce((sum, iv) => sum + (iv.start <= t && t < iv.end ? iv.seats : 0), 0);
    if (seatsAtT > TOTAL_SEATS) return true;
  }
  return false;
}

// Same overlap-sweep idea as exceedsCapacity above, but checked against
// each RC model's own total_units (and the shared trailer pool) instead
// of one shared seat count. Every online booking's whole visit window
// (slot start to the end of its longest tier) is used for every model or
// trailer it picked. tier_1 isn't bookable online (see the check further
// up), so there's only ever one length per booking's models in practice,
// this doesn't need to be any more precise than that.
function exceedsVehicleCapacity(existingVisits, newVisit, models, trailersTotal) {
  const all = [...existingVisits, newVisit];
  const boundaries = [...new Set(all.flatMap((v) => [v.start, v.end]))];

  for (const model of models) {
    for (const t of boundaries) {
      const unitsAtT = all.reduce((sum, v) => {
        if (!(v.start <= t && t < v.end)) return sum;
        return sum + (Number(v.vehicleBreakdown[model.slug]) || 0);
      }, 0);
      if (unitsAtT > model.total_units) return `We don't have enough ${model.name} free at that time.`;
    }
  }

  for (const t of boundaries) {
    const trailersAtT = all.reduce(
      (sum, v) => (v.start <= t && t < v.end ? sum + (Number(v.trailerCount) || 0) : sum),
      0
    );
    if (trailersAtT > trailersTotal) return "We don't have enough trailers free at that time.";
  }

  return null;
}

async function applyDiscount(db, code, amountPence) {
  if (!code) return { finalAmountPence: amountPence, discountCode: null };

  // Codes are always stored upper-cased (see dashboard/discount-codes.js),
  // but the customer's typed it into a plain text box, so normalise
  // before the lookup or a valid code in lowercase just silently "isn't
  // found".
  const normalizedCode = code.trim().toUpperCase();
  const discount = await db.prepare(`SELECT * FROM discount_codes WHERE code = ?`).bind(normalizedCode).first();
  if (!discount) return { finalAmountPence: amountPence, discountCode: null, error: "Discount code not found" };
  if (discount.expiry && new Date(discount.expiry) < new Date()) {
    return { finalAmountPence: amountPence, discountCode: null, error: "Discount code expired" };
  }
  if (discount.usage_limit && discount.uses >= discount.usage_limit) {
    return { finalAmountPence: amountPence, discountCode: null, error: "Discount code no longer available" };
  }

  const reduction = discount.discount_type === "percent"
    ? Math.round(amountPence * (discount.discount_value / 100))
    : discount.discount_value;

  const finalAmountPence = Math.max(0, amountPence - reduction);
  return { finalAmountPence, discountCode: discount.code };
}

export async function onRequestPost({ request, env }) {
  const body = await request.json();
  const { type, name, email, phone, tierCounts, bookingDate, slotTime, notes, discountCode, vehicleBreakdown, trailerCount } = body;
  // tierCounts: { tier_1: 2, tier_2: 0, tier_3: 1 }, how many people want each tier
  // vehicleBreakdown: { "wheel-loader-v2": 2, "scania-770s-red": 1 }, which
  // model each person in the party wants, keyed by vehicle_models.slug

  if (!["single", "couple", "family", "group"].includes(type)) {
    return Response.json({ error: "type must be single, couple, family, or group" }, { status: 400 });
  }
  if (!name || !email || !bookingDate || !slotTime) {
    return Response.json({ error: "missing required fields" }, { status: 400 });
  }
  if (!tierCounts || TIER_KEYS.every((k) => !tierCounts[k])) {
    return Response.json({ error: "pick at least one person for a tier" }, { status: 400 });
  }
  if (Number(tierCounts.tier_1) > 0) {
    return Response.json(
      { error: "15 minute sessions aren't available to pre-book online, that's a walk-in only option on the day. Choose 30 or 60 minutes instead." },
      { status: 400 }
    );
  }

  const hoursCheck = checkWithinHours(bookingDate, slotTime);
  if (!hoursCheck.ok) {
    return Response.json({ error: hoursCheck.error }, { status: 400 });
  }

  const notPastCheck = checkNotPast(bookingDate, slotTime);
  if (!notPastCheck.ok) {
    return Response.json({ error: notPastCheck.error }, { status: 400 });
  }

  // Real prices (and session lengths, for the capacity check below) come
  // from settings, same source the seats themselves use. Never trust a
  // client-supplied total, someone could tamper with it.
  const settings = await getSettings(env.DB, [
    "tier_1_price_pence", "tier_2_price_pence", "tier_3_price_pence",
    "tier_1_minutes", "tier_2_minutes", "tier_3_minutes",
    "booking_opens_date", "trailers_total",
  ]);

  const openCheck = checkBookingOpen(bookingDate, settings.booking_opens_date);
  if (!openCheck.ok) {
    return Response.json({ error: openCheck.error }, { status: 400 });
  }

  let baseTotal = 0;
  const cleanCounts = {};
  for (const key of TIER_KEYS) {
    const count = Math.max(0, Number(tierCounts[key]) || 0);
    cleanCounts[key] = count;
    baseTotal += count * Number(settings[`${key}_price_pence`]);
  }

  const partySize = TIER_KEYS.reduce((sum, k) => sum + cleanCounts[k], 0);

  // Only 16 physical seats exist. Check this booking's party doesn't push
  // total concurrent seat usage past that at any point during its visit,
  // counting every already-paid booking that day plus any booking still
  // inside its checkout window (see PENDING_HOLD_MINUTES above).
  // created_at is stamped by SQLite's own datetime('now') default,
  // "YYYY-MM-DD HH:MM:SS". Comparing that against a JS toISOString()
  // string ("YYYY-MM-DDTHH:MM:SS.sssZ", T instead of a space) breaks
  // silently for same-day comparisons, the space (0x20) sorts before 'T'
  // (0x54) so "today, 20 minutes ago" would look "less than" a same-day
  // cutoff regardless of the actual time. Doing the arithmetic in SQLite
  // itself keeps both sides in the same format.
  const { results: sameDayBookings } = await env.DB.prepare(
    `SELECT slot_time, tier_breakdown_json FROM bookings
     WHERE booking_date = ?
       AND (payment_status = 'paid' OR (payment_status = 'unpaid' AND created_at >= datetime('now', ?)))`
  )
    .bind(bookingDate, `-${PENDING_HOLD_MINUTES} minutes`)
    .all();

  const existingIntervals = sameDayBookings.flatMap((b) =>
    bookingIntervals(b.slot_time, JSON.parse(b.tier_breakdown_json || "{}"), settings)
  );
  const newIntervals = bookingIntervals(slotTime, cleanCounts, settings);

  if (exceedsCapacity(existingIntervals, newIntervals)) {
    return Response.json(
      {
        error: "We don't have enough free seats for your whole party at that time, try a different time or split into a smaller group.",
      },
      { status: 409 }
    );
  }

  // Every person in the party picks one RC model, this is an RC
  // experience booking, not a generic seat booking, so the two counts
  // have to match exactly rather than allowing a partial pick.
  const cleanVehicleBreakdown = {};
  let vehicleTotal = 0;
  const models = await getVehicleCatalog(env.DB);
  const modelBySlug = Object.fromEntries(models.map((m) => [m.slug, m]));
  for (const [slug, count] of Object.entries(vehicleBreakdown || {})) {
    if (!modelBySlug[slug]) {
      return Response.json({ error: `Unknown vehicle: ${slug}` }, { status: 400 });
    }
    const clean = Math.max(0, Number(count) || 0);
    if (clean === 0) continue;
    cleanVehicleBreakdown[slug] = clean;
    vehicleTotal += clean;
  }
  if (vehicleTotal !== partySize) {
    return Response.json(
      { error: "Everyone in the party needs a vehicle picked, and the count has to match your party size." },
      { status: 400 }
    );
  }
  const cleanTrailerCount = Math.max(0, Number(trailerCount) || 0);
  const scaniaPicks = (cleanVehicleBreakdown["scania-770s-red"] || 0) + (cleanVehicleBreakdown["scania-770s-green"] || 0);
  if (cleanTrailerCount > scaniaPicks) {
    return Response.json(
      { error: "You've asked for more trailers than Scania trucks in this booking." },
      { status: 400 }
    );
  }

  const { results: sameDayVehicleBookings } = await env.DB.prepare(
    `SELECT slot_time, tier_breakdown_json, vehicle_breakdown_json, trailer_count FROM bookings
     WHERE booking_date = ?
       AND (payment_status = 'paid' OR (payment_status = 'unpaid' AND created_at >= datetime('now', ?)))`
  )
    .bind(bookingDate, `-${PENDING_HOLD_MINUTES} minutes`)
    .all();

  const existingVisits = sameDayVehicleBookings.map((b) => {
    const ivs = bookingIntervals(b.slot_time, JSON.parse(b.tier_breakdown_json || "{}"), settings);
    const start = ivs.length ? ivs[0].start : 0;
    const end = ivs.length ? Math.max(...ivs.map((iv) => iv.end)) : start;
    return {
      start,
      end,
      vehicleBreakdown: JSON.parse(b.vehicle_breakdown_json || "{}"),
      trailerCount: b.trailer_count || 0,
    };
  });
  const newVisitStart = newIntervals.length ? newIntervals[0].start : 0;
  const newVisitEnd = newIntervals.length ? Math.max(...newIntervals.map((iv) => iv.end)) : newVisitStart;
  const newVisit = { start: newVisitStart, end: newVisitEnd, vehicleBreakdown: cleanVehicleBreakdown, trailerCount: cleanTrailerCount };

  const vehicleCapacityError = exceedsVehicleCapacity(existingVisits, newVisit, models, Number(settings.trailers_total) || 0);
  if (vehicleCapacityError) {
    return Response.json({ error: vehicleCapacityError }, { status: 409 });
  }

  const { finalAmountPence, discountCode: appliedCode, error: discountError } =
    await applyDiscount(env.DB, discountCode, baseTotal);

  if (discountError) {
    return Response.json({ error: discountError }, { status: 400 });
  }

  const insert = await env.DB.prepare(
    `INSERT INTO bookings (type, name, email, phone, party_size, booking_date, slot_time, total_amount_pence, tier_breakdown_json, notes, discount_code, vehicle_breakdown_json, trailer_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      type, name, email, phone || null, partySize, bookingDate, slotTime, finalAmountPence,
      JSON.stringify(cleanCounts), notes || null, appliedCode || null,
      JSON.stringify(cleanVehicleBreakdown), cleanTrailerCount
    )
    .run();

  const bookingId = insert.meta.last_row_id;

  let payment;
  try {
    payment = await createPaymentLink(env, {
      amountPence: finalAmountPence,
      reference: `booking:${bookingId}`,
      description: `Digz N' Lidz booking - ${type}, ${partySize} ${partySize === 1 ? "person" : "people"}`,
      redirectUrl: `${env.SITE_URL}/booking-confirmed?booking=${bookingId}`,
    });
  } catch (e) {
    // The booking row above is already saved as unpaid, that's fine, it
    // just sits there until someone pays or it expires off the hold. What
    // matters here is the customer sees a real reason instead of the page
    // silently breaking, and we get the actual Square error in the logs
    // rather than a generic crash.
    console.error("Square payment link creation failed", e);
    return Response.json(
      { error: `Couldn't start checkout with Square: ${e.message}. Nothing's been charged, try again in a moment.` },
      { status: 502 }
    );
  }

  await env.DB.prepare(`UPDATE bookings SET square_payment_id = ? WHERE id = ?`)
    .bind(payment.providerRef, bookingId)
    .run();

  // uses is incremented once the booking's actually paid (see the
  // webhook), not here. This used to increment on every checkout start,
  // paid or not, so a capped code (e.g. "first 10 customers") could be
  // burned through entirely by abandoned or test checkouts and lock out
  // real customers with no obvious reason why.

  return Response.json({
    bookingId,
    checkoutUrl: payment.checkoutUrl,
    totalAmountPence: finalAmountPence,
  });
}
