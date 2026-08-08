-- RC vehicle model inventory, from the Modelling Electronics invoice
-- (23/06/2026). Booking is model-based, not seat-based: a guest reserves
-- "a Wheel Loader", not "seat 7", and gets handed whichever physical unit
-- of that model is free. Seats themselves stay generic (see 0001_init.sql),
-- this just adds a second, independent thing to reserve alongside them.
--
-- total_units is the hard physical ceiling per model, taken straight off
-- the invoice QTY column. The two 770S Scania trucks (red/green) can be
-- taken with or without a trailer, has_trailer_option flags those two.
-- The Huina "black truck trailer" line and the Scania LED demon-eyes set
-- are accessories, not vehicles in their own right, so they're not rows
-- here at all: trailers are tracked as a shared pool (trailers_total
-- setting below) rather than a model, and the LED set doesn't appear
-- anywhere in the booking/QR flow.
--
-- image_path points at a transparent-background PNG for the tap-to-select
-- picker on /book and /seat (see book.js / seat.js). Files aren't in this
-- migration, drop them in public/assets/img/vehicles/ using these exact
-- names before this ships.

CREATE TABLE vehicle_models (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  image_path TEXT,
  total_units INTEGER NOT NULL,
  has_trailer_option INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

INSERT INTO vehicle_models (slug, name, description, image_path, total_units, has_trailer_option, sort_order) VALUES
  ('metal-excavator', 'Metal 2.4G Excavator', 'Full metal 2.4GHz remote control excavator.', '/assets/img/vehicles/metal-excavator.png', 2, 0, 1),
  ('huina-excavator-diecast', 'Huina 1/14th Excavator', 'Diecast 1/14 scale Huina excavator.', '/assets/img/vehicles/huina-excavator-diecast.png', 2, 0, 2),
  ('excavator-v5', '2.4G Excavator V5.0', 'The latest version 5.0 2.4GHz excavator.', '/assets/img/vehicles/excavator-v5.png', 2, 0, 3),
  ('8-wheel-loader', '13CH 8-Wheel Loader', '13 channel 8-wheel digger with a metal bucket.', '/assets/img/vehicles/8-wheel-loader.png', 4, 0, 4),
  ('wheel-loader-v2', '2.4G Wheel Loader V2.0', 'Version 2.0 2.4GHz wheel loader.', '/assets/img/vehicles/wheel-loader-v2.png', 2, 0, 5),
  ('scania-770s-red', '770S Scania Truck (Red)', 'Red 770S Scania truck. Trailer optional.', '/assets/img/vehicles/scania-770s-red.png', 1, 1, 6),
  ('scania-770s-green', '770S Scania Truck (Green)', 'Green 770S Scania truck. Trailer optional.', '/assets/img/vehicles/scania-770s-green.png', 1, 1, 7),
  ('tower-crane', 'Huina Tower Crane 2.4G 12CH', '12 channel 2.4GHz tower crane.', '/assets/img/vehicles/tower-crane.png', 1, 0, 8);

-- 1 trailer that comes with the red truck, 1 with the green, plus 2 spare
-- Huina black trailers = 4 total, shared between whichever Scania truck
-- wants one. Kept as a settings value rather than a table since it's a
-- single shared pool, not a per-model thing.
INSERT INTO settings (key, value) VALUES ('trailers_total', '4');

-- Which model (and whether a trailer's attached) a live session at a seat
-- is actually using. Nullable: older rows and any non-RC session (there
-- isn't one today, but no reason to force it) just leave this unset.
ALTER TABLE sessions ADD COLUMN vehicle_model_id INTEGER REFERENCES vehicle_models(id);
ALTER TABLE sessions ADD COLUMN trailer INTEGER NOT NULL DEFAULT 0;

-- Same shape as tier_breakdown_json / tier_redeemed_json (0001_init.sql /
-- see bookings table), but keyed by vehicle_models.slug instead of tier,
-- e.g. {"wheel-loader-v2": 2, "scania-770s-red": 1}. trailer_count is how
-- many of the booking's Scania picks want a trailer; trailer_redeemed
-- tracks how many of those have actually been handed one so a family
-- with 2 Scania trucks but only 1 trailer request can't have both
-- redemptions grab a trailer.
ALTER TABLE bookings ADD COLUMN vehicle_breakdown_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE bookings ADD COLUMN vehicle_redeemed_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE bookings ADD COLUMN trailer_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bookings ADD COLUMN trailer_redeemed INTEGER NOT NULL DEFAULT 0;
