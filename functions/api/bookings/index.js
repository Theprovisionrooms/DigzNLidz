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

const TIER_KEYS = ["tier_1", "tier_2", "tier_3"];
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

async function applyDiscount(db, code, amountPence) {
  if (!code) return { finalAmountPence: amountPence, discountCode: null };

  const discount = await db.prepare(`SELECT * FROM discount_codes WHERE code = ?`).bind(code).first();
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
  const { type, name, email, phone, tierCounts, bookingDate, slotTime, notes, discountCode } = body;
  // tierCounts: { tier_1: 2, tier_2: 0, tier_3: 1 }, how many people want each tier

  if (!["single", "couple", "family", "group"].includes(type)) {
    return Response.json({ error: "type must be single, couple, family, or group" }, { status: 400 });
  }
  if (!name || !email || !bookingDate || !slotTime) {
    return Response.json({ error: "missing required fields" }, { status: 400 });
  }
  if (!tierCounts || TIER_KEYS.every((k) => !tierCounts[k])) {
    return Response.json({ error: "pick at least one person for a tier" }, { status: 400 });
  }

  const hoursCheck = checkWithinHours(bookingDate, slotTime);
  if (!hoursCheck.ok) {
    return Response.json({ error: hoursCheck.error }, { status: 400 });
  }

  // Real prices (and session lengths, for the capacity check below) come
  // from settings, same source the seats themselves use. Never trust a
  // client-supplied total, someone could tamper with it.
  const settings = await getSettings(env.DB, [
    "tier_1_price_pence", "tier_2_price_pence", "tier_3_price_pence",
    "tier_1_minutes", "tier_2_minutes", "tier_3_minutes",
  ]);

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

  const { finalAmountPence, discountCode: appliedCode, error: discountError } =
    await applyDiscount(env.DB, discountCode, baseTotal);

  if (discountError) {
    return Response.json({ error: discountError }, { status: 400 });
  }

  const insert = await env.DB.prepare(
    `INSERT INTO bookings (type, name, email, phone, party_size, booking_date, slot_time, total_amount_pence, tier_breakdown_json, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(type, name, email, phone || null, partySize, bookingDate, slotTime, finalAmountPence, JSON.stringify(cleanCounts), notes || null)
    .run();

  const bookingId = insert.meta.last_row_id;

  const payment = await createPaymentLink(env, {
    amountPence: finalAmountPence,
    reference: `booking:${bookingId}`,
    description: `Digz N' Lidz booking - ${type}, ${partySize} ${partySize === 1 ? "person" : "people"}`,
    redirectUrl: `${env.SITE_URL}/booking-confirmed?booking=${bookingId}`,
  });

  await env.DB.prepare(`UPDATE bookings SET square_payment_id = ? WHERE id = ?`)
    .bind(payment.providerRef, bookingId)
    .run();

  if (appliedCode) {
    await env.DB.prepare(`UPDATE discount_codes SET uses = uses + 1 WHERE code = ?`).bind(appliedCode).run();
  }

  return Response.json({
    bookingId,
    checkoutUrl: payment.checkoutUrl,
    totalAmountPence: finalAmountPence,
  });
}
