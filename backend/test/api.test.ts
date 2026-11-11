import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { LlmExtractor } from '../src/llm.js';
import { MemoryRepo } from '../src/repo.memory.js';

const STORE = '11111111-1111-4111-8111-111111111111';
const OTHER_STORE = '22222222-2222-4222-8222-222222222222';
const OWNER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CASHIER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const STRANGER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SUGAR = '33333333-3333-4333-8333-333333333333';
const OIL = '44444444-4444-4444-8444-444444444444';
const CUSTOMER = '55555555-5555-4555-8555-555555555555';

const tokens: Record<string, string> = { owner: OWNER, cashier: CASHIER, stranger: STRANGER };
const bill = (over: Record<string, unknown> = {}) => ({
  id: crypto.randomUUID(),
  store_id: STORE,
  payment_mode: 'cash',
  device_time: '2026-11-09T10:00:00.000Z',
  items: [{ product_id: SUGAR, qty_milli: 2000 }],
  ...over,
});

let repo: MemoryRepo;
const make = (llm?: LlmExtractor) =>
  createApp({ repo, authenticate: async (t) => tokens[t] ?? null, llm });

beforeEach(() => {
  repo = new MemoryRepo();
  repo.roles.set(`${STORE}:${OWNER}`, 'owner');
  repo.roles.set(`${STORE}:${CASHIER}`, 'cashier');
  repo.customers.add(`${STORE}:${CUSTOMER}`);
  repo.products.push(
    { id: SUGAR, storeId: STORE, name: 'Sugar', barcode: null, unit: 'kg', sellPaise: 4500, gstRate: 5, aliases: ['chini'], active: true },
    { id: OIL, storeId: STORE, name: 'Sunflower Oil 1L', barcode: null, unit: 'pc', sellPaise: 15000, gstRate: 5, aliases: [], active: true },
  );
  repo.batches.push(
    { batchId: 'b-soon', storeId: STORE, productId: SUGAR, expiryDate: '2099-01-01', receivedAt: '2026-10-01', remainingMilli: 3000 },
    { batchId: 'b-late', storeId: STORE, productId: SUGAR, expiryDate: '2099-06-01', receivedAt: '2026-10-02', remainingMilli: 10000 },
  );
});

describe('POST /v1/bills', () => {
  it('rejects missing or bad tokens', async () => {
    await request(make()).post('/v1/bills').send(bill()).expect(401);
    await request(make()).post('/v1/bills').set('authorization', 'Bearer nope').send(bill()).expect(401);
  });

  it('prices from the database, ignoring any client-sent price, and writes FEFO ledger rows', async () => {
    const res = await request(make())
      .post('/v1/bills')
      .set('authorization', 'Bearer cashier')
      .send(bill({ items: [{ product_id: SUGAR, qty_milli: 4000, price_paise: 1 }] }))
      .expect(201);
    expect(res.body.total_paise).toBe(18000); // 4 kg x 45.00, not the client's price
    expect(repo.movements.map((m) => [m.batchId, m.delta])).toEqual([
      ['b-soon', -3000],
      ['b-late', -1000],
    ]);
    expect(repo.stockMilli(STORE, SUGAR, 13000)).toBe(9000);
  });

  it('is idempotent: an offline retry never double-counts stock', async () => {
    const payload = bill();
    const app = make();
    const first = await request(app).post('/v1/bills').set('authorization', 'Bearer cashier').send(payload);
    const retry = await request(app).post('/v1/bills').set('authorization', 'Bearer cashier').send(payload);
    expect(first.status).toBe(201);
    expect(retry.status).toBe(200);
    expect(retry.body.duplicate).toBe(true);
    expect(repo.bills.size).toBe(1);
    expect(repo.movements.length).toBe(1);
  });

  it('merges repeated products into one priced line', async () => {
    const res = await request(make())
      .post('/v1/bills')
      .set('authorization', 'Bearer cashier')
      .send(bill({ items: [{ product_id: SUGAR, qty_milli: 1000 }, { product_id: SUGAR, qty_milli: 1000 }] }))
      .expect(201);
    expect(res.body.total_paise).toBe(9000);
    expect([...repo.bills.values()][0]!.items.length).toBe(1);
  });

  it('blocks people outside the store and cross-store access', async () => {
    await request(make()).post('/v1/bills').set('authorization', 'Bearer stranger').send(bill()).expect(403);
    await request(make())
      .post('/v1/bills')
      .set('authorization', 'Bearer owner')
      .send(bill({ store_id: OTHER_STORE }))
      .expect(403);
  });

  it('rejects unknown products and malformed bodies', async () => {
    await request(make())
      .post('/v1/bills')
      .set('authorization', 'Bearer cashier')
      .send(bill({ items: [{ product_id: '66666666-6666-4666-8666-666666666666', qty_milli: 1000 }] }))
      .expect(422);
    await request(make()).post('/v1/bills').set('authorization', 'Bearer cashier').send({ nope: 1 }).expect(400);
    await request(make())
      .post('/v1/bills')
      .set('authorization', 'Bearer cashier')
      .send(bill({ items: [{ product_id: SUGAR, qty_milli: -5 }] }))
      .expect(400);
  });

  it('lets cashiers discount up to 10% and requires the owner beyond that', async () => {
    // subtotal 9000: 900 is exactly 10%
    await request(make()).post('/v1/bills').set('authorization', 'Bearer cashier')
      .send(bill({ items: [{ product_id: SUGAR, qty_milli: 2000 }], discount_paise: 900 })).expect(201);
    await request(make()).post('/v1/bills').set('authorization', 'Bearer cashier')
      .send(bill({ items: [{ product_id: SUGAR, qty_milli: 2000 }], discount_paise: 901 })).expect(403);
    await request(make()).post('/v1/bills').set('authorization', 'Bearer owner')
      .send(bill({ items: [{ product_id: SUGAR, qty_milli: 2000 }], discount_paise: 2000 })).expect(201);
    await request(make()).post('/v1/bills').set('authorization', 'Bearer owner')
      .send(bill({ items: [{ product_id: SUGAR, qty_milli: 2000 }], discount_paise: 99999 })).expect(422);
  });

  it('requires a real customer for credit sales', async () => {
    await request(make()).post('/v1/bills').set('authorization', 'Bearer cashier')
      .send(bill({ payment_mode: 'credit' })).expect(422);
    await request(make()).post('/v1/bills').set('authorization', 'Bearer cashier')
      .send(bill({ payment_mode: 'credit', customer_id: '77777777-7777-4777-8777-777777777777' })).expect(422);
    await request(make()).post('/v1/bills').set('authorization', 'Bearer cashier')
      .send(bill({ payment_mode: 'credit', customer_id: CUSTOMER })).expect(201);
  });

  it('allows a sale beyond stock and records negative stock instead of failing', async () => {
    await request(make()).post('/v1/bills').set('authorization', 'Bearer cashier')
      .send(bill({ items: [{ product_id: OIL, qty_milli: 3000 }] })).expect(201);
    expect(repo.stockMilli(STORE, OIL, 0)).toBe(-3000);
  });
});

describe('POST /v1/voice/parse', () => {
  it('returns confirmable suggestions with unit conversion', async () => {
    const res = await request(make())
      .post('/v1/voice/parse')
      .set('authorization', 'Bearer cashier')
      .send({ store_id: STORE, text: '500 gram chini aur ek sunflower oil' })
      .expect(200);
    const [sugar, oil] = res.body.suggestions;
    expect(sugar).toMatchObject({ qty_milli: 500, unit: 'kg', decision: 'auto' });
    expect(sugar.candidates[0].productId).toBe(SUGAR);
    expect(oil.candidates[0].productId).toBe(OIL);
    expect(res.body.used_llm).toBe(false);
  });

  it('only calls the LLM for fragments the rules cannot read, and stays within the cap', async () => {
    const calls: string[] = [];
    const llm: LlmExtractor = {
      extract: async (t) => {
        calls.push(t);
        return [{ query: 'sugar', qty: 1, unit: 'kg', confidence: 'medium' }];
      },
    };
    const app = createApp({ repo, authenticate: async (t) => tokens[t] ?? null, llm, llmDailyCapPerStore: 1 });
    const send = () =>
      request(app).post('/v1/voice/parse').set('authorization', 'Bearer cashier')
        .send({ store_id: STORE, text: '7' });
    const first = await send().expect(200);
    expect(first.body.used_llm).toBe(true);
    const second = await send().expect(200);
    expect(second.body.used_llm).toBe(false);
    expect(second.body.unparsed).toEqual(['7']);
    expect(calls).toEqual(['7']);
  });

  it('falls back to manual entry when the LLM fails', async () => {
    const llm: LlmExtractor = { extract: async () => { throw new Error('down'); } };
    const res = await request(createApp({ repo, authenticate: async (t) => tokens[t] ?? null, llm }))
      .post('/v1/voice/parse').set('authorization', 'Bearer cashier')
      .send({ store_id: STORE, text: '7' }).expect(200);
    expect(res.body.unparsed).toEqual(['7']);
  });

  it('refuses non-members', async () => {
    await request(make()).post('/v1/voice/parse').set('authorization', 'Bearer stranger')
      .send({ store_id: STORE, text: 'sugar' }).expect(403);
  });
});
