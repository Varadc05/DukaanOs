-- DukaanOS core schema. Money is integer paise. Quantities are integer thousandths
-- (qty_milli: 1000 = 1 unit / 1 kg / 1 litre) so loose items are exact.
-- Stock is never stored; it is the sum of stock_movements.

create extension if not exists pgcrypto;

-- ---------- tenancy and roles ----------
create table stores (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  gstin text,
  owner_id uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create type member_role as enum ('owner', 'cashier');

create table members (
  store_id uuid not null references stores(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role member_role not null,
  primary key (store_id, user_id)
);

-- Helpers used by every policy. security definer so RLS on members cannot recurse.
create or replace function is_member(sid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members m where m.store_id = sid and m.user_id = auth.uid());
$$;

create or replace function is_owner(sid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members m
                 where m.store_id = sid and m.user_id = auth.uid() and m.role = 'owner');
$$;

-- ---------- catalogue ----------
create table products (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  name text not null,
  barcode text,
  unit text not null default 'pc' check (unit in ('pc','kg','g','l','ml','pack')),
  pack_size_milli integer not null default 1000 check (pack_size_milli > 0),
  gst_rate smallint not null default 0 check (gst_rate in (0,5,12,18,28)),
  mrp_paise integer not null check (mrp_paise >= 0),
  sell_paise integer not null check (sell_paise >= 0),
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (store_id, barcode)
);
create index products_store_name on products (store_id, lower(name));

create table product_aliases (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  alias text not null,
  lang text not null default 'en',
  unique (store_id, alias)
);

create table batches (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  expiry_date date,
  cost_paise integer not null default 0 check (cost_paise >= 0),
  qty_received_milli integer not null check (qty_received_milli > 0),
  received_at timestamptz not null default now()
);
create index batches_fefo on batches (product_id, expiry_date nulls last, received_at);

-- ---------- customers and khata ----------
create table customers (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  name text not null,
  phone text,
  credit_limit_paise integer not null default 0 check (credit_limit_paise >= 0)
);

-- ---------- bills (immutable after insert) ----------
create type payment_mode as enum ('cash', 'upi', 'credit');

create table bills (
  id uuid primary key,                      -- client-generated UUID: idempotency key
  store_id uuid not null references stores(id) on delete cascade,
  cashier_id uuid not null references auth.users(id),
  customer_id uuid references customers(id),
  subtotal_paise integer not null,
  discount_paise integer not null default 0 check (discount_paise >= 0),
  tax_paise integer not null,
  total_paise integer not null check (total_paise >= 0),
  payment_mode payment_mode not null,
  device_time timestamptz not null,
  server_time timestamptz not null default now(),
  voided_by uuid references bills(id)       -- set on a reversal bill, never edit the original
);
create index bills_store_time on bills (store_id, server_time desc);

create table bill_items (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references bills(id) on delete cascade,
  store_id uuid not null references stores(id) on delete cascade,
  product_id uuid not null references products(id),
  qty_milli integer not null check (qty_milli > 0),
  price_paise integer not null check (price_paise >= 0),
  line_total_paise integer not null check (line_total_paise >= 0),
  gst_rate smallint not null
);

-- ---------- stock ledger (append-only) ----------
create type movement_reason as enum ('sale','purchase','return','damage','expired','adjust');

create table stock_movements (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  product_id uuid not null references products(id),
  batch_id uuid references batches(id),
  qty_delta_milli integer not null check (qty_delta_milli <> 0),
  reason movement_reason not null,
  ref_id uuid,                              -- bill id or purchase order id
  created_at timestamptz not null default now()
);
create index movements_product on stock_movements (store_id, product_id);

create view stock_levels with (security_invoker = true) as
  select store_id, product_id, sum(qty_delta_milli)::bigint as qty_milli
  from stock_movements group by store_id, product_id;

-- Ledger and bills are append-only: block UPDATE and DELETE for everyone.
create or replace function forbid_mutation() returns trigger language plpgsql as $$
begin raise exception '% is append-only', tg_table_name; end $$;

create trigger bills_append_only before update or delete on bills
  for each row execute function forbid_mutation();
create trigger bill_items_append_only before update or delete on bill_items
  for each row execute function forbid_mutation();
create trigger movements_append_only before update or delete on stock_movements
  for each row execute function forbid_mutation();

-- ---------- khata ----------
create table khata_entries (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  amount_paise integer not null check (amount_paise > 0),
  kind text not null check (kind in ('credit','payment')),
  bill_id uuid references bills(id),
  created_at timestamptz not null default now()
);

-- ---------- procurement ----------
create table suppliers (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  name text not null,
  phone text
);

create table supplier_prices (
  supplier_id uuid not null references suppliers(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  store_id uuid not null references stores(id) on delete cascade,
  price_paise integer not null check (price_paise >= 0),
  updated_at timestamptz not null default now(),
  primary key (supplier_id, product_id)
);

create type po_status as enum ('draft','approved','sent','received');

create table purchase_orders (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  supplier_id uuid references suppliers(id),
  status po_status not null default 'draft',
  budget_paise integer not null default 0,
  created_at timestamptz not null default now(),
  approved_by uuid references auth.users(id)
);

create table po_items (
  po_id uuid not null references purchase_orders(id) on delete cascade,
  store_id uuid not null references stores(id) on delete cascade,
  product_id uuid not null references products(id),
  qty_milli integer not null check (qty_milli > 0),
  price_paise integer not null check (price_paise >= 0),
  primary key (po_id, product_id)
);

-- Enforce the approval state machine in the database, not the app.
create or replace function po_state_guard() returns trigger language plpgsql as $$
begin
  if old.status = new.status then return new; end if;
  if (old.status, new.status) not in
     (('draft','approved'),('approved','sent'),('sent','received')) then
    raise exception 'illegal purchase order transition % -> %', old.status, new.status;
  end if;
  if new.status = 'approved' and not is_owner(new.store_id) then
    raise exception 'only the owner can approve an order';
  end if;
  return new;
end $$;
create trigger po_state before update on purchase_orders
  for each row execute function po_state_guard();

create table forecasts (
  store_id uuid not null references stores(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  forecast_date date not null,
  predicted_qty_milli integer not null,
  confidence text not null check (confidence in ('low','medium','high')),
  reason text not null,
  primary key (product_id, forecast_date)
);

create table audit_log (
  id bigserial primary key,
  store_id uuid not null,
  user_id uuid,
  action text not null,
  entity text not null,
  entity_id text,
  at timestamptz not null default now()
);

-- ---------- row-level security ----------
do $$
declare t text;
begin
  foreach t in array array['stores','members','products','product_aliases','batches',
    'customers','bills','bill_items','stock_movements','khata_entries','suppliers',
    'supplier_prices','purchase_orders','po_items','forecasts','audit_log']
  loop execute format('alter table %I enable row level security', t); end loop;
end $$;

create policy stores_read on stores for select using (is_member(id));
create policy members_read on members for select using (is_member(store_id));

-- Catalogue: every member reads; only the owner changes prices and products.
create policy products_read on products for select using (is_member(store_id));
create policy products_write on products for all using (is_owner(store_id)) with check (is_owner(store_id));
create policy aliases_read on product_aliases for select using (is_member(store_id));
create policy aliases_write on product_aliases for insert with check (is_member(store_id));

-- Batches expose cost: owner only. Cashiers never see cost or profit.
create policy batches_owner on batches for all using (is_owner(store_id)) with check (is_owner(store_id));

create policy customers_read on customers for select using (is_member(store_id));
create policy customers_write on customers for insert with check (is_member(store_id));

-- Bills: members read their store; writes only through checkout_bill() (security definer).
create policy bills_read on bills for select using (is_member(store_id));
create policy bill_items_read on bill_items for select using (is_member(store_id));
create policy movements_read on stock_movements for select using (is_member(store_id));

-- Money views and procurement are owner only.
create policy khata_owner on khata_entries for all using (is_owner(store_id)) with check (is_owner(store_id));
create policy suppliers_owner on suppliers for all using (is_owner(store_id)) with check (is_owner(store_id));
create policy supplier_prices_owner on supplier_prices for all using (is_owner(store_id)) with check (is_owner(store_id));
create policy po_owner on purchase_orders for all using (is_owner(store_id)) with check (is_owner(store_id));
create policy po_items_owner on po_items for all using (is_owner(store_id)) with check (is_owner(store_id));
create policy forecasts_read on forecasts for select using (is_member(store_id));
create policy audit_owner on audit_log for select using (is_owner(store_id));

-- ---------- atomic, idempotent checkout ----------
-- The Node API computes and validates; this function applies the result in one transaction.
-- A repeated bill id returns the stored bill and writes nothing (offline retry safe).
create or replace function checkout_bill(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_bill uuid := (p->>'id')::uuid;
  v_store uuid := (p->>'store_id')::uuid;
  v_user uuid := (p->>'cashier_id')::uuid;
  v_item jsonb;
  v_alloc jsonb;
begin
  if not exists (select 1 from members where store_id = v_store and user_id = v_user) then
    raise exception 'not a member of this store';
  end if;

  if exists (select 1 from bills where id = v_bill) then
    return jsonb_build_object('id', v_bill, 'duplicate', true);
  end if;

  insert into bills (id, store_id, cashier_id, customer_id, subtotal_paise, discount_paise,
                     tax_paise, total_paise, payment_mode, device_time)
  values (v_bill, v_store, v_user, nullif(p->>'customer_id','')::uuid,
          (p->>'subtotal_paise')::int, (p->>'discount_paise')::int, (p->>'tax_paise')::int,
          (p->>'total_paise')::int, (p->>'payment_mode')::payment_mode,
          (p->>'device_time')::timestamptz);

  for v_item in select * from jsonb_array_elements(p->'items') loop
    insert into bill_items (bill_id, store_id, product_id, qty_milli, price_paise,
                            line_total_paise, gst_rate)
    values (v_bill, v_store, (v_item->>'product_id')::uuid, (v_item->>'qty_milli')::int,
            (v_item->>'price_paise')::int, (v_item->>'line_total_paise')::int,
            (v_item->>'gst_rate')::smallint);
  end loop;

  for v_alloc in select * from jsonb_array_elements(p->'movements') loop
    insert into stock_movements (store_id, product_id, batch_id, qty_delta_milli, reason, ref_id)
    values (v_store, (v_alloc->>'product_id')::uuid, nullif(v_alloc->>'batch_id','')::uuid,
            (v_alloc->>'qty_delta_milli')::int, 'sale', v_bill);
  end loop;

  if (p->>'payment_mode') = 'credit' and nullif(p->>'customer_id','') is not null then
    insert into khata_entries (store_id, customer_id, amount_paise, kind, bill_id)
    values (v_store, (p->>'customer_id')::uuid, (p->>'total_paise')::int, 'credit', v_bill);
  end if;

  return jsonb_build_object('id', v_bill, 'duplicate', false);
end $$;

revoke all on function checkout_bill(jsonb) from public, anon, authenticated;
-- Only the backend (service role) may call checkout_bill.
grant execute on function checkout_bill(jsonb) to service_role;
