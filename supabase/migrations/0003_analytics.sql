-- Read-only analytics views for the dashboard, alerts, forecasting and reorder suggestions.
-- They expose cost and profit data, so only the backend (service role) may read them;
-- the API decides who may see what.

-- Quantity sold per product per day (India time).
create view daily_sales as
select b.store_id, i.product_id,
       (b.server_time at time zone 'Asia/Kolkata')::date as day,
       sum(i.qty_milli)::bigint as qty_milli
from bills b
join bill_items i on i.bill_id = b.id
group by b.store_id, i.product_id, (b.server_time at time zone 'Asia/Kolkata')::date;

-- Money taken per day.
create view daily_bill_totals as
select store_id,
       (server_time at time zone 'Asia/Kolkata')::date as day,
       sum(total_paise)::bigint as total_paise,
       count(*)::int as bills
from bills
group by store_id, (server_time at time zone 'Asia/Kolkata')::date;

-- One row per active product: stock, cash tied up, last sale, nearest expiry.
create view inventory_snapshot as
select p.store_id, p.id as product_id, p.name, p.unit, p.pack_size_milli, p.sell_paise,
       coalesce(s.qty_milli, 0)::bigint                  as qty_milli,
       coalesce(v.value_paise, 0)::bigint                as value_paise,
       ls.last_sale_at,
       ex.expiry_date                                    as nearest_expiry,
       coalesce(ex.qty_milli, 0)::bigint                 as nearest_expiry_qty_milli,
       st.stocked_at,
       lc.cost_paise                                     as last_cost_paise
from products p
left join stock_levels s on s.product_id = p.id
left join lateral (
  select sum(greatest(bl.remaining_milli, 0)::bigint * bt.cost_paise / 1000) as value_paise
  from batch_levels bl join batches bt on bt.id = bl.batch_id
  where bl.product_id = p.id) v on true
left join lateral (
  select max(b.server_time) as last_sale_at
  from bill_items i join bills b on b.id = i.bill_id
  where i.product_id = p.id) ls on true
left join lateral (
  select bl.expiry_date, sum(bl.remaining_milli)::bigint as qty_milli
  from batch_levels bl
  where bl.product_id = p.id and bl.remaining_milli > 0 and bl.expiry_date is not null
  group by bl.expiry_date order by bl.expiry_date limit 1) ex on true
left join lateral (
  select min(received_at) as stocked_at from batches where product_id = p.id) st on true
left join lateral (
  select cost_paise from batches where product_id = p.id
  order by received_at desc limit 1) lc on true
where p.active;

revoke all on daily_sales, daily_bill_totals, inventory_snapshot from anon, authenticated;
grant select on daily_sales, daily_bill_totals, inventory_snapshot to service_role;
