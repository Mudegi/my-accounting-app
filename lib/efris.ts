/**
 * EFRIS Integration Client
 * Handles all communication with the external EFRIS middleware API
 * Only active when business.is_efris_enabled === true
 */

const TIMEOUT_MS = 30000;

// ─── Types ───────────────────────────────────────────────────────

export type EfrisConfig = {
  apiKey: string;
  apiUrl: string;
  testMode: boolean;
};

export type EfrisProductPayload = {
  item_code: string;
  item_name: string;
  unit_price: string;
  commodity_code: string;
  unit_of_measure?: string;
  have_excise_tax?: string;
  excise_duty_code?: string;
  stock_quantity?: string;
  stock_prewarning?: string;
  description?: string;
  is_service?: boolean;
};

export type EfrisStockIncreasePayload = {
  goodsStockIn: {
    operationType: string;
    supplierName: string;
    supplierTin: string;
    stockInType: string;
    stockInDate: string;
    remarks?: string;
    goodsTypeCode: string;
  };
  goodsStockInItem: Array<{
    goodsCode: string;
    quantity: string;
    unitPrice: string;
    remarks?: string;
  }>;
};

// Simple-format item: middleware handles all EFRIS complexity
export type EfrisSimpleItem = {
  item_name: string;
  item_code: string;
  quantity: number;
  unit_price: number;        // tax-inclusive price
  tax_rate: number;          // 18 = Standard, 0 = Zero-Rated, -1 = Exempt
  discount?: number;         // positive gross discount amount (optional)
  unit_of_measure?: string;  // EFRIS unit code (default "101")
  goods_category_id?: string;
};

export type EfrisInvoicePayload = {
  format: 'simple';
  invoice_number: string;
  invoice_date: string;
  customer_name: string;
  customer_tin?: string;
  buyer_type: string;
  payment_method: string;
  currency?: string;
  items: EfrisSimpleItem[];
};

export type EfrisCreditNotePayload = {
  credit_note_number: string;
  credit_note_date: string;
  original_invoice_number: string;
  original_fdn: string;
  oriInvoiceId: string;
  oriInvoiceNo: string;
  customer_name: string;
  customer_tin?: string;
  reason: string;
  currency: string;
  items: Array<{
    item_name: string;
    item_code: string;
    quantity: number;
    unit_price: number;
    tax_rate: number;
    commodity_code?: string;
  }>;
};

export type CommodityCategory = {
  commodityCategoryCode: string;
  commodityCategoryName: string;
  commodityName: string;
  rate: string;
  isLeafNode: string;
  serviceMark: string;
};

// ─── API Client ──────────────────────────────────────────────────

async function efrisFetch(
  method: 'GET' | 'POST',
  endpoint: string,
  apiKey: string,
  body?: any,
  baseUrl?: string
): Promise<any> {
  const base = baseUrl || 'https://efrisintegration.nafacademy.com/api/external/efris';
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const headers: Record<string, string> = { 'X-API-Key': apiKey };
    if (method === 'POST') headers['Content-Type'] = 'application/json';

    const response = await fetch(`${base}${endpoint}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error('EFRIS API key is invalid. Check your EFRIS settings.');
      }
      const text = await response.text();
      throw new Error(`EFRIS error (${response.status}): ${text}`);
    }

    return await response.json();
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('EFRIS server is not responding. Please try again.');
    }
    throw error;
  }
}

// Retry wrapper (NOT for invoices — only for reads/product registration)
async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  const delays = [0, 2000, 5000];
  for (let i = 0; i < maxRetries; i++) {
    try {
      if (delays[i]) await new Promise((r) => setTimeout(r, delays[i]));
      return await fn();
    } catch (error: any) {
      if (i === maxRetries - 1) throw error;
    }
  }
  throw new Error('EFRIS service unavailable');
}

// ─── 1. Product Registration (T130) ─────────────────────────────

export async function registerProduct(
  config: EfrisConfig,
  payload: EfrisProductPayload
): Promise<{ success: boolean; product_code?: string; error?: string }> {
  return withRetry(async () => {
    const result = await efrisFetch('POST', '/register-product', config.apiKey, payload, config.apiUrl);
    return result;
  });
}

// ─── 2. Stock Increase (T131) ─────────────────────────────────────

export async function submitStockIncrease(
  config: EfrisConfig,
  payload: EfrisStockIncreasePayload
): Promise<{ success: boolean; message?: string; error?: string }> {
  return withRetry(async () => {
    return await efrisFetch('POST', '/stock-increase', config.apiKey, payload, config.apiUrl);
  });
}

// ─── 3. Invoice Fiscalization (T109) ─────────────────────────────
// NO retry — could create duplicates

export async function fiscalizeInvoice(
  config: EfrisConfig,
  payload: EfrisInvoicePayload
): Promise<{
  success: boolean;
  fdn?: string;
  verification_code?: string;
  qr_code?: string;
  invoice_number?: string;
  fiscalized_at?: string;
  error?: string;
  fullEfrisResponse?: any;
  [key: string]: any;
}> {
  return await efrisFetch('POST', '/submit-invoice', config.apiKey, payload, config.apiUrl);
}

// ─── 4. Credit Note (T110) ──────────────────────────────────────
// NO retry

export async function submitCreditNote(
  config: EfrisConfig,
  payload: EfrisCreditNotePayload
): Promise<{
  success: boolean;
  referenceNo?: string;
  verification_code?: string;
  qr_code?: string;
  error?: string;
}> {
  return await efrisFetch('POST', '/submit-credit-note', config.apiKey, payload, config.apiUrl);
}

// ─── 5. Stock Decrease ──────────────────────────────────────────

export async function submitStockDecrease(
  config: EfrisConfig,
  payload: any
): Promise<{ success: boolean; message?: string; error?: string }> {
  return withRetry(async () => {
    return await efrisFetch('POST', '/stock-decrease', config.apiKey, payload, config.apiUrl);
  });
}

// ─── 6. Test Connection ──────────────────────────────────────────

export async function testEfrisConnection(apiKey: string, apiUrl?: string): Promise<boolean> {
  try {
    await efrisFetch('GET', '/invoices?page=1&limit=1', apiKey, undefined, apiUrl);
    return true;
  } catch {
    return false;
  }
}

// ─── Helper: Build Invoice Payload (Simple Format) ──────────────

export function buildInvoicePayload(
  invoiceNumber: string,
  sale: {
    customer_name?: string;
    customer_tin?: string;
    buyer_type: string;
    payment_method: string;
    total_amount: number;
    global_discount?: number; // extra discount applied to items without per-item discount (net-based)
  },
  items: Array<{
    name: string;
    efris_item_code: string;
    quantity: number;
    unit_price: number;        // NET (tax-exclusive) price from sale_items
    discount_amount?: number;  // per-item NET discount (from sale_items.discount_amount)
    unit_code: string;
    commodity_code: string;
    commodity_name: string;
    tax_category_code: string;
  }>
): EfrisInvoicePayload {
  const today = new Date().toISOString().split('T')[0];

  // Tax rates by category
  const taxRateMap: Record<string, number> = {
    '01': 0.18, '02': 0, '03': 0, '04': 0.18, '05': 0,
    '06': 0.12, '07': 0, '08': 0.06, '09': 0, '10': 0, '11': 0,
  };

  // Simple-format tax_rate: 18 for Standard, 0 for Zero-Rated, -1 for Exempt
  const getSimpleTaxRate = (catCode: string): number => {
    if (catCode === '03') return -1;   // Exempt
    const rate = taxRateMap[catCode] ?? 0.18;
    if (rate === 0) return 0;          // Zero-Rated
    return Math.round(rate * 100);     // 0.18 → 18, 0.12 → 12, 0.06 → 6
  };

  // Global discount: distribute proportionally across items WITHOUT a per-item discount
  const globalDiscount = sale.global_discount || 0;
  const eligibleNetTotals = items.map((item) =>
    (item.discount_amount && item.discount_amount > 0) ? 0 : item.unit_price * item.quantity
  );
  const eligibleSum = eligibleNetTotals.reduce((a, b) => a + b, 0);

  const simpleItems: EfrisSimpleItem[] = items.map((item, idx) => {
    const rate = taxRateMap[item.tax_category_code] ?? 0.18;

    // Gross (tax-inclusive) unit price: net × (1 + rate)
    const grossUnitPrice = rate > 0
      ? Math.round(item.unit_price * (1 + rate) * 100) / 100
      : item.unit_price;

    // Per-item discount takes priority; otherwise distribute global discount
    let netDiscount = 0;
    if (item.discount_amount && item.discount_amount > 0) {
      netDiscount = item.discount_amount;
    } else if (globalDiscount > 0 && eligibleSum > 0) {
      netDiscount = (eligibleNetTotals[idx] / eligibleSum) * globalDiscount;
    }

    // Gross up discount: net discount × (1 + rate) to match tax-inclusive pricing
    const grossDiscount = netDiscount > 0
      ? (rate > 0
          ? Math.round(netDiscount * (1 + rate) * 100) / 100
          : Math.round(netDiscount * 100) / 100)
      : 0;

    const result: EfrisSimpleItem = {
      item_name: item.name,
      item_code: item.efris_item_code,
      quantity: item.quantity,
      unit_price: grossUnitPrice,
      tax_rate: getSimpleTaxRate(item.tax_category_code),
      unit_of_measure: item.unit_code || '101',
    };

    if (item.commodity_code) {
      result.goods_category_id = item.commodity_code;
    }
    if (grossDiscount > 0) {
      result.discount = grossDiscount;
    }

    return result;
  });

  return {
    format: 'simple',
    invoice_number: invoiceNumber,
    invoice_date: today,
    customer_name: sale.customer_name || 'Walk-in Customer',
    customer_tin: sale.buyer_type === '0' ? sale.customer_tin : undefined,
    buyer_type: sale.buyer_type || '1',
    payment_method: sale.payment_method || '101',
    items: simpleItems,
  };
}

// ─── EFRIS Unit Code Mapping ─────────────────────────────────────

// EFRIS only has 9 unit codes (T115). Most countable items → 101 (Stick).
export const EFRIS_UNIT_MAP: Record<string, string> = {
  // Friendly names → EFRIS code
  piece: '101', kg: '103', litre: '102', box: '101',
  pair: '101', dozen: '101', metre: '101', bag: '101',
  gram: '109', set: '101', roll: '101', carton: '101',
  each: '101', ream: '101',
  // EFRIS native codes → themselves (for products stored with EFRIS code directly)
  '101': '101', '102': '102', '103': '103', '104': '104',
  '105': '105', '106': '106', '107': '107', '108': '108', '109': '109',
};

// All 9 EFRIS T115 units for product form dropdown
export const EFRIS_UNITS = [
  { code: '101', label: 'Stick (Piece/Unit/Each)' },
  { code: '102', label: 'Litre' },
  { code: '103', label: 'Kg' },
  { code: '109', label: 'Gram (g)' },
  { code: '107', label: '50 Kgs (Bag)' },
  { code: '106', label: '1000 Sticks' },
  { code: '105', label: 'Minute' },
  { code: '104', label: 'User per day' },
  { code: '108', label: 'Other (-)' },
];

export const EFRIS_PAYMENT_METHODS = [
  { code: '101', label: 'Cash' },
  { code: '102', label: 'Credit' },
  { code: '103', label: 'Cheque' },
  { code: '104', label: 'Mobile Money' },
  { code: '105', label: 'Visa/MasterCard' },
];

export const EFRIS_BUYER_TYPES = [
  { code: '0', label: 'B2B (Business)' },
  { code: '1', label: 'B2C (Individual)' },
  { code: '2', label: 'Foreigner' },
  { code: '3', label: 'B2G (Government)' },
];

export const EFRIS_CREDIT_REASONS = [
  { code: 'GOODS_RETURNED', label: 'Goods Returned' },
  { code: 'DISCOUNT', label: 'Post-sale Discount' },
  { code: 'PRICE_ADJUSTMENT', label: 'Price Adjustment' },
  { code: 'CANCELLATION', label: 'Invoice Cancelled' },
  { code: 'DAMAGED_GOODS', label: 'Damaged Goods' },
  { code: 'OTHER', label: 'Other' },
];

export const EFRIS_TAX_CATEGORIES = [
  { code: '01', label: 'Standard 18%', rate: 0.18 },
  { code: '02', label: 'Zero Rated', rate: 0 },
  { code: '03', label: 'Exempt', rate: 0 },
  { code: '04', label: 'Deemed 18%', rate: 0.18 },
  { code: '05', label: 'Excise Duty', rate: 0 },
  { code: '06', label: 'OTT Service 12%', rate: 0.12 },
  { code: '07', label: 'Stamp Duty', rate: 0 },
  { code: '08', label: 'Hotel Tax 6%', rate: 0.06 },
  { code: '09', label: 'UCC Levy', rate: 0 },
  { code: '10', label: 'Others', rate: 0 },
  { code: '11', label: 'Out of Scope', rate: 0 },
];
