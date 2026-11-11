-- Remaining quantity per batch = sum of ledger rows pointing at it.
-- Receiving stock must write a +qty movement with batch_id (reason 'purchase').
create view batch_levels as
select b.id as batch_id, b.store_id, b.product_id, b.expiry_date, b.received_at,
       coalesce(sum(m.qty_delta_milli), 0)::int as remaining_milli
from batches b
left join stock_movements m on m.batch_id = b.id
group by b.id;

revoke all on batch_levels from anon, authenticated; -- backend (service role) only
grant select on batch_levels to service_role;
