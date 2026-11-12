import { z } from 'zod';
import { computeBill } from './cart.js';
import { istToday } from './dates.js';
import { HttpError } from './errors.js';
import { allocateFefo } from './fefo.js';
import type { CheckoutPayload, Repo } from './repo.js';

export const checkoutSchema = z.object({
  id: z.string().uuid(), // client-generated: the idempotency key
  store_id: z.string().uuid(),
  customer_id: z.string().uuid().nullish(),
  payment_mode: z.enum(['cash', 'upi', 'credit']),
  discount_paise: z.number().int().min(0).default(0),
  device_time: z.string().datetime(),
  items: z
    .array(
      z.object({
        product_id: z.string().uuid(),
        qty_milli: z.number().int().positive().max(100_000_000),
      }),
    )
    .min(1)
    .max(200),
});

export type CheckoutInput = z.infer<typeof checkoutSchema>;

/** Cashiers may discount up to 10% of the bill; larger discounts need the owner. */
const CASHIER_MAX_DISCOUNT_PCT = 10;

/**
 * Validate and price a bill. Prices, tax rates and stock come from the database; the client
 * only says what was sold. Nothing the client or an AI model sends can change a price.
 */
export async function checkout(
  repo: Repo,
  userId: string,
  raw: unknown,
  today: string = istToday(),
  now: Date = new Date(),
) {
  const input = checkoutSchema.parse(raw);

  const role = await repo.getRole(input.store_id, userId);
  if (!role) throw new HttpError(403, 'not_a_member', 'You do not belong to this store');

  // Merge repeated products so one product is priced and allocated once.
  const merged = new Map<string, number>();
  for (const it of input.items) {
    merged.set(it.product_id, (merged.get(it.product_id) ?? 0) + it.qty_milli);
  }
  const productIds = [...merged.keys()];

  const products = await repo.getProducts(input.store_id, productIds);
  const byId = new Map(products.map((p) => [p.id, p]));
  for (const id of productIds) {
    const p = byId.get(id);
    if (!p || !p.active) throw new HttpError(422, 'unknown_product', `Product ${id} is not available`);
  }

  if (input.payment_mode === 'credit') {
    if (!input.customer_id) {
      throw new HttpError(422, 'customer_required', 'Credit sales need a customer');
    }
    if (!(await repo.customerExists(input.store_id, input.customer_id))) {
      throw new HttpError(422, 'unknown_customer', 'Customer not found in this store');
    }
  }

  let totals;
  try {
    totals = computeBill(
      productIds.map((id) => ({
        productId: id,
        qtyMilli: merged.get(id)!,
        pricePaise: byId.get(id)!.sellPaise,
        gstRate: byId.get(id)!.gstRate,
      })),
      input.discount_paise,
    );
  } catch {
    throw new HttpError(422, 'invalid_discount', 'Discount is larger than the bill');
  }

  if (
    role === 'cashier' &&
    totals.discountPaise * 100 > totals.subtotalPaise * CASHIER_MAX_DISCOUNT_PCT
  ) {
    throw new HttpError(403, 'discount_needs_owner', 'This discount needs the owner');
  }

  const batches = await repo.getBatches(input.store_id, productIds);
  const movements = productIds.flatMap((id) =>
    allocateFefo(id, merged.get(id)!, batches, today).allocations.map((a) => ({
      product_id: a.productId,
      batch_id: a.batchId,
      qty_delta_milli: a.qtyDeltaMilli,
    })),
  );

  const payload: CheckoutPayload = {
    id: input.id,
    store_id: input.store_id,
    cashier_id: userId,
    customer_id: input.customer_id ?? null,
    subtotal_paise: totals.subtotalPaise,
    discount_paise: totals.discountPaise,
    tax_paise: totals.taxPaise,
    total_paise: totals.totalPaise,
    payment_mode: input.payment_mode,
    // A phone with a wrong clock must not push a bill into the future.
    device_time: Date.parse(input.device_time) > now.getTime() + 10 * 60_000 ? now.toISOString() : input.device_time,
    items: totals.lines.map((l) => ({
      product_id: l.productId,
      qty_milli: l.qtyMilli,
      price_paise: l.pricePaise,
      line_total_paise: l.lineTotalPaise,
      gst_rate: l.gstRate,
    })),
    movements,
  };

  const result = await repo.applyCheckout(payload);
  return { ...result, total_paise: totals.totalPaise, tax_paise: totals.taxPaise };
}
