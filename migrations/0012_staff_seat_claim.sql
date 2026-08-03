-- Staff manual seat claim (fallback for a customer's phone/payment not
-- cooperating). Staff take payment their own way, off-system, on the
-- card machine or cash at the counter, then start the session directly
-- from the dashboard rather than the customer's own scan-and-pay.
--
-- Same pattern as corporate_enquiries.deposit_method (0009): no Square
-- call happens for this session at all, so nothing here should ever be
-- counted twice against a real Square payment. staff_claimed marks a
-- session as one of these so it's obvious in the data which sessions
-- went through the normal online flow and which didn't, claim_method
-- records how payment was actually taken, claim_note is optional staff
-- context (e.g. which booking they double-checked against).
ALTER TABLE sessions ADD COLUMN staff_claimed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN claim_method TEXT;
ALTER TABLE sessions ADD COLUMN claim_note TEXT;
