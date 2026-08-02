-- Square OAuth token storage.
--
-- Square requires OAuth in production once an app isn't strictly single
-- account, rather than a static personal access token (see
-- functions/lib/square-oauth.js). Single row, id is always 1, this venue's
-- Square connection, upserted on connect and again on every refresh.
-- Sandbox testing is unaffected and keeps using the plain SQUARE_ACCESS_TOKEN
-- env var, this table is only read/written when SQUARE_ENV = "production".

CREATE TABLE IF NOT EXISTS square_oauth (
  id INTEGER PRIMARY KEY,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  merchant_id TEXT,
  updated_at TEXT NOT NULL
);
