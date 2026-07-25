-- Family/group bookings now charge the real total for the tiers each
-- person picks at booking time, not a flat placeholder "deposit" that had
-- no real relationship to the actual per-person pricing. Corporate
-- enquiries keep their own deposit flow as-is, that's a separate,
-- staff-negotiated process and wasn't part of this change.

-- NOTE (fixed): 0001_init.sql was edited after the fact to already create
-- bookings with payment_status, total_amount_pence, tier_breakdown_json
-- and tier_redeemed_json baked in, so the rename/add statements that used
-- to live here started failing against a fresh database with
-- "no such column: deposit_status". Nothing left to do in this migration,
-- kept as a no-op placeholder so migration numbering/history stays intact.
SELECT 1;
