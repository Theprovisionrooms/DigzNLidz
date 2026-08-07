-- Online bookings only actually go live from a set date (confirmed by
-- Jordan as 1st September 2026, to see how far ahead people book before
-- committing to an earlier opening). Everything before that keeps the
-- booking form up and browsable, but blocks that date specifically, both
-- client and server side, so no one can pay for a date the shop hasn't
-- opened for yet. If the opening gets moved forward, just update the
-- value here (or via the settings table directly), no code change needed.

INSERT INTO settings (key, value) VALUES ('booking_opens_date', '2026-09-01');
