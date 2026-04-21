import { supabase } from './supabase';
import { printStatement, shareStatementPdf, type StatementData, type StatementEntry } from './statements';

/**
 * Fetches the current outstanding credit balance for a customer.
 */
export async function fetchCustomerBalance(businessId: string, customerId: string | null, customerName: string | null) {
  // 1. Total credit sales
  let salesQuery = supabase
    .from('sales')
    .select('total_amount')
    .eq('business_id', businessId)
    .eq('payment_method', 'credit')
    .eq('status', 'completed');

  if (customerId) {
    salesQuery = salesQuery.eq('customer_id', customerId);
  } else {
    salesQuery = salesQuery.is('customer_id', null).eq('customer_name', customerName);
  }

  const { data: sales } = await salesQuery;
  const totalSales = (sales || []).reduce((sum, s) => sum + Number(s.total_amount), 0);

  // 2. Total payments
  let payQuery = supabase
    .from('debt_payments')
    .select('amount')
    .eq('business_id', businessId);

  if (customerId) {
    payQuery = payQuery.eq('customer_id', customerId);
  } else {
    payQuery = payQuery.is('customer_id', null).eq('customer_name', customerName);
  }

  const { data: pays } = await payQuery;
  const totalPays = (pays || []).reduce((sum, p) => sum + Number(p.amount), 0);

  return totalSales - totalPays;
}

/**
 * Fetches the detailed transaction history for a customer, including items.
 */
export async function fetchDetailedHistory(businessId: string, customerId: string | null, customerName: string | null) {
  let query = supabase
    .from('sales')
    .select(`
      id,
      total_amount,
      payment_method,
      created_at,
      sale_items (
        product_name,
        quantity,
        unit_price,
        line_total
      )
    `)
    .eq('business_id', businessId)
    .order('created_at', { ascending: false });

  if (customerId) {
    query = query.eq('customer_id', customerId);
  } else {
    query = query.is('customer_id', null).eq('customer_name', customerName);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

/**
 * Reusable statement generation logic.
 */
export async function fetchCustomerStatement(
  businessId: string, 
  customerId: string | null, 
  customerName: string | null,
  startDate: Date,
  endDate: Date
) {
  const startISO = startDate.toISOString();
  const endISO = endDate.toISOString();

  // Opening Balance
  let salesBeforeQuery = supabase.from('sales').select('total_amount').eq('business_id', businessId).eq('payment_method', 'credit').eq('status', 'completed').lt('created_at', startISO);
  let payBeforeQuery = supabase.from('debt_payments').select('amount').eq('business_id', businessId).lt('created_at', startISO);

  if (customerId) {
    salesBeforeQuery = salesBeforeQuery.eq('customer_id', customerId);
    payBeforeQuery = payBeforeQuery.eq('customer_id', customerId);
  } else {
    salesBeforeQuery = salesBeforeQuery.is('customer_id', null).eq('customer_name', customerName);
    payBeforeQuery = payBeforeQuery.is('customer_id', null);
  }

  const [{ data: oldSales }, { data: oldPays }] = await Promise.all([salesBeforeQuery, payBeforeQuery]);
  const openingBalance = (oldSales || []).reduce((s, x) => s + Number(x.total_amount), 0) - (oldPays || []).reduce((s, x) => s + Number(x.amount), 0);

  // Period Transactions
  let salesPeriodQuery = supabase.from('sales').select('id, total_amount, created_at, sale_items(product_name, quantity)').eq('business_id', businessId).eq('payment_method', 'credit').eq('status', 'completed').gte('created_at', startISO).lte('created_at', endISO);
  let payPeriodQuery = supabase.from('debt_payments').select('id, amount, created_at, note').eq('business_id', businessId).gte('created_at', startISO).lte('created_at', endISO);

  if (customerId) {
    salesPeriodQuery = salesPeriodQuery.eq('customer_id', customerId);
    payPeriodQuery = payPeriodQuery.eq('customer_id', customerId);
  } else {
    salesPeriodQuery = salesPeriodQuery.is('customer_id', null).eq('customer_name', customerName);
    payPeriodQuery = payPeriodQuery.is('customer_id', null);
  }

  const [{ data: periodSales }, { data: periodPays }] = await Promise.all([salesPeriodQuery, payPeriodQuery]);

  const ledger: StatementEntry[] = [
    ...(periodSales || []).map(s => ({
      date: s.created_at,
      type: 'sale' as const,
      description: `Credit Sale #${s.id.slice(0, 8)}`,
      debit: Number(s.total_amount),
      credit: 0,
      balance: 0,
      items: (s.sale_items as any[] || []).map(i => `${i.quantity}x ${i.product_name}`).join(', '),
    })),
    ...(periodPays || []).map(p => ({
      date: p.created_at,
      type: 'payment' as const,
      description: p.note ? `Payment: ${p.note}` : 'Debt Payment',
      debit: 0,
      credit: Number(p.amount),
      balance: 0,
    }))
  ].sort((a, b) => a.date.localeCompare(b.date));

  let current = openingBalance;
  ledger.forEach(entry => {
    current = current + entry.debit - entry.credit;
    entry.balance = current;
  });

  return { openingBalance, ledger };
}
