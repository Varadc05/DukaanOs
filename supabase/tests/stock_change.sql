-- Tests for apply_stock_change(). Run after rls_and_checkout.sql (re-uses its fixtures).
-- Usage: psql -v ON_ERROR_STOP=1 -f supabase/tests/stock_change.sql

do $$
declare
  s1 uuid := '11111111-0000-4000-8000-000000000001';
  owner1 uuid := 'a0000000-0000-4000-8000-000000000001';
  cashier1 uuid := 'b0000000-0000-4000-8000-000000000002';
  sugar uuid := 'aaaa0001-0000-4000-8000-000000000001';
  rice2 uuid := 'aaaa0002-0000-4000-8000-000000000002';
  id1 uuid := 'f0000001-0000-4000-8000-000000000001';
  id2 uuid := 'f0000002-0000-4000-8000-000000000002';
  r jsonb; n int; before_qty bigint; remaining int;
begin
  select qty_milli into before_qty from stock_levels where store_id = s1 and product_id = sugar;

  -- 1. receiving creates a batch and a +qty ledger row, together
  r := apply_stock_change(jsonb_build_object(
    'id', id1, 'store_id', s1, 'user_id', owner1,
    'batch', jsonb_build_object('product_id', sugar, 'expiry_date', '2099-06-01', 'cost_paise', 3900, 'qty_received_milli', 5000),
    'movements', jsonb_build_array(jsonb_build_object('product_id', sugar, 'batch_id', id1, 'qty_delta_milli', 5000, 'reason', 'purchase'))));
  assert (r->>'duplicate')::boolean = false, 'first receive is not a duplicate';
  select remaining_milli into remaining from batch_levels where batch_id = id1;
  assert remaining = 5000, 'new batch has 5000 remaining, got ' || coalesce(remaining::text, 'null');
  assert (select qty_milli from stock_levels where store_id = s1 and product_id = sugar) = before_qty + 5000, 'stock rose by 5000';

  -- 2. replaying the same id writes nothing
  r := apply_stock_change(jsonb_build_object(
    'id', id1, 'store_id', s1, 'user_id', owner1,
    'batch', jsonb_build_object('product_id', sugar, 'expiry_date', '2099-06-01', 'cost_paise', 3900, 'qty_received_milli', 5000),
    'movements', jsonb_build_array(jsonb_build_object('product_id', sugar, 'batch_id', id1, 'qty_delta_milli', 5000, 'reason', 'purchase'))));
  assert (r->>'duplicate')::boolean = true, 'replay is a duplicate';
  assert (select count(*) from batches where id = id1) = 1, 'still one batch';
  assert (select qty_milli from stock_levels where store_id = s1 and product_id = sugar) = before_qty + 5000, 'stock unchanged by replay';

  -- 3. an adjustment draws the batch down and keeps the reason
  r := apply_stock_change(jsonb_build_object(
    'id', id2, 'store_id', s1, 'user_id', owner1, 'batch', null,
    'movements', jsonb_build_array(jsonb_build_object('product_id', sugar, 'batch_id', id1, 'qty_delta_milli', -1200, 'reason', 'damage'))));
  select remaining_milli into remaining from batch_levels where batch_id = id1;
  assert remaining = 3800, 'batch down to 3800, got ' || remaining;
  assert (select reason from stock_movements where ref_id = id2) = 'damage', 'reason stored';

  -- 4. a cashier may not change stock
  begin
    perform apply_stock_change(jsonb_build_object('id', gen_random_uuid(), 'store_id', s1, 'user_id', cashier1, 'batch', null,
      'movements', jsonb_build_array(jsonb_build_object('product_id', sugar, 'batch_id', null, 'qty_delta_milli', 1, 'reason', 'adjust'))));
    raise exception 'cashier was allowed';
  exception when others then
    assert sqlerrm like '%only the owner%', 'cashier rejected for the right reason: ' || sqlerrm;
  end;

  -- 5. a product from another store is refused, and nothing is left half-written
  select count(*) into n from batches;
  begin
    perform apply_stock_change(jsonb_build_object('id', gen_random_uuid(), 'store_id', s1, 'user_id', owner1,
      'batch', jsonb_build_object('product_id', rice2, 'expiry_date', null, 'cost_paise', 1, 'qty_received_milli', 1),
      'movements', '[]'::jsonb));
    raise exception 'cross-store product was allowed';
  exception when others then
    assert sqlerrm like '%not in this store%', 'cross-store rejected: ' || sqlerrm;
  end;
  assert (select count(*) from batches) = n, 'no batch written';

  -- 6. an unknown reason or a zero delta fails and rolls back the whole call
  begin
    perform apply_stock_change(jsonb_build_object('id', gen_random_uuid(), 'store_id', s1, 'user_id', owner1, 'batch', null,
      'movements', jsonb_build_array(jsonb_build_object('product_id', sugar, 'batch_id', null, 'qty_delta_milli', -1, 'reason', 'gift'))));
    raise exception 'bad reason was allowed';
  exception when others then
    assert sqlerrm like '%gift%', 'bad reason rejected: ' || sqlerrm;
  end;
end $$;

-- 7. the API roles cannot call it directly
set role authenticated;
do $$ begin
  perform apply_stock_change('{}'::jsonb);
  raise exception 'authenticated could call apply_stock_change';
exception when insufficient_privilege then null; end $$;
reset role;
set role anon;
do $$ begin
  perform apply_stock_change('{}'::jsonb);
  raise exception 'anon could call apply_stock_change';
exception when insufficient_privilege then null; end $$;
reset role;

\echo STOCK CHANGE SQL TESTS PASSED

-- ---------- 0005: review fixes ----------
do $$
declare
  s1 uuid := '11111111-0000-4000-8000-000000000001';
  cashier1 uuid := 'b0000000-0000-4000-8000-000000000002';
  owner1 uuid := 'a0000000-0000-4000-8000-000000000001';
  sugar uuid := 'aaaa0001-0000-4000-8000-000000000001';
  rice2 uuid := 'aaaa0002-0000-4000-8000-000000000002';
begin
  -- offline bill: rung up 2 days ago, synced now -> counted on the day it happened
  insert into bills (id, store_id, cashier_id, subtotal_paise, discount_paise, tax_paise, total_paise, payment_mode, device_time, server_time)
  values ('f1000000-0000-4000-8000-000000000001', s1, owner1, 100, 0, 0, 100, 'cash', now() - interval '2 days', now());
  assert exists (select 1 from daily_bill_totals where store_id = s1
                 and day = ((now() - interval '2 days') at time zone 'Asia/Kolkata')::date), 'offline bill counted on its own day';

  -- wrong phone clock (a year ago) -> falls back to the server day
  insert into bills (id, store_id, cashier_id, subtotal_paise, discount_paise, tax_paise, total_paise, payment_mode, device_time, server_time)
  values ('f1000000-0000-4000-8000-000000000002', s1, owner1, 100, 0, 0, 100, 'cash', now() - interval '400 days', now());
  assert not exists (select 1 from daily_bill_totals where store_id = s1
                 and day = ((now() - interval '400 days') at time zone 'Asia/Kolkata')::date), 'bad clock not trusted';
end $$;

-- a cashier cannot add nicknames at all
set role authenticated;
select set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-000000000002', false);
do $$ begin
  insert into product_aliases (store_id, product_id, alias)
  values ('11111111-0000-4000-8000-000000000001', 'aaaa0001-0000-4000-8000-000000000001', 'cashier-alias');
  raise exception 'cashier inserted an alias';
exception when insufficient_privilege or others then
  if sqlerrm like 'cashier inserted%' then raise; end if;
end $$;
-- the owner cannot point a nickname at another store's product
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000001', false);
do $$ begin
  insert into product_aliases (store_id, product_id, alias)
  values ('11111111-0000-4000-8000-000000000001', 'aaaa0002-0000-4000-8000-000000000002', 'sneaky');
  raise exception 'cross-store alias allowed';
exception when others then
  if sqlerrm like 'cross-store%' then raise; end if;
end $$;
-- but can for their own
insert into product_aliases (store_id, product_id, alias)
values ('11111111-0000-4000-8000-000000000001', 'aaaa0001-0000-4000-8000-000000000001', 'owner-alias');
reset role;

\echo REVIEW FIX SQL TESTS PASSED
