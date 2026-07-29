-- Corporate enquiries only ever went new -> confirmed (Square payment link).
-- Staff need to mark an enquiry accepted without forcing a payment link
-- (cash deposit taken in person instead), cancel one the customer can't
-- do, and remove old ones from the active dashboard view once the event
-- date's passed. Status stays a free-text column (no CHECK constraint,
-- matching how the rest of this schema does status fields), valid values
-- are now: new, accepted, confirmed, cancelled, removed.
--
-- deposit_method and deposit_note cover the cash-on-site case: staff
-- record how the deposit was taken instead of a Square payment link
-- existing for it.
ALTER TABLE corporate_enquiries ADD COLUMN deposit_method TEXT;
ALTER TABLE corporate_enquiries ADD COLUMN deposit_note TEXT;
ALTER TABLE corporate_enquiries ADD COLUMN status_updated_at TEXT;
