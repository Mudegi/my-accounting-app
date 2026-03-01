/**
 * Currency Utilities — format, convert, and manage currencies
 */
import { supabase } from './supabase';

export type Currency = {
  code: string;
  name: string;
  symbol: string;
  decimal_places: number;
};

export type ExchangeRate = {
  from_currency: string;
  to_currency: string;
  rate: number;
  effective_date: string;
};

// Cached currencies
let currencyCache: Currency[] = [];

/** Load all active currencies */
export async function loadCurrencies(): Promise<Currency[]> {
  if (currencyCache.length > 0) return currencyCache;
  const { data } = await supabase
    .from('currencies')
    .select('code, name, symbol, decimal_places')
    .eq('is_active', true)
    .order('code');
  if (data) currencyCache = data;
  return currencyCache;
}

/** Get a single currency by code */
export function getCurrency(code: string): Currency {
  const found = currencyCache.find((c) => c.code === code);
  return found || { code, name: code, symbol: code, decimal_places: 0 };
}

/** Format amount with currency symbol (e.g. "UGX 1,500,000" or "$1,500.00") */
export function formatCurrency(amount: number, currencyCode: string = 'UGX'): string {
  const cur = getCurrency(currencyCode);
  const dp = cur.decimal_places;
  const formatted = dp > 0
    ? amount.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp })
    : Math.round(amount).toLocaleString();
  return `${cur.symbol} ${formatted}`;
}

/** Short format for compact spaces (e.g. "1.5M", "250K") */
export function formatCurrencyCompact(amount: number, currencyCode: string = 'UGX'): string {
  const cur = getCurrency(currencyCode);
  let formatted: string;
  if (Math.abs(amount) >= 1_000_000) {
    formatted = (amount / 1_000_000).toFixed(1) + 'M';
  } else if (Math.abs(amount) >= 1_000) {
    formatted = (amount / 1_000).toFixed(1) + 'K';
  } else {
    formatted = amount.toLocaleString();
  }
  return `${cur.symbol} ${formatted}`;
}

/** Load exchange rate for a pair on a specific date */
export async function getExchangeRate(
  businessId: string,
  from: string,
  to: string,
  date?: string
): Promise<number | null> {
  if (from === to) return 1;
  const d = date || new Date().toISOString().split('T')[0];
  const { data } = await supabase
    .from('exchange_rates')
    .select('rate')
    .eq('business_id', businessId)
    .eq('from_currency', from)
    .eq('to_currency', to)
    .lte('effective_date', d)
    .order('effective_date', { ascending: false })
    .limit(1)
    .single();
  return data?.rate ?? null;
}

/** Convert an amount between currencies using stored rates */
export async function convertCurrency(
  businessId: string,
  amount: number,
  from: string,
  to: string,
  date?: string
): Promise<{ converted: number; rate: number } | null> {
  if (from === to) return { converted: amount, rate: 1 };

  // Try direct rate
  let rate = await getExchangeRate(businessId, from, to, date);
  if (rate !== null) {
    return { converted: amount * rate, rate };
  }

  // Try inverse rate
  const inverse = await getExchangeRate(businessId, to, from, date);
  if (inverse !== null && inverse > 0) {
    rate = 1 / inverse;
    return { converted: amount * rate, rate };
  }

  return null;
}

/** Save an exchange rate */
export async function saveExchangeRate(
  businessId: string,
  from: string,
  to: string,
  rate: number,
  date?: string
): Promise<{ error: any }> {
  const d = date || new Date().toISOString().split('T')[0];
  const { error } = await supabase
    .from('exchange_rates')
    .upsert({
      business_id: businessId,
      from_currency: from,
      to_currency: to,
      rate,
      effective_date: d,
    }, { onConflict: 'business_id,from_currency,to_currency,effective_date' });
  return { error };
}

// Common currencies list for quick pickers
export const POPULAR_CURRENCIES = ['UGX', 'KES', 'TZS', 'RWF', 'USD', 'EUR', 'GBP', 'NGN', 'GHS', 'ZAR'];
