-- Atomic stock changes from the backend: receiving goods and physical-count adjustments.
-- p = { id, store_id, user_id, batch: {product_id, expiry_date, cost_paise, qty_received_milli} | null,
--       movements: [{product_id, batch_id, qty_delta_milli, reason}] }
-- p.id is the idempotency key: it becomes the batch id and the ledger ref_id, so a retry is a no-op.
create or replace function apply_stock_change(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := (p->>'id')::uuid;
  v_store uuid := (p->>'store_id')::uuid;
  v_user uuid := (p->>'user_id')::uuid;
  v_m jsonb;
begin
  if not exists (select 1 from members where store_id = v_store and user_id = v_user and role = 'owner') then
    raise exception 'only the owner may change stock';
  end if;

  if exists (select 1 from stock_movements where ref_id = v_id) or exists (select 1 from batches where id = v_id) then
    return jsonb_build_object('id', v_id, 'duplicate', true);
  end if;

  if p->'batch' is not null and jsonb_typeof(p->'batch') = 'object' then
    if not exists (select 1 from products where id = (p->'batch'->>'product_id')::uuid and store_id = v_store) then
      raise exception 'product is not in this store';
    end if;
    insert into batches (id, store_id, product_id, expiry_date, cost_paise, qty_received_milli)
    values (v_id, v_store, (p->'batch'->>'product_id')::uuid,
            nullif(p->'batch'->>'expiry_date','')::date,
            (p->'batch'->>'cost_paise')::int, (p->'batch'->>'qty_received_milli')::int);
  end if;

  for v_m in select * from jsonb_array_elements(p->'movements') loop
    if not exists (select 1 from products where id = (v_m->>'product_id')::uuid and store_id = v_store) then
      raise exception 'product is not in this store';
    end if;
    if nullif(v_m->>'batch_id','') is not null
       and not exists (select 1 from batches where id = (v_m->>'batch_id')::uuid and store_id = v_store) then
      raise exception 'batch is not in this store';
    end if;
    insert into stock_movements (store_id, product_id, batch_id, qty_delta_milli, reason, ref_id)
    values (v_store, (v_m->>'product_id')::uuid, nullif(v_m->>'batch_id','')::uuid,
            (v_m->>'qty_delta_milli')::int, (v_m->>'reason')::movement_reason, v_id);
  end loop;

  return jsonb_build_object('id', v_id, 'duplicate', false);
end $$;

revoke all on function apply_stock_change(jsonb) from public, anon, authenticated;
grant execute on function apply_stock_change(jsonb) to service_role;
