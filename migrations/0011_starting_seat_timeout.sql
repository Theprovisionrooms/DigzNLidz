-- Fixes seats getting stuck on "starting" forever when a walk-in's scan
-- claims the seat but the payment never actually completes: card declined
-- mid-flight in a way that doesn't hit the normal error path, tab closed
-- or signal dropped while the Square charge request was in the air, etc.
-- Unlike "held" seats (0006), nothing was ever releasing these back to
-- "free", so the dashboard kept showing the seat as taken indefinitely
-- even though no one paid and no session exists.
--
-- claimed_at records when the claim UPDATE in start.js happened. The cron
-- worker now releases any seat still stuck on "starting" a few minutes
-- after that, the same way it already does for no-show "held" seats.

ALTER TABLE seats ADD COLUMN claimed_at TEXT;
