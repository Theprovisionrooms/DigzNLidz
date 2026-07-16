-- Digz N' Lidz initial schema
-- Sidedoor Digital

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- seeded on first deploy: tier names, tier lengths, tier prices, extension price
INSERT INTO settings (key, value) VALUES
  ('tier_1_name', 'Tier 1'),
  ('tier_1_minutes', '15'),
  ('tier_1_price_pence', '0'),
  ('tier_2_name', 'Tier 2'),
  ('tier_2_minutes', '30'),
  ('tier_2_price_pence', '0'),
  ('tier_3_name', 'Tier 3'),
  ('tier_3_minutes', '60'),
  ('tier_3_price_pence', '0'),
  ('extension_minutes', '15'),
  ('extension_price_pence', '500');

CREATE TABLE seats (
  id INTEGER PRIMARY KEY,          -- 1 to 16
  status TEXT NOT NULL DEFAULT 'free',  -- free, active, awaiting_extension
  current_session_id INTEGER
);

CREATE TABLE sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  seat_id INTEGER NOT NULL REFERENCES seats(id),
  tier TEXT NOT NULL,               -- tier_1, tier_2, tier_3
  started_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  extensions_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active'  -- active, expired, ended
);

CREATE TABLE bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,               -- family, group, corporate
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  party_size INTEGER,
  booking_date TEXT NOT NULL,
  slot_time TEXT NOT NULL,
  deposit_status TEXT NOT NULL DEFAULT 'unpaid',  -- unpaid, paid, waived
  deposit_amount_pence INTEGER,
  square_payment_id TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE corporate_enquiries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_name TEXT,
  contact_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  event_date TEXT,
  headcount INTEGER,
  event_details TEXT,
  status TEXT NOT NULL DEFAULT 'new',  -- new, confirmed, declined
  payment_link_sent INTEGER NOT NULL DEFAULT 0,
  square_payment_link TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  seat_id INTEGER,
  session_id INTEGER,
  items_json TEXT NOT NULL,
  total_pence INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'placed',  -- placed, preparing, delivered
  square_order_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE mailing_list (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  source TEXT,                      -- booking, qr_order, manual
  tags TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT,                        -- winback, welcome, promo
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE discount_codes (
  code TEXT PRIMARY KEY,
  campaign_id INTEGER REFERENCES campaigns(id),
  discount_type TEXT NOT NULL,      -- percent, fixed
  discount_value INTEGER NOT NULL,
  expiry TEXT,
  usage_limit INTEGER,
  uses INTEGER NOT NULL DEFAULT 0
);

-- seed 16 seats
INSERT INTO seats (id, status) VALUES
  (1,'free'),(2,'free'),(3,'free'),(4,'free'),(5,'free'),(6,'free'),(7,'free'),(8,'free'),
  (9,'free'),(10,'free'),(11,'free'),(12,'free'),(13,'free'),(14,'free'),(15,'free'),(16,'free');
