-- Family/group bookings now charge the real total for the tiers each
-- person picks at booking time, not a flat placeholder "deposit" that had
-- no real relationship to the actual per-person pricing. Corporate
-- enquiries keep their own deposit flow as-is, that's a separate,
-- staff-negotiated process and wasn't part of this change.

ALTER TABLE bookings RENAME COLUMN deposit_status TO payment_status;
ALTER TABLE bookings RENAME COLUMN deposit_amount_pence TO total_amount_pence;

-- e.g. {"tier_1":2,"tier_2":0,"tier_3":1}, how many people booked at each tier
ALTER TABLE bookings ADD COLUMN tier_breakdown_json TEXT;

-- Same shape, tracks how many of each tier have actually been redeemed at
-- a seat by staff so far. Starts empty, fills in as people check in.
ALTER TABLE bookings ADD COLUMN tier_redeemed_json TEXT NOT NULL DEFAULT '{}';
