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
}

export type { Allocation };
