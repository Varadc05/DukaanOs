import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { BatchStock } from './fefo.js';
import type { CatalogueProduct } from './matcher.js';
import type { DailySale, InventoryRow } from './insights.js';
import { HttpError } from './errors.js';
import type { CheckoutPayload, DayTotal, NewProduct, ProductPatch, Repo, Role, StockChangePayload } from './repo.js';

type ProductRow = {
  id: string;
  name: string;
  barcode: string | null;
  unit: string;
  sell_paise: number;
  gst_rate: number;
  mrp_paise?: number;
  pack_size_milli?: number;
  active: boolean;
  product_aliases?: { alias: string }[];
};

const toProduct = (r: ProductRow): CatalogueProduct & { active: boolean } => ({
  id: r.id,
  name: r.name,
  barcode: r.barcode,
  unit: r.unit,
  sellPaise: r.sell_paise,
  gstRate: r.gst_rate,
  active: r.active,
  mrpPaise: r.mrp_paise,
  packSizeMilli: r.pack_size_milli,
  aliases: (r.product_aliases ?? []).map((a) => a.alias),
});

/**
 * Production repo. Uses the service-role key, so EVERY query below filters by store_id
 * explicitly: the service role bypasses RLS, and store_id always comes from a membership
 * check, never from trusting the request.
 * NOTE: written against supabase-js types but not yet run against a live project.
 */
export class SupabaseRepo implements Repo {
  private db: SupabaseClient;

  constructor(url: string, serviceRoleKey: string) {
    this.db = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
  }

  async getUserIdFromToken(token: string): Promise<string | null> {
    const { data, error } = await this.db.auth.getUser(token);
    return error || !data.user ? null : data.user.id;
  }

  async getRole(storeId: string, userId: string): Promise<Role | null> {
    const { data } = await this.db
      .from('members')
      .select('role')
      .eq('store_id', storeId)
      .eq('user_id', userId)
      .maybeSingle();
    return (data?.role as Role | undefined) ?? null;
  }

  async listCatalogue(storeId: string) {
    const { data, error } = await this.db
      .from('products')
      .select('id,name,barcode,unit,sell_paise,gst_rate,active,product_aliases(alias)')
      .eq('store_id', storeId)
      .eq('active', true);
    if (error) throw error;
    return (data as ProductRow[]).map(toProduct);
  }

  async getProducts(storeId: string, ids: string[]) {
    const { data, error } = await this.db
      .from('products')
      .select('id,name,barcode,unit,sell_paise,gst_rate,mrp_paise,pack_size_milli,active')
      .eq('store_id', storeId)
      .in('id', ids);
    if (error) throw error;
    return (data as ProductRow[]).map(toProduct);
  }

  async getBatches(storeId: string, productIds: string[]): Promise<BatchStock[]> {
    const { data, error } = await this.db
      .from('batch_levels')
      .select('batch_id,product_id,expiry_date,received_at,remaining_milli')
      .eq('store_id', storeId)
      .in('product_id', productIds);
    if (error) throw error;
    return (data ?? []).map((r) => ({
      batchId: r.batch_id,
      productId: r.product_id,
      expiryDate: r.expiry_date,
      receivedAt: r.received_at,
      remainingMilli: r.remaining_milli,
    }));
  }

  async customerExists(storeId: string, customerId: string) {
    const { data } = await this.db
      .from('customers')
      .select('id')
      .eq('store_id', storeId)
      .eq('id', customerId)
      .maybeSingle();
    return !!data;
  }

  async applyCheckout(payload: CheckoutPayload) {
    const { data, error } = await this.db.rpc('checkout_bill', { p: payload });
    if (error) throw error;
    return data as { id: string; duplicate: boolean };
  }

  private mapUnique(error: { code?: string; message?: string } | null) {
    if (!error) return;
    if (error.code === '23505') {
      const alias = (error.message ?? '').includes('alias');
      throw new HttpError(
        409,
        alias ? 'duplicate_alias' : 'duplicate_barcode',
        alias ? 'One of these names is already used for another product' : 'Another product already has this barcode',
      );
    }
    throw error;
  }

  async createProduct(storeId: string, p: NewProduct) {
    const { data, error } = await this.db
      .from('products')
      .insert({
        store_id: storeId, name: p.name, barcode: p.barcode, unit: p.unit, pack_size_milli: p.packSizeMilli,
        gst_rate: p.gstRate, mrp_paise: p.mrpPaise, sell_paise: p.sellPaise,
      })
      .select('id')
      .single();
    this.mapUnique(error);
    const id = data!.id as string;
    if (p.aliases.length) {
      const { error: e2 } = await this.db
        .from('product_aliases')
        .insert(p.aliases.map((alias) => ({ store_id: storeId, product_id: id, alias })));
      if (e2) {
        // Do not leave a half-made product behind.
        await this.db.from('products').delete().eq('store_id', storeId).eq('id', id);
        this.mapUnique(e2);
      }
    }
    return { id };
  }

  async updateProduct(storeId: string, id: string, patch: ProductPatch) {
    const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.name !== undefined) row.name = patch.name;
    if (patch.barcode !== undefined) row.barcode = patch.barcode;
    if (patch.unit !== undefined) row.unit = patch.unit;
    if (patch.packSizeMilli !== undefined) row.pack_size_milli = patch.packSizeMilli;
    if (patch.gstRate !== undefined) row.gst_rate = patch.gstRate;
    if (patch.mrpPaise !== undefined) row.mrp_paise = patch.mrpPaise;
    if (patch.sellPaise !== undefined) row.sell_paise = patch.sellPaise;
    if (patch.active !== undefined) row.active = patch.active;
    const { data, error } = await this.db
      .from('products').update(row).eq('store_id', storeId).eq('id', id).select('id');
    this.mapUnique(error);
    if (!data?.length) return false;
    if (patch.aliases !== undefined) {
      const { data: have } = await this.db
        .from('product_aliases').select('alias').eq('store_id', storeId).eq('product_id', id);
      const existing = new Set((have ?? []).map((r) => r.alias as string));
      const want = new Set(patch.aliases);
      const add = [...want].filter((a) => !existing.has(a));
      const drop = [...existing].filter((a) => !want.has(a));
      if (add.length) {
        const { error: e2 } = await this.db
          .from('product_aliases').insert(add.map((alias) => ({ store_id: storeId, product_id: id, alias })));
        this.mapUnique(e2);
      }
      if (drop.length) {
        await this.db.from('product_aliases').delete().eq('store_id', storeId).eq('product_id', id).in('alias', drop);
      }
    }
    return true;
  }

  async applyStockChange(payload: StockChangePayload) {
    const { data, error } = await this.db.rpc('apply_stock_change', { p: payload });
    if (error) throw error;
    return data as { id: string; duplicate: boolean };
  }

  /** PostgREST caps a response at 1000 rows by default, so read every page. */
  private async fetchAll<T>(
    build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  ): Promise<T[]> {
    const out: T[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await build(from, from + 999);
      if (error) throw error;
      out.push(...(data ?? []));
      if (!data || data.length < 1000) return out;
    }
  }

  async getInventory(storeId: string): Promise<InventoryRow[]> {
    const rows = await this.fetchAll<Record<string, any>>((a, b) =>
      this.db.from('inventory_snapshot').select('*').eq('store_id', storeId).order('product_id').range(a, b),
    );
    return rows.map((r) => ({
      productId: r.product_id,
      name: r.name,
      unit: r.unit,
      packSizeMilli: r.pack_size_milli,
      sellPaise: r.sell_paise,
      qtyMilli: Number(r.qty_milli),
      valuePaise: Number(r.value_paise),
      lastSaleAt: r.last_sale_at,
      nearestExpiry: r.nearest_expiry,
      nearestExpiryQtyMilli: Number(r.nearest_expiry_qty_milli),
      stockedAt: r.stocked_at,
      lastCostPaise: r.last_cost_paise,
    }));
  }

  async getDailySales(storeId: string, sinceDay: string): Promise<DailySale[]> {
    const rows = await this.fetchAll<Record<string, any>>((a, b) =>
      this.db.from('daily_sales').select('product_id,day,qty_milli')
        .eq('store_id', storeId).gte('day', sinceDay).order('day').order('product_id').range(a, b),
    );
    return rows.map((r) => ({ productId: r.product_id, day: r.day, qtyMilli: Number(r.qty_milli) }));
  }

  async getDayTotals(storeId: string, sinceDay: string): Promise<DayTotal[]> {
    const { data, error } = await this.db.from('daily_bill_totals')
      .select('day,total_paise,bills').eq('store_id', storeId).gte('day', sinceDay).order('day');
    if (error) throw error;
    return (data ?? []).map((r) => ({ day: r.day, totalPaise: Number(r.total_paise), bills: r.bills }));
  }
}
