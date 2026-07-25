-- Seat holds.
--
-- Lets a paid booking be pinned to a specific seat ahead of the party's
-- arrival (status 'held', yellow on the dashboard), and lets a no-show
-- release that seat back to 'free' automatically after a grace period,
-- so staff never have to guess whether a seat is really spoken for.
--
-- seats.status gains a new value: 'held' (existing values: free, active,
-- awaiting_extension).
--
-- held_booking_id / held_tier: which booking and which tier of that
-- booking this hold is for. Lets a QR scan on a held seat start the
-- right session with no charge and no staff involved, since it's
-- already paid for as part of the booking.
--
-- held_until: booking slot time + no-show grace period. Past this with
-- no scan, the seat auto-releases back to 'free' so it can go to a
-- walk-in. See workers/session-expiry-cron.js.

ALTER TABLE seats ADD COLUMN held_booking_id INTEGER REFERENCES bookings(id);
ALTER TABLE seats ADD COLUMN held_tier TEXT;
ALTER TABLE seats ADD COLUMN held_until TEXT;
