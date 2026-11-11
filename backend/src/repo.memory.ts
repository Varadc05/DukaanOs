import type { BatchStock } from './fefo.js';
import type { CatalogueProduct } from './matcher.js';
import type { DailySale, InventoryRow } from './insights.js';
import type { CheckoutPayload, DayTotal, Repo, Role } from './repo.js';

/** In-memory repo for tests and local demos. Mirrors the SQL checkout_bill() behaviour. */
export class MemoryRepo implements Repo {
  roles = new Map<string, Role>(); // `${store}:${user}` -> role
  products: (CatalogueProduct & { storeId: string; active: boolean })[] = [];
  batches: (BatchStock & { storeId: string; costPaise?: number })[] = [];
  sellPaiseById = new Map<string, number>();
  customers = new Set<string>();
  bills = new Map<string, CheckoutPayload>();
  movements: { storeId: string; productId: string; batchId: string | null; delta: number; billId: string }[] = [];

  async getRole(storeId: string, userId: string) {
    return this.roles.get(`${storeId}:${userId}`) ?? null;
  }
  async listCatalogue(storeId: string) {
    return this.products.filter((p) => p.storeId === storeId && p.active);
  }
  async getProducts(storeId: string, ids: string[]) {
    return this.products.filter((p) => p.storeId === storeId && ids.includes(p.id));
  }
  async getBatches(storeId: string, productIds: string[]) {
    return this.batches
      .filter((b) => b.storeId === storeId && productIds.includes(b.productId))
      .map((b) => ({
        ...b,
        remainingMilli:
          b.remainingMilli +
          this.movements
            .filter((m) => m.batchId === b.batchId)
            .reduce((s, m) => s + m.delta, 0),
      }));
  }
  async customerExists(storeId: string, customerId: string) {
    return this.customers.has(`${storeId}:${customerId}`);
  }
  async applyCheckout(p: CheckoutPayload) {
    if (this.bills.has(p.id)) return { id: p.id, duplicate: true };
    this.bills.set(p.id, p);
    for (const m of p.movements) {
      this.movements.push({
        storeId: p.store_id,
        productId: m.product_id,
        batchId: m.batch_id,
        delta: m.qty_delta_milli,
        billId: p.id,
      });
    }
    return { id: p.id, duplicate: false };
  }

  stockMilli(storeId: string, productId: string, opening = 0) {
    return (
      opening +
      this.movements
        .filter((m) => m.storeId === storeId && m.productId === productId)
        .reduce((s, m) => s + m.delta, 0)
    );
  }

  private billDay(p: CheckoutPayload) {
    return p.device_time.slice(0, 10);
  }

  async getInventory(storeId: string): Promise<InventoryRow[]> {
    return this.products
      .filter((p) => p.storeId === storeId && p.active)
      .map((p) => {
        const mine = this.batches.filter((b) => b.storeId === storeId && b.productId === p.id);
        const moves = this.movements.filter((m) => m.storeId === storeId && m.productId === p.id);
        const withLeft = mine.map((b) => ({
          b,
          left: b.remainingMilli + moves.filter((m) => m.batchId === b.batchId).reduce((s, m) => s + m.delta, 0),
        }));
        const dated = withLeft.filter((x) => x.b.expiryDate && x.left > 0).sort((a, c) => (a.b.expiryDate! < c.b.expiryDate! ? -1 : 1));
        const nearest = dated[0]?.b.expiryDate ?? null;
        const sales = [...this.bills.values()]
          .filter((bl) => bl.store_id === storeId && bl.items.some((i) => i.product_id === p.id))
          .map((bl) => bl.device_time)
          .sort();
        const latest = [...mine].sort((a, c) => (a.receivedAt < c.receivedAt ? 1 : -1))[0];
        return {
          productId: p.id,
          name: p.name,
          unit: p.unit,
          packSizeMilli: 1000,
          sellPaise: p.sellPaise,
          qtyMilli: mine.reduce((s, b) => s + b.remainingMilli, 0) + moves.reduce((s, m) => s + m.delta, 0),
          valuePaise: withLeft.reduce((s, x) => s + Math.round((Math.max(0, x.left) * (x.b.costPaise ?? 0)) / 1000), 0),
          lastSaleAt: sales.at(-1) ?? null,
          nearestExpiry: nearest,
          nearestExpiryQtyMilli: nearest ? dated.filter((x) => x.b.expiryDate === nearest).reduce((s, x) => s + x.left, 0) : 0,
          stockedAt: mine.map((b) => b.receivedAt).sort()[0] ?? null,
          lastCostPaise: latest?.costPaise ?? null,
        };
      });
  }

  async getDailySales(storeId: string, sinceDay: string): Promise<DailySale[]> {
    const acc = new Map<string, DailySale>();
    for (const bl of this.bills.values()) {
      if (bl.store_id !== storeId || this.billDay(bl) < sinceDay) continue;
      for (const it of bl.items) {
        const key = `${it.product_id}:${this.billDay(bl)}`;
        const cur = acc.get(key) ?? { productId: it.product_id, day: this.billDay(bl), qtyMilli: 0 };
        cur.qtyMilli += it.qty_milli;
        acc.set(key, cur);
      }
    }
    return [...acc.values()];
  }

  async getDayTotals(storeId: string, sinceDay: string): Promise<DayTotal[]> {
    const acc = new Map<string, DayTotal>();
    for (const bl of this.bills.values()) {
      if (bl.store_id !== storeId || this.billDay(bl) < sinceDay) continue;
      const cur = acc.get(this.billDay(bl)) ?? { day: this.billDay(bl), totalPaise: 0, bills: 0 };
      cur.totalPaise += bl.total_paise;
      cur.bills++;
      acc.set(this.billDay(bl), cur);
    }
    return [...acc.values()].sort((a, c) => (a.day < c.day ? -1 : 1));
  }
}
