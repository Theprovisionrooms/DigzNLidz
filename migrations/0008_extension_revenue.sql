-- The dashboard was estimating all-time extension revenue as
-- (total extensions ever) * (today's extension price), which quietly goes
-- wrong the moment anyone edits extension_price_pence in settings, every
-- extension charged at the old price gets silently re-priced at the new
-- one in the report. This records what was actually charged at the time,
-- same way orders.total_pence and bookings.total_amount_pence already do.
ALTER TABLE sessions ADD COLUMN extensions_revenue_pence INTEGER NOT NULL DEFAULT 0;
