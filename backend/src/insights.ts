import { addDays, daysBetween } from './dates.js';
import { buildSeries, forecast7, FESTIVALS, type Confidence, type Festival, type Method } from './forecast.js';
import { formatQtyMilli } from './money.js';

export interface InventoryRow {
  productId: string;
  name: string;
  unit: string;
  packSizeMilli: number;
  sellPaise: number;
  qtyMilli: number;
  valuePaise: number; // cash tied up, at cost
  lastSaleAt: string | null;
  nearestExpiry: string | null;
  nearestExpiryQtyMilli: number;
  stockedAt: string | null;
  lastCostPaise: number | null;
}

export interface DailySale {
  productId: string;
  day: string;
  qtyMilli: number;
}

export interface InsightOptions {
  today: string;
  budgetPaise?: number | null;
  leadDays?: number; // days until the next delivery arrives
  reviewDays?: number; // days one order should cover after delivery
  deadAfterDays?: number;
  expiryWarnDays?: number;
  historyDays?: number;
  festivals?: Festival[];
}

export interface ReorderLine {
  productId: string;
  name: string;
  unit: string;
  orderQtyMilli: number;
  estCostPaise: number;
  costIsEstimated: boolean;
  partial: boolean; // trimmed to fit the budget
  reason: string;
}

const MAX_HISTORY = 56;
const SAFETY = 1.2;

const rowCost = (r: InventoryRow): { cost: number; estimated: boolean } =>
  r.lastCostPaise !== null
    ? { cost: r.lastCostPaise, estimated: false }
    : { cost: Math.round(r.sellPaise * 0.85), estimated: true };

export function buildInsights(inventory: InventoryRow[], sales: DailySale[], opts: InsightOptions) {
  const {
    today,
    budgetPaise = null,
    leadDays = 2,
    reviewDays = 3,
    deadAfterDays = 60,
    expiryWarnDays = 30,
    historyDays = MAX_HISTORY,
    festivals = FESTIVALS,
  } = opts;

  // How much history does this shop actually have? Never zero-fill days before it started.
  const starts = [
    ...inventory.map((r) => r.stockedAt?.slice(0, 10)).filter((d): d is string => !!d),
    ...sales.map((s) => s.day),
  ];
  const shopStart = starts.length ? starts.reduce((a, b) => (a < b ? a : b)) : today;
  const n = Math.max(0, Math.min(historyDays, daysBetween(shopStart, today)));

  const salesBy = new Map<string, DailySale[]>();
  for (const s of sales) {
    const list = salesBy.get(s.productId) ?? [];
    list.push(s);
    salesBy.set(s.productId, list);
  }

  const forecasts = inventory.map((r) => ({
    row: r,
    fc: forecast7(buildSeries(salesBy.get(r.productId) ?? [], today, n), today, festivals),
  }));

  const low_stock = forecasts
    .filter(({ row, fc }) => fc.baseDailyMilli > 0 && row.qtyMilli / fc.baseDailyMilli < leadDays + 2)
    .map(({ row, fc }) => {
      const cover = Math.max(0, row.qtyMilli) / fc.baseDailyMilli;
      return {
        product_id: row.productId,
        name: row.name,
        unit: row.unit,
        qty_milli: row.qtyMilli,
        days_of_cover: Math.round(cover * 10) / 10,
        reason: `${formatQtyMilli(Math.max(0, row.qtyMilli), row.unit)} left, selling about ${formatQtyMilli(fc.baseDailyMilli, row.unit)} a day`,
      };
    })
    .sort((a, b) => a.days_of_cover - b.days_of_cover);

  const expiring = inventory
    .filter((r) => r.nearestExpiry && daysBetween(today, r.nearestExpiry) <= expiryWarnDays && r.nearestExpiryQtyMilli > 0)
    .map((r) => ({
      product_id: r.productId,
      name: r.name,
      unit: r.unit,
      expiry_date: r.nearestExpiry!,
      days_left: daysBetween(today, r.nearestExpiry!),
      qty_milli: r.nearestExpiryQtyMilli,
      expired: r.nearestExpiry! < today,
    }))
    .sort((a, b) => a.days_left - b.days_left);

  const dead_stock = inventory
    .filter((r) => r.qtyMilli > 0)
    .map((r) => {
      const ref = r.lastSaleAt?.slice(0, 10) ?? r.stockedAt?.slice(0, 10) ?? null;
      return { r, idle: ref ? daysBetween(ref, today) : 0 };
    })
    .filter(({ idle }) => idle >= deadAfterDays)
    .map(({ r, idle }) => ({
      product_id: r.productId,
      name: r.name,
      unit: r.unit,
      qty_milli: r.qtyMilli,
      value_paise: r.valuePaise,
      days_idle: idle,
      never_sold: r.lastSaleAt === null,
    }))
    .sort((a, b) => b.value_paise - a.value_paise);

  // Reorder: cover lead time + review period (+20% safety) minus what is on the shelf.
  const candidates = forecasts
    .filter(({ fc }) => fc.baseDailyMilli > 0)
    .map(({ row, fc }) => {
      const perDay = fc.totalMilli / 7; // includes any festival lift in the coming week
      const target = perDay * (leadDays + reviewDays) * SAFETY;
      const need = target - Math.max(0, row.qtyMilli);
      const pack = Math.max(1, row.packSizeMilli);
      const qty = need > 0 ? Math.ceil(need / pack) * pack : 0;
      const { cost, estimated } = rowCost(row);
      return { row, fc, qty, cost, estimated, cover: Math.max(0, row.qtyMilli) / fc.baseDailyMilli, perDay };
    })
    .filter((c) => c.qty > 0)
    .sort((a, b) => a.cover - b.cover); // most likely to run out first

  const lines: ReorderLine[] = [];
  const deferred: { product_id: string; name: string; reason: string }[] = [];
  let spent = 0;

  for (const c of candidates) {
    const unitCost = (q: number) => Math.round((q * c.cost) / 1000);
    const pack = Math.max(1, c.row.packSizeMilli);
    let qty = c.qty;
    let partial = false;

    if (budgetPaise !== null && spent + unitCost(qty) > budgetPaise) {
      const room = budgetPaise - spent;
      const affordable = c.cost > 0 ? Math.floor(((room * 1000) / c.cost) / pack) * pack : 0;
      if (affordable < pack) {
        deferred.push({ product_id: c.row.productId, name: c.row.name, reason: 'Over budget' });
        continue;
      }
      qty = affordable;
      partial = true;
    }

    const est = unitCost(qty);
    spent += est;
    const festival = c.fc.festival ? `, ${c.fc.festival} lift included` : '';
    lines.push({
      productId: c.row.productId,
      name: c.row.name,
      unit: c.row.unit,
      orderQtyMilli: qty,
      estCostPaise: est,
      costIsEstimated: c.estimated,
      partial,
      reason:
        `You have ${formatQtyMilli(Math.max(0, c.row.qtyMilli), c.row.unit)}; selling about ` +
        `${formatQtyMilli(Math.round(c.perDay), c.row.unit)} a day${festival}. ` +
        `Order ${formatQtyMilli(qty, c.row.unit)} to last ${leadDays + reviewDays} days after delivery` +
        `${partial ? ' (trimmed to fit your budget)' : ''}.`,
    });
  }

  return {
    as_of: today,
    history_days: n,
    low_stock,
    expiring,
    dead_stock,
    dead_stock_value_paise: dead_stock.reduce((s, d) => s + d.value_paise, 0),
    reorder: {
      budget_paise: budgetPaise,
      total_paise: spent,
      lines: lines.map((l) => ({
        product_id: l.productId,
        name: l.name,
        unit: l.unit,
        order_qty_milli: l.orderQtyMilli,
        est_cost_paise: l.estCostPaise,
        cost_is_estimated: l.costIsEstimated,
        partial: l.partial,
        reason: l.reason,
      })),
      deferred,
    },
    forecasts: forecasts
      .filter(({ fc }) => fc.method !== 'none')
      .map(({ row, fc }) => ({
        product_id: row.productId,
        name: row.name,
        unit: row.unit,
        total_7d_milli: fc.totalMilli,
        daily_milli: fc.dailyMilli,
        method: fc.method as Method,
        confidence: fc.confidence as Confidence,
        festival: fc.festival,
      })),
  };
}

export { addDays };
