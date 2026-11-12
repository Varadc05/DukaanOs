import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { MemoryRepo } from '../src/repo.memory.js';

const STORE = '11111111-1111-4111-8111-111111111111';
const OWNER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CASHIER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const STRANGER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SUGAR = '33333333-3333-4333-8333-333333333333';
const NOW = new Date('2026-11-09T06:00:00Z'); // 9 Nov 2026, 11:30 IST

const tokens: Record<string, string> = { owner: OWNER, cashier: CASHIER, stranger: STRANGER };
let repo: MemoryRepo;
const api = () => createApp({ repo, authenticate: async (t) => tokens[t] ?? null, now: () => NOW });
const as = (who: string) => ({ authorization: `Bearer ${who}` });
const uid = () => crypto.randomUUID();
const base = `/v1/stores/${STORE}`;
const widget = (over: Record<string, unknown> = {}) => ({
  name: 'Parle-G 50g', barcode: '8901719101001', unit: 'pc', mrp_paise: 500, sell_paise: 500,
  gst_rate: 18, aliases: ['parle', 'biscuit'], ...over,
});
const stockOf = (id: string) => repo.stockMilli(STORE, id);

beforeEach(() => {
  repo = new MemoryRepo();
  repo.roles.set(`${STORE}:${OWNER}`, 'owner');
  repo.roles.set(`${STORE}:${CASHIER}`, 'cashier');
  repo.products.push({
    id: SUGAR, storeId: STORE, name: 'Sugar', barcode: null, unit: 'kg', sellPaise: 4500,
    gstRate: 5, aliases: ['chini'], active: true, mrpPaise: 5000,
  });
});

describe('who may change the catalogue and stock', () => {
  it('rejects cashiers and strangers on every write', async () => {
    for (const who of ['cashier', 'stranger']) {
      await request(api()).post(`${base}/products`).set(as(who)).send(widget()).expect(403);
      await request(api()).patch(`${base}/products/${SUGAR}`).set(as(who)).send({ sell_paise: 4000 }).expect(403);
      await request(api()).post(`${base}/stock/receive`).set(as(who))
        .send({ id: uid(), product_id: SUGAR, qty_milli: 1000, cost_paise: 100 }).expect(403);
      await request(api()).post(`${base}/stock/adjust`).set(as(who))
        .send({ id: uid(), product_id: SUGAR, counted_milli: 0 }).expect(403);
    }
    await request(api()).post(`${base}/products`).send(widget()).expect(401);
  });

  it('lets a cashier read the product list, with no cost fields', async () => {
    const res = await request(api()).get(`${base}/products`).set(as('cashier')).expect(200);
    expect(res.body.products[0]).toMatchObject({ id: SUGAR, name: 'Sugar', sell_paise: 4500, qty_milli: 0 });
    expect(JSON.stringify(res.body)).not.toMatch(/cost|value/);
    await request(api()).get(`${base}/products`).set(as('stranger')).expect(403);
  });
});

describe('add and edit products', () => {
  it('creates a product that then shows up in the list with its aliases', async () => {
    const res = await request(api()).post(`${base}/products`).set(as('owner')).send(widget()).expect(201);
    const list = await request(api()).get(`${base}/products`).set(as('owner')).expect(200);
    const made = list.body.products.find((p: { id: string }) => p.id === res.body.id);
    expect(made).toMatchObject({ name: 'Parle-G 50g', sell_paise: 500, mrp_paise: 500, gst_rate: 18, qty_milli: 0 });
    expect(made.aliases).toEqual(['parle', 'biscuit']);
  });

  it('refuses a selling price above MRP, and bad input', async () => {
    await request(api()).post(`${base}/products`).set(as('owner')).send(widget({ sell_paise: 501 })).expect(400)
      .expect((r) => expect(r.body.error).toBe('sell_above_mrp'));
    await request(api()).post(`${base}/products`).set(as('owner')).send(widget({ name: '  ' })).expect(400);
    await request(api()).post(`${base}/products`).set(as('owner')).send(widget({ sell_paise: -1 })).expect(400);
    await request(api()).post(`${base}/products`).set(as('owner')).send(widget({ gst_rate: 7 })).expect(400);
    await request(api()).post(`${base}/products`).set(as('owner')).send(widget({ unit: 'bag' })).expect(400);
  });

  it('refuses a duplicate barcode or alias', async () => {
    await request(api()).post(`${base}/products`).set(as('owner')).send(widget()).expect(201);
    await request(api()).post(`${base}/products`).set(as('owner'))
      .send(widget({ name: 'Other', aliases: [] })).expect(409)
      .expect((r) => expect(r.body.error).toBe('duplicate_barcode'));
    await request(api()).post(`${base}/products`).set(as('owner'))
      .send(widget({ name: 'Other', barcode: '8901719109999', aliases: ['chini'] })).expect(409)
      .expect((r) => expect(r.body.error).toBe('duplicate_alias'));
  });

  it('edits only what is sent, and checks the new price against the stored MRP', async () => {
    await request(api()).patch(`${base}/products/${SUGAR}`).set(as('owner')).send({ sell_paise: 4800 }).expect(200);
    expect(repo.products[0]).toMatchObject({ name: 'Sugar', sellPaise: 4800, mrpPaise: 5000 });
    await request(api()).patch(`${base}/products/${SUGAR}`).set(as('owner')).send({ sell_paise: 5001 }).expect(400);
    await request(api()).patch(`${base}/products/${SUGAR}`).set(as('owner')).send({ mrp_paise: 4000 }).expect(400); // sell 4800 > new MRP
    await request(api()).patch(`${base}/products/${SUGAR}`).set(as('owner')).send({}).expect(400);
    await request(api()).patch(`${base}/products/${uid()}`).set(as('owner')).send({ sell_paise: 1 }).expect(404);
  });

  it('replaces aliases and can archive a product', async () => {
    await request(api()).patch(`${base}/products/${SUGAR}`).set(as('owner'))
      .send({ aliases: ['shakkar', 'cheeni'] }).expect(200);
    expect(repo.products[0]!.aliases).toEqual(['shakkar', 'cheeni']);
    await request(api()).patch(`${base}/products/${SUGAR}`).set(as('owner')).send({ active: false }).expect(200);
    const list = await request(api()).get(`${base}/products`).set(as('owner')).expect(200);
    expect(list.body.products).toEqual([]);
  });
});

describe('receive stock', () => {
  const receive = (over: Record<string, unknown> = {}) => ({
    id: uid(), product_id: SUGAR, qty_milli: 25_000, cost_paise: 3800, expiry_date: '2027-03-01', ...over,
  });

  it('adds a batch and raises stock; a retry with the same id changes nothing', async () => {
    const body = receive();
    await request(api()).post(`${base}/stock/receive`).set(as('owner')).send(body).expect(201);
    expect(stockOf(SUGAR)).toBe(25_000);
    const again = await request(api()).post(`${base}/stock/receive`).set(as('owner')).send(body).expect(200);
    expect(again.body.duplicate).toBe(true);
    expect(stockOf(SUGAR)).toBe(25_000);
    expect(repo.batches).toHaveLength(1);
  });

  it('feeds the same batch into billing, so a sale draws it down', async () => {
    await request(api()).post(`${base}/stock/receive`).set(as('owner')).send(receive()).expect(201);
    await request(api()).post('/v1/bills').set(as('cashier')).send({
      id: uid(), store_id: STORE, payment_mode: 'cash', device_time: NOW.toISOString(),
      items: [{ product_id: SUGAR, qty_milli: 4000 }],
    }).expect(201);
    expect(stockOf(SUGAR)).toBe(21_000);
  });

  it('rejects stock that is already expired, a bad date, zero quantity and unknown products', async () => {
    await request(api()).post(`${base}/stock/receive`).set(as('owner')).send(receive({ expiry_date: '2026-11-08' })).expect(400)
      .expect((r) => expect(r.body.error).toBe('already_expired'));
    await request(api()).post(`${base}/stock/receive`).set(as('owner')).send(receive({ expiry_date: '2027-02-31' })).expect(400);
    await request(api()).post(`${base}/stock/receive`).set(as('owner')).send(receive({ qty_milli: 0 })).expect(400);
    await request(api()).post(`${base}/stock/receive`).set(as('owner')).send(receive({ product_id: uid() })).expect(404);
    expect(stockOf(SUGAR)).toBe(0);
  });

  it('accepts stock with no expiry date (loose goods)', async () => {
    await request(api()).post(`${base}/stock/receive`).set(as('owner')).send(receive({ expiry_date: null })).expect(201);
  });
});

describe('physical count', () => {
  const adjust = (over: Record<string, unknown> = {}) => ({ id: uid(), product_id: SUGAR, counted_milli: 0, ...over });
  beforeEach(async () => {
    await request(api()).post(`${base}/stock/receive`).set(as('owner'))
      .send({ id: uid(), product_id: SUGAR, qty_milli: 5000, cost_paise: 3800, expiry_date: '2026-12-01' }).expect(201);
    await request(api()).post(`${base}/stock/receive`).set(as('owner'))
      .send({ id: uid(), product_id: SUGAR, qty_milli: 10_000, cost_paise: 3900, expiry_date: '2027-06-01' }).expect(201);
  });

  it('writes the shortage against the earliest-expiring batch first', async () => {
    const res = await request(api()).post(`${base}/stock/adjust`).set(as('owner')).send(adjust({ counted_milli: 11_000 })).expect(201);
    expect(res.body).toMatchObject({ previous_milli: 15_000, delta_milli: -4000, applied: true });
    expect(stockOf(SUGAR)).toBe(11_000);
    const early = repo.batches.find((b) => b.expiryDate === '2026-12-01')!;
    const remaining = (await repo.getBatches(STORE, [SUGAR])).find((b) => b.batchId === early.batchId)!.remainingMilli;
    expect(remaining).toBe(1000);
  });

  it('records found stock without a batch', async () => {
    const res = await request(api()).post(`${base}/stock/adjust`).set(as('owner')).send(adjust({ counted_milli: 16_500 })).expect(201);
    expect(res.body.delta_milli).toBe(1500);
    expect(stockOf(SUGAR)).toBe(16_500);
    expect(repo.movements.at(-1)).toMatchObject({ batchId: null, delta: 1500, reason: 'adjust' });
  });

  it('does nothing when the count matches', async () => {
    const res = await request(api()).post(`${base}/stock/adjust`).set(as('owner')).send(adjust({ counted_milli: 15_000 })).expect(200);
    expect(res.body.applied).toBe(false);
    expect(repo.movements).toHaveLength(2);
  });

  it('is safe to retry and records the reason', async () => {
    const body = adjust({ counted_milli: 14_000, reason: 'damage' });
    await request(api()).post(`${base}/stock/adjust`).set(as('owner')).send(body).expect(201);
    await request(api()).post(`${base}/stock/adjust`).set(as('owner')).send(body).expect(200);
    expect(stockOf(SUGAR)).toBe(14_000);
    expect(repo.movements.at(-1)!.reason).toBe('damage');
  });

  it('refuses damage or expiry that would raise stock, and negative counts', async () => {
    await request(api()).post(`${base}/stock/adjust`).set(as('owner')).send(adjust({ counted_milli: 20_000, reason: 'damage' })).expect(400);
    await request(api()).post(`${base}/stock/adjust`).set(as('owner')).send(adjust({ counted_milli: -1 })).expect(400);
    expect(stockOf(SUGAR)).toBe(15_000);
  });

  it('can write everything off to zero', async () => {
    await request(api()).post(`${base}/stock/adjust`).set(as('owner')).send(adjust({ counted_milli: 0, reason: 'expired' })).expect(201);
    expect(stockOf(SUGAR)).toBe(0);
  });
});
