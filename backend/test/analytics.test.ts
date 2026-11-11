import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { addDays, daysBetween, istToday } from '../src/dates.js';
import { buildSeries, crostonSba, forecast7, type Festival } from '../src/forecast.js';
import { buildInsights, type DailySale, type InventoryRow } from '../src/insights.js';
import { MemoryRepo } from '../src/repo.memory.js';

const TODAY = '2026-11-10';
const noFestivals: Festival[] = [];

describe('dates', () => {
  it('adds days across month ends and counts differences', () => {
    expect(addDays('2026-11-28', 5)).toBe('2026-12-03');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(daysBetween('2026-11-01', '2026-11-10')).toBe(9);
  });
  it('uses India time for "today"', () => {
    expect(istToday(new Date('2026-11-09T19:00:00Z'))).toBe('2026-11-10'); // 00:30 IST next day
    expect(istToday(new Date('2026-11-09T18:00:00Z'))).toBe('2026-11-09'); // 23:30 IST
  });
});

describe('forecast7', () => {
  it('returns nothing for products that never sold', () => {
    const f = forecast7(new Array(30).fill(0), TODAY, noFestivals);
    expect(f.method).toBe('none');
    expect(f.totalMilli).toBe(0);
    expect(forecast7([], TODAY, noFestivals).method).toBe('none');
  });
  it('uses a low-confidence moving average for new shops', () => {
    const f = forecast7([2000, 2000, 2000, 2000, 2000], TODAY, noFestivals);
    expect(f).toMatchObject({ method: 'moving-average', confidence: 'low', baseDailyMilli: 2000 });
    expect(f.totalMilli).toBe(14000);
  });
  it('uses exponential smoothing for steady sellers with a long history', () => {
    const f = forecast7(new Array(56).fill(3000), TODAY, noFestivals);
    expect(f.method).toBe('exp-smoothing');
    expect(f.confidence).toBe('high');
    expect(f.baseDailyMilli).toBe(3000);
  });
  it('uses Croston for slow movers instead of averaging in the zeros', () => {
    const series = new Array(56).fill(0);
    for (const i of [3, 10, 17, 24, 31, 38, 45, 52]) series[i] = 2000; // 2 units every 7 days
    const f = forecast7(series, TODAY, noFestivals);
    expect(f.method).toBe('croston-sba');
    // true rate is 2000/7 = 286 a day; SBA is slightly below that
    expect(f.baseDailyMilli).toBeGreaterThan(230);
    expect(f.baseDailyMilli).toBeLessThan(300);
    expect(crostonSba([0, 0, 0])).toBe(0);
  });
  it('lifts demand on festival days and names the festival', () => {
    const fest: Festival[] = [{ name: 'Diwali', start: '2026-11-12', end: '2026-11-13', uplift: 2 }];
    const f = forecast7(new Array(14).fill(1000), TODAY, fest);
    expect(f.dailyMilli).toEqual([1000, 1000, 2000, 2000, 1000, 1000, 1000]);
    expect(f.festival).toBe('Diwali');
  });
  it('builds a zero-filled series ending yesterday', () => {
    expect(buildSeries([{ day: '2026-11-09', qtyMilli: 5 }, { day: '2026-11-07', qtyMilli: 2 }], TODAY, 4)).toEqual([0, 2, 0, 5]);
  });
});

const row = (over: Partial<InventoryRow>): InventoryRow => ({
  productId: 'p1',
  name: 'Sugar',
  unit: 'kg',
  packSizeMilli: 1000,
  sellPaise: 4500,
  qtyMilli: 0,
  valuePaise: 0,
  lastSaleAt: null,
  nearestExpiry: null,
  nearestExpiryQtyMilli: 0,
  stockedAt: '2026-08-01T00:00:00Z',
  lastCostPaise: 4000,
  ...over,
});
const daily = (productId: string, perDay: number, days: number): DailySale[] =>
  Array.from({ length: days }, (_, i) => ({ productId, day: addDays(TODAY, -(i + 1)), qtyMilli: perDay }));

describe('buildInsights', () => {
  it('flags products that will run out before the next delivery', () => {
    const r = buildInsights(
      [row({ productId: 'a', name: 'Oil', qtyMilli: 4000 }), row({ productId: 'b', name: 'Salt', qtyMilli: 90000 })],
      [...daily('a', 2000, 40), ...daily('b', 1000, 40)],
      { today: TODAY, festivals: noFestivals },
    );
    expect(r.low_stock.map((l) => l.product_id)).toEqual(['a']);
    expect(r.low_stock[0]).toMatchObject({ days_of_cover: 2 });
  });

  it('finds expiring and already-expired stock', () => {
    const r = buildInsights(
      [
        row({ productId: 'a', name: 'Milk', nearestExpiry: '2026-11-13', nearestExpiryQtyMilli: 3000, qtyMilli: 3000 }),
        row({ productId: 'b', name: 'Curd', nearestExpiry: '2026-11-08', nearestExpiryQtyMilli: 1000, qtyMilli: 1000 }),
        row({ productId: 'c', name: 'Rice', nearestExpiry: '2027-06-01', nearestExpiryQtyMilli: 9000, qtyMilli: 9000 }),
      ],
      [],
      { today: TODAY },
    );
    expect(r.expiring.map((e) => [e.name, e.days_left, e.expired])).toEqual([
      ['Curd', -2, true],
      ['Milk', 3, false],
    ]);
  });

  it('finds dead stock and totals the cash tied up, biggest first', () => {
    const r = buildInsights(
      [
        row({ productId: 'a', name: 'Old tea', qtyMilli: 5000, valuePaise: 30000, lastSaleAt: '2026-08-20T10:00:00Z' }),
        row({ productId: 'b', name: 'Stale rusk', qtyMilli: 2000, valuePaise: 50000, lastSaleAt: null, stockedAt: '2026-07-01T00:00:00Z' }),
        row({ productId: 'c', name: 'Fresh item', qtyMilli: 2000, valuePaise: 99999, lastSaleAt: '2026-11-05T10:00:00Z' }),
        row({ productId: 'd', name: 'New, unsold', qtyMilli: 2000, valuePaise: 777, lastSaleAt: null, stockedAt: '2026-11-01T00:00:00Z' }),
        row({ productId: 'e', name: 'Out of stock', qtyMilli: 0, lastSaleAt: '2026-01-01T00:00:00Z' }),
      ],
      [],
      { today: TODAY },
    );
    expect(r.dead_stock.map((d) => d.name)).toEqual(['Stale rusk', 'Old tea']);
    expect(r.dead_stock[0]).toMatchObject({ never_sold: true });
    expect(r.dead_stock_value_paise).toBe(80000);
  });

  it('recommends the sunflower-oil style reorder with a reason, rounded up to whole packs', () => {
    const r = buildInsights(
      [row({ productId: 'oil', name: 'Sunflower Oil 1L', unit: 'pc', qtyMilli: 4000, lastCostPaise: 14000, sellPaise: 15500 })],
      daily('oil', 2000, 40),
      { today: TODAY, leadDays: 2, reviewDays: 3, festivals: noFestivals },
    );
    // 2/day x 5 days x 1.2 safety = 12; minus 4 on the shelf = 8 to order
    expect(r.reorder.lines).toHaveLength(1);
    expect(r.reorder.lines[0]).toMatchObject({ order_qty_milli: 8000, est_cost_paise: 112000, cost_is_estimated: false, partial: false });
    expect(r.reorder.lines[0]!.reason).toContain('You have 4 pc');
    expect(r.reorder.total_paise).toBe(112000);
  });

  it('does not reorder what is already well stocked', () => {
    const r = buildInsights([row({ qtyMilli: 100000 })], daily('p1', 1000, 40), { today: TODAY, festivals: noFestivals });
    expect(r.reorder.lines).toEqual([]);
  });

  it('keeps the shopping list inside the budget, most urgent first, trimming or deferring the rest', () => {
    const inv = [
      row({ productId: 'urgent', name: 'Urgent', qtyMilli: 0, lastCostPaise: 10000 }),
      row({ productId: 'later', name: 'Later', qtyMilli: 3000, lastCostPaise: 10000 }),
      row({ productId: 'last', name: 'Last', qtyMilli: 5000, lastCostPaise: 10000 }),
    ];
    const sales = [...daily('urgent', 2000, 40), ...daily('later', 2000, 40), ...daily('last', 2000, 40)];
    const r = buildInsights(inv, sales, { today: TODAY, budgetPaise: 130000, festivals: noFestivals });
    expect(r.reorder.total_paise).toBeLessThanOrEqual(130000);
    expect(r.reorder.lines[0]).toMatchObject({ product_id: 'urgent', order_qty_milli: 12000, partial: false });
    expect(r.reorder.lines[1]).toMatchObject({ product_id: 'later', partial: true });
    expect(r.reorder.deferred.map((d) => d.product_id)).toEqual(['last']);
  });

  it('marks cost as estimated when no purchase price is known', () => {
    const r = buildInsights([row({ qtyMilli: 0, lastCostPaise: null })], daily('p1', 1000, 40), { today: TODAY, festivals: noFestivals });
    expect(r.reorder.lines[0]).toMatchObject({ cost_is_estimated: true });
  });

  it('does not invent history for a brand-new shop', () => {
    const r = buildInsights([row({ stockedAt: '2026-11-08T00:00:00Z', qtyMilli: 1000 })], daily('p1', 2000, 2), { today: TODAY, festivals: noFestivals });
    expect(r.history_days).toBe(2);
    expect(r.forecasts[0]).toMatchObject({ method: 'moving-average', confidence: 'low' });
  });
});

describe('analytics endpoints', () => {
  const STORE = '11111111-1111-4111-8111-111111111111';
  const OWNER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const CASHIER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const SUGAR = '33333333-3333-4333-8333-333333333333';
  const tokens: Record<string, string> = { owner: OWNER, cashier: CASHIER };
  const now = () => new Date('2026-11-10T06:00:00Z'); // 11:30 IST on 10 Nov

  const setup = () => {
    const repo = new MemoryRepo();
    repo.roles.set(`${STORE}:${OWNER}`, 'owner');
    repo.roles.set(`${STORE}:${CASHIER}`, 'cashier');
    repo.products.push({ id: SUGAR, storeId: STORE, name: 'Sugar', barcode: null, unit: 'kg', sellPaise: 4500, gstRate: 5, aliases: [], active: true });
    repo.batches.push({ batchId: 'b1', storeId: STORE, productId: SUGAR, expiryDate: '2026-11-20', receivedAt: '2026-10-01T00:00:00Z', remainingMilli: 10000, costPaise: 4000 });
    return { repo, app: createApp({ repo, authenticate: async (t) => tokens[t] ?? null, now }) };
  };
  const sell = (app: ReturnType<typeof setup>['app'], qtyMilli: number, device_time: string) =>
    request(app).post('/v1/bills').set('authorization', 'Bearer cashier')
      .send({ id: crypto.randomUUID(), store_id: STORE, payment_mode: 'cash', device_time, items: [{ product_id: SUGAR, qty_milli: qtyMilli }] })
      .expect(201);

  it('dashboard shows today, the last 7 days and best sellers to any member', async () => {
    const { app } = setup();
    await sell(app, 2000, '2026-11-10T05:00:00.000Z');
    await sell(app, 1000, '2026-11-09T05:00:00.000Z');
    const res = await request(app).get(`/v1/stores/${STORE}/dashboard`).set('authorization', 'Bearer cashier').expect(200);
    expect(res.body.today).toEqual({ total_paise: 9000, bills: 1 });
    expect(res.body.last_7_days).toHaveLength(7);
    expect(res.body.last_7_days.at(-2)).toMatchObject({ day: '2026-11-09', total_paise: 4500 });
    expect(res.body.top_sellers[0]).toMatchObject({ name: 'Sugar', qty_milli: 3000 });
  });

  it('insights are owner only', async () => {
    const { app } = setup();
    await request(app).get(`/v1/stores/${STORE}/insights`).set('authorization', 'Bearer cashier').expect(403);
    await request(app).get(`/v1/stores/${STORE}/insights`).expect(401);
    await request(app).get('/v1/stores/not-a-uuid/insights').set('authorization', 'Bearer owner').expect(400);
  });

  it('insights combine expiry, stock and reorder for the owner', async () => {
    const { app } = setup();
    await sell(app, 4000, '2026-11-09T05:00:00.000Z');
    const res = await request(app).get(`/v1/stores/${STORE}/insights?budget_paise=5000`).set('authorization', 'Bearer owner').expect(200);
    expect(res.body.as_of).toBe('2026-11-10');
    expect(res.body.expiring[0]).toMatchObject({ name: 'Sugar', days_left: 10 });
    expect(res.body.reorder.budget_paise).toBe(5000);
    expect(res.body.reorder.total_paise).toBeLessThanOrEqual(5000);
  });
});
