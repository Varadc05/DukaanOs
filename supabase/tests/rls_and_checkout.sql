-- Behavioural tests for the schema. Run against a scratch database that has Supabase's
-- auth schema (or the stub in supabase/tests/stub_auth.sql). Any failed assert aborts the run.
-- Usage: psql -v ON_ERROR_STOP=1 -f supabase/tests/rls_and_checkout.sql


-- fixtures (as superuser)
insert into auth.users (id) values
  ('a0000000-0000-4000-8000-000000000001'),  -- owner, store 1
  ('b0000000-0000-4000-8000-000000000002'),  -- cashier, store 1
  ('c0000000-0000-4000-8000-000000000003');  -- owner, store 2
insert into stores (id, name, owner_id) values
  ('11111111-0000-4000-8000-000000000001', 'Store One', 'a0000000-0000-4000-8000-000000000001'),
  ('22222222-0000-4000-8000-000000000002', 'Store Two', 'c0000000-0000-4000-8000-000000000003');
insert into members values
  ('11111111-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'owner'),
  ('11111111-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000002', 'cashier'),
  ('22222222-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000003', 'owner');
insert into products (id, store_id, name, unit, mrp_paise, sell_paise, gst_rate) values
  ('aaaa0001-0000-4000-8000-000000000001', '11111111-0000-4000-8000-000000000001', 'Sugar', 'kg', 4800, 4500, 5),
  ('aaaa0002-0000-4000-8000-000000000002', '22222222-0000-4000-8000-000000000002', 'Rice', 'kg', 6000, 5500, 5);
insert into batches (id, store_id, product_id, expiry_date, cost_paise, qty_received_milli) values
  ('bbbb0001-0000-4000-8000-000000000001', '11111111-0000-4000-8000-000000000001',
   'aaaa0001-0000-4000-8000-000000000001', '2099-01-01', 4000, 10000);
insert into stock_movements (store_id, product_id, batch_id, qty_delta_milli, reason) values
  ('11111111-0000-4000-8000-000000000001', 'aaaa0001-0000-4000-8000-000000000001',
   'bbbb0001-0000-4000-8000-000000000001', 10000, 'purchase');
insert into customers (id, store_id, name) values
  ('dddd0001-0000-4000-8000-000000000001', '11111111-0000-4000-8000-000000000001', 'Ramesh');

-- 1. cashier: sees own store catalogue only, no cost data, no khata, cannot edit products
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-000000000002', true);
do $$ begin
  assert (select count(*) from products) = 1, 'cashier should see exactly 1 product (own store)';
  assert (select count(*) from batches) = 0, 'cashier must not see batches (cost data)';
  assert (select count(*) from khata_entries) = 0, 'cashier must not see khata';
  assert (select count(*) from stores) = 1, 'cashier sees only own store';
end $$;
do $$ begin
  begin
    insert into products (store_id, name, mrp_paise, sell_paise)
      values ('11111111-0000-4000-8000-000000000001', 'Hacked', 1, 1);
    raise exception 'cashier insert into products should have been blocked';
  exception when insufficient_privilege or check_violation then null; -- expected: RLS blocks it
  end;
end $$;
rollback;

-- 2. owner of another store sees nothing of store 1
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-000000000003', true);
do $$ begin
  assert (select count(*) from products where store_id = '11111111-0000-4000-8000-000000000001') = 0,
    'cross-store product leak';
  assert (select count(*) from stock_movements) = 0, 'cross-store ledger leak';
  assert (select count(*) from products) = 1, 'store 2 owner should see only store 2 products';
end $$;
rollback;

-- 3. the app cannot call checkout_bill directly; only the service role can
begin;
set local role authenticated;
do $$ begin
  begin
    perform checkout_bill('{}'::jsonb);
    raise exception 'authenticated users must not execute checkout_bill';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback;

-- 4. checkout is atomic and idempotent
set role service_role;
select checkout_bill('{
  "id":"eeee0001-0000-4000-8000-000000000001",
  "store_id":"11111111-0000-4000-8000-000000000001",
  "cashier_id":"b0000000-0000-4000-8000-000000000002",
  "customer_id":"dddd0001-0000-4000-8000-000000000001",
  "subtotal_paise":9000,"discount_paise":0,"tax_paise":429,"total_paise":9000,
  "payment_mode":"credit","device_time":"2026-11-09T10:00:00Z",
  "items":[{"product_id":"aaaa0001-0000-4000-8000-000000000001","qty_milli":2000,
            "price_paise":4500,"line_total_paise":9000,"gst_rate":5}],
  "movements":[{"product_id":"aaaa0001-0000-4000-8000-000000000001",
                "batch_id":"bbbb0001-0000-4000-8000-000000000001","qty_delta_milli":-2000}]
}'::jsonb) as first_call \gset
select checkout_bill('{
  "id":"eeee0001-0000-4000-8000-000000000001",
  "store_id":"11111111-0000-4000-8000-000000000001",
  "cashier_id":"b0000000-0000-4000-8000-000000000002",
  "subtotal_paise":9000,"discount_paise":0,"tax_paise":429,"total_paise":9000,
  "payment_mode":"cash","device_time":"2026-11-09T10:00:00Z","items":[],"movements":[]
}'::jsonb) as retry \gset
reset role;
do $$ begin
  assert (select count(*) from bills) = 1, 'retry must not create a second bill';
  assert (select count(*) from stock_movements where reason = 'sale') = 1, 'retry must not double-deduct stock';
  assert (select count(*) from khata_entries where kind = 'credit' and amount_paise = 9000) = 1,
    'credit sale must create exactly one khata entry';
  assert (select qty_milli from stock_levels
          where product_id = 'aaaa0001-0000-4000-8000-000000000001') = 8000, 'stock should be 10 kg - 2 kg';
  assert (select remaining_milli from batch_levels
          where batch_id = 'bbbb0001-0000-4000-8000-000000000001') = 8000, 'batch remaining should be 8 kg';
end $$;
select :'retry'::jsonb ->> 'duplicate' as retry_flagged_duplicate;

-- a non-member cannot be used as cashier
do $$ begin
  begin
    perform checkout_bill('{"id":"eeee0002-0000-4000-8000-000000000002",
      "store_id":"11111111-0000-4000-8000-000000000001",
      "cashier_id":"c0000000-0000-4000-8000-000000000003"}'::jsonb);
    raise exception 'non-member checkout should be rejected';
  exception when raise_exception then
    assert sqlerrm = 'not a member of this store', 'wrong error: ' || sqlerrm;
  end;
end $$;

-- 5. bills and the ledger are append-only
do $$ begin
  begin update bills set total_paise = 1; raise exception 'bill update should be blocked';
  exception when raise_exception then assert sqlerrm = 'bills is append-only', sqlerrm; end;
  begin delete from stock_movements; raise exception 'ledger delete should be blocked';
  exception when raise_exception then assert sqlerrm = 'stock_movements is append-only', sqlerrm; end;
  begin delete from bill_items; raise exception 'bill_items delete should be blocked';
  exception when raise_exception then assert sqlerrm = 'bill_items is append-only', sqlerrm; end;
end $$;

-- 6. purchase order state machine, enforced in the database
insert into purchase_orders (id, store_id) values
  ('ffff0001-0000-4000-8000-000000000001', '11111111-0000-4000-8000-000000000001');

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-000000000002', true);
do $$ begin
  update purchase_orders set status = 'approved';
  assert (select count(*) from purchase_orders) = 0, 'cashier must not even see purchase orders';
end $$;
rollback;
do $$ begin
  assert (select status from purchase_orders) = 'draft', 'cashier must not be able to approve';
end $$;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000001', true);
do $$ begin
  begin update purchase_orders set status = 'sent'; raise exception 'draft->sent must be illegal';
  exception when raise_exception then
    assert sqlerrm like 'illegal purchase order transition%', sqlerrm; end;
  update purchase_orders set status = 'approved';
  assert (select status from purchase_orders) = 'approved', 'owner can approve a draft';
  begin update purchase_orders set status = 'draft'; raise exception 'approved->draft must be illegal';
  exception when raise_exception then
    assert sqlerrm like 'illegal purchase order transition%', sqlerrm; end;
end $$;
commit;

-- 7. analytics views (read by the backend only)
do $$ declare r record; begin
  select * into r from inventory_snapshot where product_id = 'aaaa0001-0000-4000-8000-000000000001';
  assert r.qty_milli = 8000, 'snapshot qty should be 8 kg, got ' || r.qty_milli;
  assert r.value_paise = 32000, 'cash tied up should be 8 kg x 40.00 = 32000, got ' || r.value_paise;
  assert r.last_sale_at is not null, 'last sale should be set';
  assert r.nearest_expiry = date '2099-01-01', 'nearest expiry';
  assert r.nearest_expiry_qty_milli = 8000, 'qty expiring at nearest date';
  assert r.last_cost_paise = 4000, 'last cost';
  assert r.stocked_at is not null, 'stocked_at';

  assert (select qty_milli from daily_sales
          where product_id = 'aaaa0001-0000-4000-8000-000000000001') = 2000, 'daily sales qty';
  assert (select total_paise from daily_bill_totals
          where store_id = '11111111-0000-4000-8000-000000000001') = 9000, 'daily total';
  assert (select bills from daily_bill_totals
          where store_id = '11111111-0000-4000-8000-000000000001') = 1, 'daily bill count';
  -- a product with no batches and no sales still appears, with zero stock
  insert into products (id, store_id, name, unit, mrp_paise, sell_paise)
    values ('aaaa0003-0000-4000-8000-000000000003', '11111111-0000-4000-8000-000000000001', 'Empty', 'pc', 100, 100);
  select * into r from inventory_snapshot where product_id = 'aaaa0003-0000-4000-8000-000000000003';
  assert r.qty_milli = 0 and r.value_paise = 0 and r.last_sale_at is null, 'empty product row';
end $$;

-- the app roles must not be able to read cost and profit views
begin;
set local role authenticated;
do $$ begin
  begin perform 1 from inventory_snapshot; raise exception 'authenticated must not read inventory_snapshot';
  exception when insufficient_privilege then null; end;
  begin perform 1 from daily_sales; raise exception 'authenticated must not read daily_sales';
  exception when insufficient_privilege then null; end;
end $$;
rollback;

select 'ALL SQL TESTS PASSED' as result;
