-- The 'confirmed' status on corporate_enquiries gets set the moment staff
-- send a Square deposit payment link, not once the customer actually pays
-- it (see functions/api/corporate/[id]/confirm.js). The dashboard showed
-- "Square link sent" for every confirmed enquiry regardless of whether
-- the deposit had landed, so staff had no way to tell an actually-secured
-- event apart from one still waiting on payment. This column gets set to
-- 1 by the Square webhook once the deposit payment completes (see
-- functions/api/payments/square-webhook.js).

ALTER TABLE corporate_enquiries ADD COLUMN deposit_paid INTEGER NOT NULL DEFAULT 0;
