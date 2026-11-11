import { inclusiveTaxPaise, lineTotalPaise } from './money.js';

export interface CartLineInput {
  productId: string;
  qtyMilli: number;
  pricePaise: number; // from the database, never from the client
  gstRate: number;
}

export interface BillLine extends CartLineInput {
  lineTotalPaise: number;
}

export interface BillTotals {
  lines: BillLine[];
  subtotalPaise: number;
  discountPaise: number;
  taxPaise: number;
  totalPaise: number;
}

/**
 * Totals for a bill. The discount is shared across lines in proportion to their value
 * (remainder to the last line) so GST is computed on what the customer actually pays.
 */
export function computeBill(inputs: CartLineInput[], discountPaise: number): BillTotals {
  if (inputs.length === 0) throw new Error('empty cart');
  const lines: BillLine[] = inputs.map((l) => ({
    ...l,
    lineTotalPaise: lineTotalPaise(l.pricePaise, l.qtyMilli),
  }));
  const subtotal = lines.reduce((s, l) => s + l.lineTotalPaise, 0);
  if (discountPaise < 0 || discountPaise > subtotal) throw new Error('invalid discount');

  let remaining = discountPaise;
  let tax = 0;
  lines.forEach((l, i) => {
    const share =
      i === lines.length - 1
        ? remaining
        : Math.min(remaining, Math.round((l.lineTotalPaise * discountPaise) / (subtotal || 1)));
    remaining -= share;
    tax += inclusiveTaxPaise(l.lineTotalPaise - share, l.gstRate);
  });

  return {
    lines,
    subtotalPaise: subtotal,
    discountPaise,
    taxPaise: tax,
    totalPaise: subtotal - discountPaise,
  };
}
