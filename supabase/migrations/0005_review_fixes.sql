-- 1. Nicknames: only the owner may add them, and only for a product in the same store.
--    (Before, any cashier could insert an alias pointing at another store's product id.)
drop policy if exists aliases_write on product_aliases;
create policy aliases_write on product_aliases for insert
  with check (is_owner(store_id)
              and exists (select 1 from products p where p.id = product_id and p.store_id = product_aliases.store_id));
create policy aliases_delete on product_aliases for delete using (is_owner(store_id));

-- 2. Reports use the time the sale happened, not the time the phone got signal.
--    A bill rung up offline yesterday and synced this morning belongs to yesterday.
--    device_time is trusted only if it is within 7 days before the server time; a phone with a
--    wrong clock falls back to the server time.
create or replace function bill_effective_time(device_time timestamptz, server_time timestamptz)
returns timestamptz language sql immutable as $$
  select case when device_time between server_time - interval '7 days' and server_time
              then device_time else server_time end $$;

create or replace view daily_sales as
select b.store_id, i.product_id,
       (bill_effective_time(b.device_time, b.server_time) at time zone 'Asia/Kolkata')::date as day,
       sum(i.qty_milli)::bigint as qty_milli
from bills b
join bill_items i on i.bill_id = b.id
group by b.store_id, i.product_id, (bill_effective_time(b.device_time, b.server_time) at time zone 'Asia/Kolkata')::date;

create or replace view daily_bill_totals as
select store_id,
       (bill_effective_time(device_time, server_time) at time zone 'Asia/Kolkata')::date as day,
       sum(total_paise)::bigint as total_paise,
       count(*)::int as bills
from bills
group by store_id, (bill_effective_time(device_time, server_time) at time zone 'Asia/Kolkata')::date;

revoke all on function bill_effective_time(timestamptz, timestamptz) from public;
grant execute on function bill_effective_time(timestamptz, timestamptz) to service_role;
