-- Needed so the webhook (functions/api/payments/square-webhook.js) can
-- increment a discount code's use count once a booking is actually paid,
-- instead of at checkout-start time (see functions/api/bookings/index.js).
-- Nothing on the bookings row previously recorded which code, if any,
-- had been applied.

ALTER TABLE bookings ADD COLUMN discount_code TEXT;
