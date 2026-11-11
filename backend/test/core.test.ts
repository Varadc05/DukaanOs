import { describe, expect, it } from 'vitest';
import { computeBill } from '../src/cart.js';
import { allocateFefo } from '../src/fefo.js';
import { matchProduct, type CatalogueProduct } from '../src/matcher.js';
import { convertQty, inclusiveTaxPaise, lineTotalPaise, toMilli } from '../src/money.js';
import { parseVoiceText } from '../src/parser.js';

describe('money', () => {
  it('prices loose quantities exactly in paise', () => {
    expect(lineTotalPaise(4500, toMilli(0.5))).toBe(2250); // 0.5 kg at 45.00
    expect(lineTotalPaise(4500, toMilli(2.25))).toBe(10125);
  });
  it('extracts GST from an inclusive price', () => {
    expect(inclusiveTaxPaise(10500, 5)).toBe(500);
    expect(inclusiveTaxPaise(11800, 18)).toBe(1800);
    expect(inclusiveTaxPaise(10000, 0)).toBe(0);
  });
  it('converts spoken units to product units', () => {
    expect(convertQty(500, 'g', 'kg')).toBe(0.5);
    expect(convertQty(250, 'ml', 'l')).toBe(0.25);
    expect(convertQty(1, 'kg', 'l')).toBeNull();
  });
});

describe('computeBill', () => {
  it('totals lines and shares a discount so tax is on the paid amount', () => {
    const bill = computeBill(
      [
        { productId: 'a', qtyMilli: 1000, pricePaise: 10500, gstRate: 5 },
        { productId: 'b', qtyMilli: 2000, pricePaise: 5900, gstRate: 18 },
      ],
      2230,
    );
    expect(bill.subtotalPaise).toBe(22300);
    expect(bill.totalPaise).toBe(20070);
    // discount split 10% each: tax(9450@5%)=450, tax(10620@18%)=1620
    expect(bill.taxPaise).toBe(450 + 1620);
  });
  it('rejects a discount larger than the bill and an empty cart', () => {
    expect(() =>
      computeBill([{ productId: 'a', qtyMilli: 1000, pricePaise: 1000, gstRate: 0 }], 1001),
    ).toThrow();
    expect(() => computeBill([], 0)).toThrow();
  });
  it('total always equals subtotal minus discount', () => {
    for (let d = 0; d <= 3333; d += 111) {
      const b = computeBill(
        [
          { productId: 'a', qtyMilli: 333, pricePaise: 1234, gstRate: 12 },
          { productId: 'b', qtyMilli: 1500, pricePaise: 999, gstRate: 5 },
          { productId: 'c', qtyMilli: 7000, pricePaise: 321, gstRate: 0 },
        ],
        d,
      );
      expect(b.totalPaise).toBe(b.subtotalPaise - d);
    }
  });
});

describe('parseVoiceText', () => {
  it('reads English and Hinglish phrases', () => {
    expect(parseVoiceText('2 kg sugar').items).toEqual([
      { query: 'sugar', qty: 2, unit: 'kg', confidence: 'high' },
    ]);
    expect(parseVoiceText('do kilo chini').items[0]).toMatchObject({ query: 'chini', qty: 2, unit: 'kg' });
    expect(parseVoiceText('aadha kilo chai patti').items[0]).toMatchObject({
      query: 'chai patti',
      qty: 0.5,
      unit: 'kg',
    });
    expect(parseVoiceText('dedh litre doodh').items[0]).toMatchObject({ qty: 1.5, unit: 'l' });
  });
  it('splits several items and handles "de do"', () => {
    const r = parseVoiceText('2 kg sugar aur 1 packet maggi, 500 gram atta');
    expect(r.items.map((i) => i.query)).toEqual(['sugar', 'maggi', 'atta']);
    expect(r.items[2]).toMatchObject({ qty: 500, unit: 'g' });
    expect(parseVoiceText('chini de do').items[0]).toMatchObject({ query: 'chini', qty: 1 });
  });
  it('reads Devanagari words and digits', () => {
    expect(parseVoiceText('दो किलो चीनी').items[0]).toMatchObject({ query: 'चीनी', qty: 2, unit: 'kg' });
    expect(parseVoiceText('२ किलो आटा').items[0]).toMatchObject({ qty: 2, unit: 'kg' });
  });
  it('converts dozens to pieces and defaults quantity to 1', () => {
    expect(parseVoiceText('1 dozen eggs').items[0]).toMatchObject({ qty: 12, unit: 'pc' });
    expect(parseVoiceText('maggi').items[0]).toMatchObject({ qty: 1, confidence: 'medium' });
  });
  it('flags what it cannot read instead of guessing', () => {
    expect(parseVoiceText('5').unparsed.length).toBe(1);
    expect(parseVoiceText('').items).toEqual([]);
  });
});

const catalogue: CatalogueProduct[] = [
  { id: 'sugar', name: 'Sugar', barcode: null, unit: 'kg', sellPaise: 4500, gstRate: 5, aliases: ['chini', 'शक्कर'] },
  { id: 'oil', name: 'Fortune Sunflower Oil 1L', barcode: null, unit: 'pc', sellPaise: 15000, gstRate: 5, aliases: ['sunflower oil', 'tel'] },
  { id: 'oil2', name: 'Saffola Gold Oil 1L', barcode: null, unit: 'pc', sellPaise: 21000, gstRate: 5, aliases: [] },
  { id: 'maggi', name: 'Maggi Noodles', barcode: null, unit: 'pack', sellPaise: 1400, gstRate: 12, aliases: ['maggi'] },
];

describe('matchProduct', () => {
  it('auto-matches exact names and aliases', () => {
    expect(matchProduct('sugar', catalogue)).toMatchObject({ decision: 'auto' });
    expect(matchProduct('chini', catalogue).candidates[0]?.productId).toBe('sugar');
    expect(matchProduct('maggi', catalogue).decision).toBe('auto');
  });
  it('tolerates spelling errors but asks for confirmation when unsure', () => {
    const r = matchProduct('sunflowr oil', catalogue);
    expect(r.candidates[0]?.productId).toBe('oil');
    const vague = matchProduct('oil', catalogue);
    expect(vague.decision).toBe('confirm');
    expect(vague.candidates.length).toBeGreaterThan(1);
  });
  it('returns none for unknown items', () => {
    expect(matchProduct('xylophone', catalogue)).toEqual({ decision: 'none', candidates: [] });
  });
});

describe('allocateFefo', () => {
  const batches = [
    { batchId: 'late', productId: 'p', expiryDate: '2027-06-01', receivedAt: '2026-10-01', remainingMilli: 5000 },
    { batchId: 'soon', productId: 'p', expiryDate: '2026-12-01', receivedAt: '2026-10-05', remainingMilli: 2000 },
    { batchId: 'none', productId: 'p', expiryDate: null, receivedAt: '2026-09-01', remainingMilli: 1000 },
    { batchId: 'expired', productId: 'p', expiryDate: '2026-10-01', receivedAt: '2026-08-01', remainingMilli: 9000 },
  ];
  it('takes the earliest expiry first and skips expired stock', () => {
    const { allocations, shortfallMilli } = allocateFefo('p', 3000, batches, '2026-11-09');
    expect(allocations).toEqual([
      { productId: 'p', batchId: 'soon', qtyDeltaMilli: -2000 },
      { productId: 'p', batchId: 'late', qtyDeltaMilli: -1000 },
    ]);
    expect(shortfallMilli).toBe(0);
  });
  it('records a shortfall as negative stock instead of rejecting the sale', () => {
    const { allocations, shortfallMilli } = allocateFefo('p', 9000, batches, '2026-11-09');
    expect(shortfallMilli).toBe(1000);
    expect(allocations.at(-1)).toEqual({ productId: 'p', batchId: null, qtyDeltaMilli: -1000 });
    expect(allocations.reduce((s, a) => s + a.qtyDeltaMilli, 0)).toBe(-9000);
  });
});
