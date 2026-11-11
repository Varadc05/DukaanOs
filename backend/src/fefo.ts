export interface BatchStock {
  batchId: string;
  productId: string;
  expiryDate: string | null; // YYYY-MM-DD
  receivedAt: string;
  remainingMilli: number;
}

export interface Allocation {
  productId: string;
  batchId: string | null; // null = no batch covered it (negative stock, flagged)
  qtyDeltaMilli: number; // negative for a sale
}

/**
 * First-expiry-first-out. Expired batches are skipped (they should be written off, not sold).
 * Any shortfall goes to a null batch so a late-synced sale is never rejected.
 */
export function allocateFefo(
  productId: string,
  qtyMilli: number,
  batches: BatchStock[],
  today: string,
): { allocations: Allocation[]; shortfallMilli: number } {
  const usable = batches
    .filter((b) => b.productId === productId && b.remainingMilli > 0)
    .filter((b) => b.expiryDate === null || b.expiryDate >= today)
    .sort((a, b) => {
      if (a.expiryDate !== b.expiryDate) {
        if (a.expiryDate === null) return 1;
        if (b.expiryDate === null) return -1;
        return a.expiryDate < b.expiryDate ? -1 : 1;
      }
      return a.receivedAt < b.receivedAt ? -1 : 1;
    });

  const allocations: Allocation[] = [];
  let need = qtyMilli;
  for (const b of usable) {
    if (need <= 0) break;
    const take = Math.min(need, b.remainingMilli);
    allocations.push({ productId, batchId: b.batchId, qtyDeltaMilli: -take });
    need -= take;
  }
  if (need > 0) allocations.push({ productId, batchId: null, qtyDeltaMilli: -need });
  return { allocations, shortfallMilli: Math.max(0, need) };
}
