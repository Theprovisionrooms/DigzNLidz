-- Tracks failed dashboard login attempts per IP address so the shared
-- DASHBOARD_PASSWORD can't be brute-forced. A short lockout kicks in after
-- too many wrong attempts in a short window; a correct password clears the
-- row entirely. See functions/lib/auth.js.

CREATE TABLE login_attempts (
  ip TEXT PRIMARY KEY,
  fail_count INTEGER NOT NULL DEFAULT 0,
  first_fail_at TEXT NOT NULL,
  locked_until TEXT
);
