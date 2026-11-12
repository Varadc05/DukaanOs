import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { InventoryRow } from '../src/insights.js';
import { MemoryRepo } from '../src/repo.memory.js';
import { buildWorkingCapital } from '../src/workingCapital.js';

const TODAY = '2026-11-09';
const row = (over: Partial<InventoryRow>): InventoryRow => ({
  productId: 'p', name: 'P', unit: 'pc', packSizeMilli: 1000, sellPaise: 100, qtyMilli: 10_000,
  valuePaise: 1000, lastSaleAt: '2026-11-08T10:00:00Z', nearestExpiry: null, nearestExpiryQtyMilli: 0,
  stockedAt: '2026-08-01T00:00:00Z', lastCostPaise: 100, ...over,
});
const sales = (productId: string, perDayMilli: number, days = 28) =>
  Array.from({ length: days }, (_, i) => ({
    productId, qtyMilli: perDayMilli,
    day: new Date(Date.parse(`${TODAY}T00:00:00Z`) - (i + 1) * 86_400_000).toISOString().slice(0, 10),
  }));
const wc = (inv: InventoryRow[], s: ReturnType<typeof sales> = []) => buildWorkingCapital(inv, s, { today: TODAY });

describe('working capital buckets', () => {
  it('puts a normal seller in healthy', () => {
    const r = wc([row({ productId: 'a', qtyMilli: 10_000, valuePaise: 5000 })], sales('a', 1000));
    expect(r.buckets_paise).toEqual({ expired: 0, expiring_soon: 0, dead: 0, slow: 0, healthy: 5000 });
  });

  it('flags dead stock after 60 idle days, using days on shelf if it never sold', () => {
    const r = wc([
      row({ productId: 'old', valuePaise: 800, lastSaleAt: '2026-08-01T00:00:00Z' }),
      row({ productId: 'never', valuePaise: 500, lastSaleAt: null, stockedAt: '2026-06-01T00:00:00Z' }),
    ]);
    expect(r.buckets_paise.dead).toBe(1300);
    expect(r.lines.find((l) => l.product_id === 'never')!.note).toMatch(/Never sold/);
  });

  it('flags slow stock: no sale in 4 weeks, or 90+ days of cover at the recent rate', () => {
    const r = wc(
      [
        row({ productId: 'quiet', valuePaise: 400, lastSaleAt: '2026-10-01T00:00:00Z' }), // 39 days idle
        row({ productId: 'heavy', valuePaise: 600, qtyMilli: 100_000 }), // sells 1/day, holds 100
      ],
      sales('heavy', 1000),
    );
    expect(r.buckets_paise.slow).toBe(1000);
    expect(r.buckets_paise.dead).toBe(0);
  });

  it('does not call brand-new stock slow', () => {
    const r = wc([row({ valuePaise: 900, lastSaleAt: null, stockedAt: '2026-11-05T00:00:00Z' })]);
    expect(r.buckets_paise.healthy).toBe(900);
  });

  it('separates expired from expiring soon', () => {
    const r = wc([
      row({ productId: 'curd', valuePaise: 300, qtyMilli: 1000, nearestExpiry: '2026-11-07', nearestExpiryQtyMilli: 1000 }),
      row({ productId: 'milk', valuePaise: 600, qtyMilli: 3000, nearestExpiry: '2026-11-12', nearestExpiryQtyMilli: 3000 }),
    ], [...sales('curd', 500), ...sales('milk', 1000)]);
    expect(r.buckets_paise.expired).toBe(300);
    expect(r.buckets_paise.expiring_soon).toBe(600);
    expect(r.buckets_paise.healthy).toBe(0);
  });

  it('never counts the same stock twice: expiring part is carved out, the rest is classified on its own', () => {
    // 10 units worth Rs 10 each = Rs 100; 4 of them expire in 5 days, and the product has not sold for 90 days.
    const r = wc([row({
      productId: 'x', qtyMilli: 10_000, valuePaise: 10_000, lastSaleAt: '2026-08-01T00:00:00Z',
      nearestExpiry: '2026-11-14', nearestExpiryQtyMilli: 4000,
    })]);
    expect(r.buckets_paise.expiring_soon).toBe(4000);
    expect(r.buckets_paise.dead).toBe(6000);
    expect(r.total_paise).toBe(10_000);
  });

  it('always adds up to the stock value, across mixed data', () => {
    const inv = [
      row({ productId: 'a', valuePaise: 1234 }),
      row({ productId: 'b', valuePaise: 777, lastSaleAt: '2026-01-01T00:00:00Z', nearestExpiry: '2026-11-20', nearestExpiryQtyMilli: 3333, qtyMilli: 9999 }),
      row({ productId: 'c', valuePaise: 1, nearestExpiry: '2026-10-01', nearestExpiryQtyMilli: 7, qtyMilli: 3 }), // expiring qty above stock
      row({ productId: 'd', valuePaise: 0 }),
      row({ productId: 'e', valuePaise: 55, qtyMilli: -2000 }), // negative stock but value still in batches
    ];
    const r = wc(inv, sales('a', 300));
    const b = r.buckets_paise;
    expect(b.expired + b.expiring_soon + b.dead + b.slow + b.healthy).toBe(r.total_paise);
    expect(r.total_paise).toBe(inv.reduce((s, x) => s + x.valuePaise, 0));
    expect(r.freeable_paise).toBe(b.expiring_soon + b.dead + b.slow);
    expect(r.at_risk_paise).toBe(r.total_paise - b.healthy);
  });
});

describe('GET /v1/stores/:id/working-capital', () => {
  const STORE = '11111111-1111-4111-8111-111111111111';
  const OWNER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const CASHIER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const P = '33333333-3333-4333-8333-333333333333';
  const tokens: Record<string, string> = { owner: OWNER, cashier: CASHIER };

  const setup = () => {
    const repo = new MemoryRepo();
    repo.roles.set(`${STORE}:${OWNER}`, 'owner');
    repo.roles.set(`${STORE}:${CASHIER}`, 'cashier');
    repo.products.push({ id: P, storeId: STORE, name: 'Rusk', barcode: null, unit: 'pc', sellPaise: 100, gstRate: 0, aliases: [], active: true });
    repo.batches.push({ batchId: 'b1', storeId: STORE, productId: P, expiryDate: null, receivedAt: '2026-06-01T00:00:00Z', remainingMilli: 10_000, costPaise: 50 });
    return createApp({ repo, authenticate: async (t) => tokens[t] ?? null, now: () => new Date('2026-11-09T06:00:00Z') });
  };

  it('is owner only', async () => {
    await request(setup()).get(`/v1/stores/${STORE}/working-capital`).set('authorization', 'Bearer cashier').expect(403);
  });

  it('reports dead stock and leaves cash in hand to the owner to enter', async () => {
    const res = await request(setup()).get(`/v1/stores/${STORE}/working-capital`).set('authorization', 'Bearer owner').expect(200);
    expect(res.body.total_paise).toBe(500); // 10 x Rs 0.50
    expect(res.body.buckets_paise.dead).toBe(500);
    expect(res.body.budget_paise).toBeNull();
    expect(res.body.headroom_paise).toBeNull();
    const withBudget = await request(setup()).get(`/v1/stores/${STORE}/working-capital?budget_paise=100000`)
      .set('authorization', 'Bearer owner').expect(200);
    expect(withBudget.body.headroom_paise).toBe(100000 - withBudget.body.reorder_needed_paise);
  });
});
