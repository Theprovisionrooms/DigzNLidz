-- Card on file support.
--
-- Lets a seat session save the customer's card after the first payment so
-- extends and food/drink orders in the same visit charge instantly, no
-- re-entering card details each time. Scoped to the session, not stored
-- against the customer long term, the card is disabled with Square once
-- the session ends (see functions/api/seats/[id]/end.js).

ALTER TABLE sessions ADD COLUMN square_customer_id TEXT;
ALTER TABLE sessions ADD COLUMN square_card_id TEXT;
