-- Targeted campaign sends.
--
-- Lets the owner pick a party-type segment (single/couple/family/group,
-- from mailing_list.tags) and send a one-off email to everyone in it.
-- campaign_sends logs every individual send so the dashboard can show a
-- daily count against Resend's free-tier cap (100/day) and so the same
-- person never gets double-billed against that cap if a send is retried.

ALTER TABLE campaigns ADD COLUMN segment_tag TEXT;
ALTER TABLE campaigns ADD COLUMN subject TEXT;
ALTER TABLE campaigns ADD COLUMN body_html TEXT;
ALTER TABLE campaigns ADD COLUMN sent_count INTEGER NOT NULL DEFAULT 0;

CREATE TABLE campaign_sends (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id),
  email TEXT NOT NULL,
  sent_at TEXT NOT NULL DEFAULT (datetime('now'))
);
