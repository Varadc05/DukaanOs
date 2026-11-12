import type { BatchStock, Allocation } from './fefo.js';
import type { CatalogueProduct } from './matcher.js';
import type { DailySale, InventoryRow } from './insights.js';

export interface DayTotal {
  day: string;
  totalPaise: number;
  bills: number;
}

export type Role = 'owner' | 'cashier';

export interface CheckoutPayload {
  id: string;
  store_id: string;
  cashier_id: string;
  customer_id: string | null;
  subtotal_paise: number;
  discount_paise: number;
  tax_paise: number;
  total_paise: number;
  payment_mode: 'cash' | 'upi' | 'credit';
  device_time: string;
  items: {
    product_id: string;
    qty_milli: number;
    price_paise: number;
    line_total_paise: number;
    gst_rate: number;
  }[];
  movements: { product_id: string; batch_id: string | null; qty_delta_milli: number }[];
}

export interface NewProduct {
  name: string;
  barcode: string | null;
  unit: string;
  packSizeMilli: number;
  gstRate: number;
  mrpPaise: number;
  sellPaise: number;
  aliases: string[];
}

export type ProductPatch = Partial<Omit<NewProduct, 'aliases'>> & { active?: boolean; aliases?: string[] };

/** One atomic stock change: optionally a new batch, plus ledger rows. `id` is the idempotency key. */
export interface StockChangePayload {
  id: string;
  store_id: string;
  user_id: string;
  batch: {
    product_id: string;
    expiry_date: string | null;
    cost_paise: number;
    qty_received_milli: number;
  } | null;
  movements: {
    product_id: string;
    batch_id: string | null;
    qty_delta_milli: number;
    reason: 'purchase' | 'adjust' | 'damage' | 'expired';
  }[];
}

/** Everything the business logic needs from storage. Swappable: Supabase in prod, memory in tests. */
export interface Repo {
  getRole(storeId: string, userId: string): Promise<Role | null>;
  listCatalogue(storeId: string): Promise<CatalogueProduct[]>;
  getProducts(storeId: string, ids: string[]): Promise<(CatalogueProduct & { active: boolean })[]>;
  getBatches(storeId: string, productIds: string[]): Promise<BatchStock[]>;
  customerExists(storeId: string, customerId: string): Promise<boolean>;
  applyCheckout(payload: CheckoutPayload): Promise<{ id: string; duplicate: boolean }>;
  getInventory(storeId: string): Promise<InventoryRow[]>;
  getDailySales(storeId: string, sinceDay: string): Promise<DailySale[]>;
  getDayTotals(storeId: string, sinceDay: string): Promise<DayTotal[]>;
  /** Throws HttpError 409 duplicate_barcode / duplicate_alias. */
  createProduct(storeId: string, p: NewProduct): Promise<{ id: string }>;
  /** Returns false when the product is not in this store. Throws 409 like createProduct. */
  updateProduct(storeId: string, id: string, patch: ProductPatch): Promise<boolean>;
  applyStockChange(payload: StockChangePayload): Promise<{ id: string; duplicate: boolean }>;
}

export type { Allocation };
