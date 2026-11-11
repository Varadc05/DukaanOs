-- Demo data. Run AFTER creating two users in Supabase Auth (Authentication > Users),
-- then replace the two UUIDs below with their ids.
--   :owner_id   = the shop owner's auth user id
--   :cashier_id = the cashier's auth user id
-- In the SQL editor, find-and-replace OWNER_ID and CASHIER_ID before running.

insert into stores (id, name, owner_id)
values ('11111111-1111-4111-8111-111111111111', 'Sri Lakshmi Kirana', 'OWNER_ID');

insert into members (store_id, user_id, role) values
  ('11111111-1111-4111-8111-111111111111', 'OWNER_ID', 'owner'),
  ('11111111-1111-4111-8111-111111111111', 'CASHIER_ID', 'cashier');

insert into products (id, store_id, name, barcode, unit, mrp_paise, sell_paise, gst_rate) values
  ('a0000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Sugar', null, 'kg', 4800, 4500, 5),
  ('a0000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Fortune Sunflower Oil 1L', '8906007000019', 'pc', 17000, 15500, 5),
  ('a0000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'Maggi Noodles 70g', '8901058000290', 'pack', 1400, 1400, 12),
  ('a0000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', 'Toor Dal', null, 'kg', 17500, 16500, 0),
  ('a0000000-0000-4000-8000-000000000005', '11111111-1111-4111-8111-111111111111', 'Tata Salt 1kg', '8904043901015', 'pc', 2800, 2800, 0),
  ('a0000000-0000-4000-8000-000000000006', '11111111-1111-4111-8111-111111111111', 'Basmati Rice', null, 'kg', 11000, 10200, 5);

insert into product_aliases (store_id, product_id, alias, lang) values
  ('11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-000000000001', 'chini', 'hi'),
  ('11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-000000000001', 'शक्कर', 'hi'),
  ('11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-000000000002', 'sunflower oil', 'en'),
  ('11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-000000000002', 'tel', 'hi'),
  ('11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-000000000004', 'dal', 'hi'),
  ('11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-000000000006', 'chawal', 'hi');

-- Opening stock: one batch per product, received into the ledger.
insert into batches (id, store_id, product_id, expiry_date, cost_paise, qty_received_milli)
select gen_random_uuid(), store_id, id, current_date + 120, (sell_paise * 85 / 100), 20000
from products where store_id = '11111111-1111-4111-8111-111111111111';

insert into stock_movements (store_id, product_id, batch_id, qty_delta_milli, reason)
select b.store_id, b.product_id, b.id, b.qty_received_milli, 'purchase' from batches b
where b.store_id = '11111111-1111-4111-8111-111111111111';

insert into customers (id, store_id, name, phone, credit_limit_paise)
values ('c0000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Ramesh', null, 200000);
