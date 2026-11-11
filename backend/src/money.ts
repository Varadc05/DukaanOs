// All money is integer paise. All quantities are integer thousandths (qty_milli).
// Never use floating point for stored amounts.

export const toMilli = (qty: number): number => Math.round(qty * 1000);

/** Line total for a per-unit price and a quantity in thousandths, rounded half up. */
export function lineTotalPaise(pricePaise: number, qtyMilli: number): number {
  return Math.round((pricePaise * qtyMilli) / 1000);
}

/** Tax contained in a GST-inclusive amount (kirana prices are MRP-inclusive). */
export function inclusiveTaxPaise(amountPaise: number, gstRate: number): number {
  if (gstRate === 0) return 0;
  return Math.round((amountPaise * gstRate) / (100 + gstRate));
}

export const formatRupees = (paise: number): string => {
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(paise);
  return `${sign}₹${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
};

export type BaseUnit = 'pc' | 'kg' | 'g' | 'l' | 'ml' | 'pack';

const FACTORS: Record<string, Record<string, number>> = {
  kg: { kg: 1, g: 0.001 },
  g: { g: 1, kg: 1000 },
  l: { l: 1, ml: 0.001 },
  ml: { ml: 1, l: 1000 },
  pc: { pc: 1, dozen: 12 },
  pack: { pack: 1, pc: 1 },
};

/** Convert a spoken quantity into the product's own unit. Returns null if incompatible. */
export function convertQty(qty: number, from: string, to: string): number | null {
  if (from === to) return qty;
  const factor = FACTORS[to]?.[from];
  return factor === undefined ? null : qty * factor;
}

/** "2 kg", "0.5 kg", "12 pc" for human-readable reasons. */
export function formatQtyMilli(qtyMilli: number, unit: string): string {
  const n = qtyMilli / 1000;
  const text = Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  return `${text} ${unit}`;
}
