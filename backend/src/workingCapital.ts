import { daysBetween } from './dates.js';
import type { DailySale, InventoryRow } from './insights.js';

export type Bucket = 'expired' | 'expiring_soon' | 'dead' | 'slow' | 'healthy';

export interface WorkingCapitalOptions {
  today: string;
  deadAfterDays?: number; // no sale for this long = dead
  expiryWarnDays?: number;
  slowCoverDays?: number; // more than this many days of stock at the recent rate = slow
  rateWindowDays?: number;
}

export interface CapitalLine {
  product_id: string;
  name: string;
  bucket: Bucket;
  value_paise: number;
  note: string;
}

/**
 * Splits the cash tied up in stock into five buckets that always add up to the total.
 *
 * Each rupee of stock goes into exactly one bucket:
 *  1. The batch group expiring first (if it expires within the warning window, or already has)
 *     is carved out at that group's share of the product's value: expired / expiring_soon.
 *  2. What is left of the product is dead (no sale for a long time), else slow
 *     (no recent sales, or far more stock than the recent rate needs), else healthy.
 * A product can therefore appear in two buckets (part expiring, part healthy), but never twice
 * for the same stock.
 *
 * Only the nearest-expiry batch group is checked; a later batch that also falls inside the
 * window stays in its dead/slow/healthy bucket. That under-states expiry risk slightly rather
 * than double counting.
 */
export function buildWorkingCapital(
  inventory: InventoryRow[],
  sales: DailySale[],
  opts: WorkingCapitalOptions,
) {
  const { today, deadAfterDays = 60, expiryWarnDays = 30, slowCoverDays = 90, rateWindowDays = 28 } = opts;

  const sold = new Map<string, number>();
  for (const s of sales) {
    const age = daysBetween(s.day, today);
    if (age >= 0 && age < rateWindowDays) sold.set(s.productId, (sold.get(s.productId) ?? 0) + s.qtyMilli);
  }

  const lines: CapitalLine[] = [];
  const add = (r: InventoryRow, bucket: Bucket, value: number, note: string) => {
    if (value > 0) lines.push({ product_id: r.productId, name: r.name, bucket, value_paise: value, note });
  };

  for (const r of inventory) {
    const value = Math.max(0, r.valuePaise);
    if (value === 0) continue;

    // 1. expiry carve-out
    let expiryValue = 0;
    let expQty = 0;
    if (
      r.qtyMilli > 0 &&
      r.nearestExpiry &&
      r.nearestExpiryQtyMilli > 0 &&
      daysBetween(today, r.nearestExpiry) <= expiryWarnDays
    ) {
      expQty = Math.min(r.nearestExpiryQtyMilli, r.qtyMilli);
      expiryValue = Math.min(value, Math.round((value * expQty) / r.qtyMilli));
      const left = daysBetween(today, r.nearestExpiry);
      if (r.nearestExpiry < today) add(r, 'expired', expiryValue, `Expired ${-left} day${left === -1 ? '' : 's'} ago`);
      else add(r, 'expiring_soon', expiryValue, left === 0 ? 'Expires today' : `Expires in ${left} day${left === 1 ? '' : 's'}`);
    }

    // 2. the rest, by how well it sells
    const rest = value - expiryValue;
    if (rest <= 0) continue;
    const restQty = Math.max(0, r.qtyMilli - expQty);
    const ref = r.lastSaleAt?.slice(0, 10) ?? r.stockedAt?.slice(0, 10) ?? null;
    const idle = ref ? daysBetween(ref, today) : 0;
    const recent = sold.get(r.productId) ?? 0;
    const perDay = recent / rateWindowDays;

    if (r.qtyMilli > 0 && idle >= deadAfterDays) {
      add(r, 'dead', rest, r.lastSaleAt ? `No sale in ${idle} days` : `Never sold, ${idle} days on shelf`);
    } else if (r.qtyMilli > 0 && perDay === 0) {
      const brandNew = r.lastSaleAt === null && idle < rateWindowDays;
      if (brandNew) add(r, 'healthy', rest, 'New stock, no history yet');
      else add(r, 'slow', rest, `No sale in the last ${rateWindowDays} days`);
    } else if (r.qtyMilli > 0 && restQty / perDay > slowCoverDays) {
      add(r, 'slow', rest, `About ${Math.round(restQty / perDay)} days of stock at the recent rate`);
    } else {
      add(r, 'healthy', rest, 'Selling normally');
    }
  }

  const sum = (b: Bucket) => lines.filter((l) => l.bucket === b).reduce((s, l) => s + l.value_paise, 0);
  const buckets = {
    expired: sum('expired'),
    expiring_soon: sum('expiring_soon'),
    dead: sum('dead'),
    slow: sum('slow'),
    healthy: sum('healthy'),
  };
  const total = Object.values(buckets).reduce((a, b) => a + b, 0);

  return {
    as_of: today,
    total_paise: total,
    buckets_paise: buckets,
    // Stock that could be turned back into cash (discount, return to supplier). Expired stock is a write-off.
    freeable_paise: buckets.expiring_soon + buckets.dead + buckets.slow,
    at_risk_paise: total - buckets.healthy,
    lines: lines
      .filter((l) => l.bucket !== 'healthy')
      .sort((a, b) => b.value_paise - a.value_paise),
  };
}
