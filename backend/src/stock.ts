import { z } from 'zod';
import { istToday } from './dates.js';
import { HttpError } from './errors.js';
import { allocateFefo } from './fefo.js';
import type { NewProduct, ProductPatch, Repo, StockChangePayload } from './repo.js';

const MAX_QTY_MILLI = 1_000_000_000;
const MAX_PAISE = 10_000_000; // Rs 1,00,000 per unit is already absurd for a kirana item

const uuid = z.string().uuid();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const text = (max: number) => z.string().trim().min(1).max(max);

const productFields = {
  name: text(80),
  barcode: z.string().trim().min(4).max(32).nullish(),
  unit: z.enum(['pc', 'kg', 'g', 'l', 'ml', 'pack']),
  pack_size_milli: z.number().int().min(1).max(MAX_QTY_MILLI),
  gst_rate: z.union([z.literal(0), z.literal(5), z.literal(12), z.literal(18), z.literal(28)]),
  mrp_paise: z.number().int().min(0).max(MAX_PAISE),
  sell_paise: z.number().int().min(0).max(MAX_PAISE),
  aliases: z.array(z.string().trim().toLowerCase().min(1).max(40)).max(20),
};

export const newProductSchema = z.object({
  name: productFields.name,
  barcode: productFields.barcode,
  unit: productFields.unit,
  pack_size_milli: productFields.pack_size_milli.default(1000),
  gst_rate: productFields.gst_rate.default(0),
  mrp_paise: productFields.mrp_paise,
  sell_paise: productFields.sell_paise,
  aliases: productFields.aliases.default([]),
});

export const patchProductSchema = z
  .object({
    name: productFields.name,
    barcode: productFields.barcode,
    // No `unit` here on purpose: changing kg to g would silently multiply every stock figure by 1000.
    pack_size_milli: productFields.pack_size_milli,
    gst_rate: productFields.gst_rate,
    mrp_paise: productFields.mrp_paise,
    sell_paise: productFields.sell_paise,
    aliases: productFields.aliases,
    active: z.boolean(),
  })
  .partial()
  .refine((o) => Object.keys(o).length > 0, 'Nothing to change');

export const receiveSchema = z.object({
  id: uuid, // client-generated idempotency key, becomes the batch id
  product_id: uuid,
  qty_milli: z.number().int().min(1).max(MAX_QTY_MILLI),
  cost_paise: z.number().int().min(0).max(MAX_PAISE),
  expiry_date: day.nullish(),
});

export const adjustSchema = z.object({
  id: uuid,
  product_id: uuid,
  counted_milli: z.number().int().min(0).max(MAX_QTY_MILLI),
  reason: z.enum(['adjust', 'damage', 'expired']).default('adjust'),
});

export async function requireOwner(repo: Repo, storeId: string, userId: string) {
  const role = await repo.getRole(storeId, userId);
  if (!role) throw new HttpError(403, 'not_a_member', 'You do not belong to this store');
  if (role !== 'owner') throw new HttpError(403, 'owner_only', 'Only the owner can do this');
}

/** MRP is a legal ceiling in India. A selling price above it is a mistake, not a choice. */
function checkMrp(mrpPaise: number, sellPaise: number) {
  if (mrpPaise > 0 && sellPaise > mrpPaise) {
    throw new HttpError(400, 'sell_above_mrp', 'Selling price cannot be above MRP');
  }
}

const cleanAliases = (a: string[]) => [...new Set(a)];

export async function createProduct(repo: Repo, storeId: string, userId: string, raw: unknown) {
  await requireOwner(repo, storeId, userId);
  const b = newProductSchema.parse(raw);
  checkMrp(b.mrp_paise, b.sell_paise);
  const p: NewProduct = {
    name: b.name,
    barcode: b.barcode ?? null,
    unit: b.unit,
    packSizeMilli: b.pack_size_milli,
    gstRate: b.gst_rate,
    mrpPaise: b.mrp_paise,
    sellPaise: b.sell_paise,
    aliases: cleanAliases(b.aliases),
  };
  return repo.createProduct(storeId, p);
}

export async function updateProduct(repo: Repo, storeId: string, userId: string, productId: string, raw: unknown) {
  await requireOwner(repo, storeId, userId);
  uuid.parse(productId);
  const b = patchProductSchema.parse(raw);
  const [current] = await repo.getProducts(storeId, [productId]);
  if (!current) throw new HttpError(404, 'product_not_found', 'Product not found');
  checkMrp(b.mrp_paise ?? current.mrpPaise ?? 0, b.sell_paise ?? current.sellPaise);
  const patch: ProductPatch = {};
  if (b.name !== undefined) patch.name = b.name;
  if (b.barcode !== undefined) patch.barcode = b.barcode;
  if (b.pack_size_milli !== undefined) patch.packSizeMilli = b.pack_size_milli;
  if (b.gst_rate !== undefined) patch.gstRate = b.gst_rate;
  if (b.mrp_paise !== undefined) patch.mrpPaise = b.mrp_paise;
  if (b.sell_paise !== undefined) patch.sellPaise = b.sell_paise;
  if (b.active === false) {
    // Archived products drop out of the stock value, so cash would silently vanish from the books.
    const row = (await repo.getInventory(storeId)).find((r) => r.productId === productId);
    if (row && row.qtyMilli !== 0) {
      throw new HttpError(409, 'has_stock', 'Count the stock down to zero before archiving this product');
    }
  }
  if (b.active !== undefined) patch.active = b.active;
  if (b.aliases !== undefined) patch.aliases = cleanAliases(b.aliases);
  if (!(await repo.updateProduct(storeId, productId, patch))) {
    throw new HttpError(404, 'product_not_found', 'Product not found');
  }
  return { id: productId };
}

async function activeProduct(repo: Repo, storeId: string, productId: string) {
  const [p] = await repo.getProducts(storeId, [productId]);
  if (!p || !p.active) throw new HttpError(404, 'product_not_found', 'Product not found');
  return p;
}

/** Goods arrive: one new batch plus a +qty ledger row, written together. */
export async function receiveStock(
  repo: Repo,
  storeId: string,
  userId: string,
  raw: unknown,
  today: string = istToday(),
) {
  await requireOwner(repo, storeId, userId);
  const b = receiveSchema.parse(raw);
  await activeProduct(repo, storeId, b.product_id);
  if (b.expiry_date) {
    const parsed = new Date(`${b.expiry_date}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== b.expiry_date) {
      throw new HttpError(400, 'bad_date', 'Expiry date is not a real date');
    }
    if (b.expiry_date < today) {
      throw new HttpError(400, 'already_expired', 'This stock is already past its expiry date');
    }
  }
  const payload: StockChangePayload = {
    id: b.id,
    store_id: storeId,
    user_id: userId,
    batch: {
      product_id: b.product_id,
      expiry_date: b.expiry_date ?? null,
      cost_paise: b.cost_paise,
      qty_received_milli: b.qty_milli,
    },
    movements: [{ product_id: b.product_id, batch_id: b.id, qty_delta_milli: b.qty_milli, reason: 'purchase' }],
  };
  const r = await repo.applyStockChange(payload);
  return { id: r.id, duplicate: r.duplicate };
}

/**
 * Physical count: the owner says how much is really on the shelf; we write the difference.
 * Shortages are taken from batches first-expiry-first (expired ones included, so a write-off
 * clears the stock that is actually bad). Found stock has no batch and no cost.
 */
export async function adjustStock(repo: Repo, storeId: string, userId: string, raw: unknown) {
  await requireOwner(repo, storeId, userId);
  const b = adjustSchema.parse(raw);
  await activeProduct(repo, storeId, b.product_id);
  const inv = (await repo.getInventory(storeId)).find((r) => r.productId === b.product_id);
  const previous = inv?.qtyMilli ?? 0;
  const delta = b.counted_milli - previous;
  if (delta === 0) {
    return { id: b.id, duplicate: false, applied: false, previous_milli: previous, delta_milli: 0 };
  }
  if (delta > 0 && b.reason !== 'adjust') {
    throw new HttpError(400, 'bad_adjustment', 'Damage or expiry can only reduce stock');
  }
  const movements: StockChangePayload['movements'] = [];
  if (delta > 0) {
    movements.push({ product_id: b.product_id, batch_id: null, qty_delta_milli: delta, reason: 'adjust' });
  } else {
    const batches = await repo.getBatches(storeId, [b.product_id]);
    const { allocations } = allocateFefo(b.product_id, -delta, batches, '0000-01-01');
    for (const a of allocations) {
      movements.push({ product_id: a.productId, batch_id: a.batchId, qty_delta_milli: a.qtyDeltaMilli, reason: b.reason });
    }
  }
  const r = await repo.applyStockChange({ id: b.id, store_id: storeId, user_id: userId, batch: null, movements });
  return { id: r.id, duplicate: r.duplicate, applied: !r.duplicate, previous_milli: previous, delta_milli: delta };
}

