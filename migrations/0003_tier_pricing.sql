-- Real tier pricing confirmed by Jordan, replacing the £0 placeholders
-- from 0001_init.sql. Names kept simple and duration-led since that's
-- what a customer's actually choosing between at the seat.

UPDATE settings SET value = '15 Minutes' WHERE key = 'tier_1_name';
UPDATE settings SET value = '15' WHERE key = 'tier_1_minutes';
UPDATE settings SET value = '500' WHERE key = 'tier_1_price_pence';

UPDATE settings SET value = '30 Minutes' WHERE key = 'tier_2_name';
UPDATE settings SET value = '30' WHERE key = 'tier_2_minutes';
UPDATE settings SET value = '1000' WHERE key = 'tier_2_price_pence';

UPDATE settings SET value = '60 Minutes' WHERE key = 'tier_3_name';
UPDATE settings SET value = '60' WHERE key = 'tier_3_minutes';
UPDATE settings SET value = '1500' WHERE key = 'tier_3_price_pence';
