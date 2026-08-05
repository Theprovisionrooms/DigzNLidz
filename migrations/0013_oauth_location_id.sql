-- Stores the connected Square account's real location id, fetched from
-- Square's own /v2/locations once at OAuth connect time (see
-- functions/lib/square-oauth.js). Previously every charge just read a
-- single hardcoded SQUARE_LOCATION_ID env var for both sandbox and
-- production, which meant going live for real depended on someone
-- remembering to manually swap that value for the venue's actual
-- production location id, with nothing in the code to catch it if they
-- forgot. Now production always uses whatever's actually connected;
-- sandbox is unaffected and keeps using SQUARE_LOCATION_ID directly.

ALTER TABLE square_oauth ADD COLUMN location_id TEXT;
