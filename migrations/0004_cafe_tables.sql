-- Cafe tables: 8 walk-in tables away from the RC pit, food and drink
-- ordering only, no digger session or booking attached to them.
-- Orders already has seat_id/session_id for pit orders; table_id lets the
-- same orders table and dashboard panel serve both without a second
-- parallel system.

ALTER TABLE orders ADD COLUMN table_id INTEGER;
