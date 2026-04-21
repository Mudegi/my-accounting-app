/**
 * Currency Utilities — format, convert, and manage currencies
 */
import { supabase } from './supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';

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

// ─── Real-time Exchange Rates (API) ───

const RATE_CACHE_KEY = 'currency_rates_cache_';
const CACHE_TTL = 3600 * 1000 * 24; // 24 hours

export async function fetchLiveRates(baseCurrency: string = 'UGX'): Promise<Record<string, number>> {
  try {
    // Check cache
    const cached = await AsyncStorage.getItem(RATE_CACHE_KEY + baseCurrency);
    if (cached) {
      const { rates, timestamp } = JSON.parse(cached);
      if (Date.now() - timestamp < CACHE_TTL) {
        return rates;
      }
    }

    // Fetch new rates (ExchangeRate-API v6 Open Endpoint)
    console.log(`[Currency] Fetching live rates for ${baseCurrency}...`);
    const resp = await fetch(`https://open.er-api.com/v6/latest/${baseCurrency}`);
    const data = await resp.json();

    if (data.result === 'success') {
      const rates = data.rates;
      await AsyncStorage.setItem(RATE_CACHE_KEY + baseCurrency, JSON.stringify({
        rates,
        timestamp: Date.now()
      }));
      return rates;
    }
    throw new Error(data['error-type'] || 'Failed to fetch rates');
  } catch (e) {
    console.error('Rate fetch error:', e);
    // Fallback to old cache if available even if expired, or return empty
    const old = await AsyncStorage.getItem(RATE_CACHE_KEY + baseCurrency);
    return old ? JSON.parse(old).rates : {};
  }
}

/** Get exchange rate from base to target (Live API first, then DB fallback) */
export async function getExchangeRate(
  businessId: string,
  from: string,
  to: string,
): Promise<number> {
  if (from === to) return 1;

  // 1. Try real-time API
  const rates = await fetchLiveRates(from);
  if (rates[to]) return rates[to];

  // 2. Try DB fallback
  const { data } = await supabase
    .from('exchange_rates')
    .select('rate')
    .eq('business_id', businessId)
    .eq('from_currency', from)
    .eq('to_currency', to)
    .order('effective_date', { ascending: false })
    .limit(1)
    .single();

  if (data?.rate) return data.rate;

  // 3. Try inverse DB fallback
  const { data: inv } = await supabase
    .from('exchange_rates')
    .select('rate')
    .eq('business_id', businessId)
    .eq('from_currency', to)
    .eq('to_currency', from)
    .order('effective_date', { ascending: false })
    .limit(1)
    .single();

  if (inv?.rate) return 1 / inv.rate;

  return 1; // Last resort
}

/** Convert amount between currencies using best available rate */
export async function convertCurrency(
  businessId: string,
  amount: number,
  from: string,
  to: string,
): Promise<{ converted: number; rate: number }> {
  if (from === to) return { converted: amount, rate: 1 };
  const rate = await getExchangeRate(businessId, from, to);
  return { converted: amount * rate, rate };
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
