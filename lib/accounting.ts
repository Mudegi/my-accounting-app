/**
 * Accounting Module — Double-Entry Bookkeeping
 * Chart of Accounts, Journal Entries, GL queries for reports
 *
 * Every financial transaction auto-posts balanced journal entries.
 * Reports (Trial Balance, P&L, Balance Sheet) read from the GL.
 */

import { supabase } from './supabase';

// ─── Account codes (must match seed_chart_of_accounts) ──────

export const ACC = {
  // Assets (1xxx)
  CASH:               '1000',
  MOBILE_MONEY:       '1010',
  BANK:               '1020',
  ACCOUNTS_RECEIVABLE:'1100',
  INVENTORY:          '1200',
  EQUIPMENT:          '1300',
  VAT_INPUT:          '1400',  // VAT paid on purchases (asset — claimable)

  // Liabilities (2xxx)
  ACCOUNTS_PAYABLE:   '2000',
  VAT_PAYABLE:        '2100',  // VAT collected on sales (liability — owed to URA)
  SALARIES_PAYABLE:   '2200',
  LOANS_PAYABLE:      '2300',

  // Equity (3xxx)
  OWNER_EQUITY:       '3000',
  RETAINED_EARNINGS:  '3100',

  // Revenue (4xxx)
  SALES_REVENUE:      '4000',
  SALES_DISCOUNT:     '4100',  // Contra-revenue
  SALES_RETURNS:      '4200',  // Contra-revenue
  OTHER_INCOME:       '4300',

  // Expenses (5xxx-6xxx)
  COGS:               '5000',
  PURCHASE_EXPENSE:   '5100',
  RENT:               '6000',
  ELECTRICITY:        '6010',
  WATER:              '6020',
  TRANSPORT:          '6030',
  COMMUNICATION:      '6040',
  SALARIES_WAGES:     '6050',
  SUPPLIES:           '6060',
  REPAIRS:            '6070',
  INSURANCE:          '6080',
  BANK_CHARGES:       '6090',
  TAXES_LICENSES:     '6100',
  DEPRECIATION:       '6200',
  MISC_EXPENSE:       '6300',
  STOCK_TRANSFERS:    '6400',  // Clearing account for inter-branch value movement
} as const;

// Map expense categories → account codes
export const EXPENSE_ACCOUNT_MAP: Record<string, string> = {
  'Rent':          ACC.RENT,
  'Electricity':   ACC.ELECTRICITY,
  'Water':         ACC.WATER,
  'Transport':     ACC.TRANSPORT,
  'Communication': ACC.COMMUNICATION,
  'Salaries':      ACC.SALARIES_WAGES,
  'Supplies':      ACC.SUPPLIES,
  'Repairs':       ACC.REPAIRS,
  'Insurance':     ACC.INSURANCE,
  'Bank Charges':  ACC.BANK_CHARGES,
  'Taxes':         ACC.TAXES_LICENSES,
  'Other':         ACC.MISC_EXPENSE,
};

// Map payment methods → asset/liability accounts
export const PAYMENT_ACCOUNT_MAP: Record<string, string> = {
  'cash':         ACC.CASH,
  'mobile_money': ACC.MOBILE_MONEY,
  'card':         ACC.BANK,
  'bank':         ACC.BANK,
  'credit':       ACC.ACCOUNTS_RECEIVABLE,
};

// Payment method options for UI pickers
export const PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'mobile_money', label: 'Mobile Money' },
  { value: 'bank', label: 'Bank Transfer' },
  { value: 'credit', label: 'Credit (On Account)' },
];

// ─── Helper: resolve account id from code ──────

async function getAccountIds(businessId: string, codes: string[]): Promise<Record<string, string>> {
  const { data } = await supabase
    .from('accounts')
    .select('id, code')
    .eq('business_id', businessId)
    .in('code', codes);

  const map: Record<string, string> = {};
  data?.forEach((a: any) => { map[a.code] = a.id; });
  return map;
}

// ─── Core: create journal entry with lines ──────

interface JournalLine {
  accountCode: string;
  debit?: number;
  credit?: number;
  description?: string;
}

async function postJournalEntry(
  businessId: string,
  branchId: string | null,
  referenceType: string,
  referenceId: string,
  description: string,
  lines: JournalLine[],
  userId?: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    // Validate: total debits must equal total credits
    const totalDebit = lines.reduce((s, l) => s + (l.debit || 0), 0);
    const totalCredit = lines.reduce((s, l) => s + (l.credit || 0), 0);
    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      console.error(`Journal entry unbalanced: DR ${totalDebit} ≠ CR ${totalCredit} for ${referenceType}/${referenceId}`);
      return { success: false, error: `Unbalanced entry: DR ${totalDebit} ≠ CR ${totalCredit}` };
    }

    // Resolve account IDs
    const codes = [...new Set(lines.map(l => l.accountCode))];
    let accountMap = await getAccountIds(businessId, codes);

    // Auto-seed if accounts missing
    const missing = codes.filter(c => !accountMap[c]);
    if (missing.length > 0) {
      await supabase.rpc('seed_chart_of_accounts', { p_business_id: businessId });
      const retryMap = await getAccountIds(businessId, missing);
      Object.assign(accountMap, retryMap);
      const stillMissing = missing.filter(c => !accountMap[c]);
      if (stillMissing.length > 0) {
        return { success: false, error: `Missing accounts: ${stillMissing.join(', ')}` };
      }
    }

    // Create journal entry header
    const { data: entry, error: entryErr } = await supabase
      .from('journal_entries')
      .insert({
        business_id: businessId,
        branch_id: branchId,
        reference_type: referenceType,
        reference_id: referenceId,
        description,
        is_auto: true,
        created_by: userId,
      })
      .select()
      .single();

    if (entryErr) return { success: false, error: entryErr.message };

    // Create journal entry lines (skip zero amounts)
    const entryLines = lines
      .filter(l => (l.debit || 0) > 0 || (l.credit || 0) > 0)
      .map(l => ({
        journal_entry_id: entry.id,
        account_id: accountMap[l.accountCode],
        debit: Math.round((l.debit || 0) * 100) / 100,
        credit: Math.round((l.credit || 0) * 100) / 100,
        description: l.description || '',
      }));

    const { error: linesErr } = await supabase
      .from('journal_entry_lines')
      .insert(entryLines);

    if (linesErr) return { success: false, error: linesErr.message };

    return { success: true };
  } catch (e: any) {
    console.error('postJournalEntry error:', e);
    return { success: false, error: e.message };
  }
}

// ════════════════════════════════════════════════════════════
// AUTO-POST: SALE
// ════════════════════════════════════════════════════════════
// DR Payment Acct      totalAmount (what customer pays)
// DR Sales Discount    discountAmount (contra-revenue)
// CR Sales Revenue     subtotal (gross revenue before discount)
// CR VAT Payable       taxAmount (output VAT)
// DR COGS              costOfGoods
// CR Inventory         costOfGoods
//
// Balance check:
//   totalAmount = subtotal - discountAmount + taxAmount
//   DR = totalAmount + discountAmount + costOfGoods
//      = subtotal + taxAmount + costOfGoods
//   CR = subtotal + taxAmount + costOfGoods  ✓ BALANCED

export async function postSaleEntry(params: {
  businessId: string;
  branchId: string;
  saleId: string;
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  costOfGoods: number;
  discountAmount?: number;
  paymentMethod: string;
  userId?: string;
}) {
  const { businessId, branchId, saleId, subtotal, taxAmount, totalAmount,
          costOfGoods, discountAmount = 0, paymentMethod, userId } = params;
  const payAcct = PAYMENT_ACCOUNT_MAP[paymentMethod] || ACC.CASH;

  const lines: JournalLine[] = [
    { accountCode: payAcct, debit: totalAmount, description: 'Payment received' },
    { accountCode: ACC.SALES_REVENUE, credit: subtotal, description: 'Sales revenue (gross)' },
  ];

  if (taxAmount > 0) {
    lines.push({ accountCode: ACC.VAT_PAYABLE, credit: taxAmount, description: 'Output VAT collected' });
  }

  if (discountAmount > 0) {
    lines.push({ accountCode: ACC.SALES_DISCOUNT, debit: discountAmount, description: 'Discount given' });
  }

  if (costOfGoods > 0) {
    lines.push({ accountCode: ACC.COGS, debit: costOfGoods, description: 'Cost of goods sold' });
    lines.push({ accountCode: ACC.INVENTORY, credit: costOfGoods, description: 'Inventory reduced' });
  }

  return postJournalEntry(businessId, branchId, 'sale', saleId, `Sale #${saleId.slice(0, 8)}`, lines, userId);
}

// ════════════════════════════════════════════════════════════
// AUTO-POST: PURCHASE / STOCK-IN
// ════════════════════════════════════════════════════════════
// With VAT:
//   DR Inventory        netAmount (excl. VAT)
//   DR VAT Input        vatAmount (claimable from URA)
//   CR Payment Acct     grossAmount
// Without VAT:
//   DR Inventory        totalCost
//   CR Payment Acct     totalCost

export async function postPurchaseEntry(params: {
  businessId: string;
  branchId: string;
  purchaseId: string;
  totalCost: number;
  vatAmount?: number;
  paymentMethod?: string;
  userId?: string;
}) {
  const { businessId, branchId, purchaseId, totalCost, vatAmount = 0, paymentMethod = 'cash', userId } = params;
  // For credit purchases, credit Accounts Payable (we owe the supplier)
  // For cash/momo/bank purchases, credit the payment asset account
  const payAcct = paymentMethod === 'credit'
    ? ACC.ACCOUNTS_PAYABLE
    : (PAYMENT_ACCOUNT_MAP[paymentMethod] || ACC.CASH);

  const netCost = totalCost - vatAmount;

  const lines: JournalLine[] = [
    { accountCode: ACC.INVENTORY, debit: netCost, description: 'Stock received' },
    { accountCode: payAcct, credit: totalCost, description: 'Payment for stock' },
  ];

  if (vatAmount > 0) {
    lines.push({ accountCode: ACC.VAT_INPUT, debit: vatAmount, description: 'Input VAT on purchase' });
  }

  return postJournalEntry(businessId, branchId, 'purchase', purchaseId, `Purchase #${purchaseId.slice(0, 8)}`, lines, userId);
}

// ════════════════════════════════════════════════════════════
// AUTO-POST: SUPPLIER PAYMENT (pay down Accounts Payable)
// ════════════════════════════════════════════════════════════
// DR Accounts Payable   amount (reduce what we owe)
// CR Cash/MoMo/Bank     amount (asset goes down)

export async function postSupplierPaymentEntry(params: {
  businessId: string;
  branchId: string | null;
  paymentId: string;
  amount: number;
  supplierName: string;
  paymentMethod: string;
  userId?: string;
}) {
  const { businessId, branchId, paymentId, amount, supplierName, paymentMethod, userId } = params;
  const payAcct = PAYMENT_ACCOUNT_MAP[paymentMethod] || ACC.CASH;

  const lines: JournalLine[] = [
    { accountCode: ACC.ACCOUNTS_PAYABLE, debit: amount, description: `Payable cleared - ${supplierName}` },
    { accountCode: payAcct, credit: amount, description: `Payment to supplier (${paymentMethod})` },
  ];

  return postJournalEntry(businessId, branchId, 'supplier_payment', paymentId, `Supplier payment: ${supplierName}`, lines, userId);
}

// ════════════════════════════════════════════════════════════
// AUTO-POST: CUSTOMER PAYMENT (Receivable reduction)
// ════════════════════════════════════════════════════════════
// DR Cash/MoMo/Bank     amount (asset goes up)
// CR Accounts Receivable amount (asset goes down)

export async function postCustomerPaymentEntry(params: {
  businessId: string;
  branchId: string | null;
  paymentId: string;
  amount: number;
  customerName: string;
  paymentMethod: string;
  userId?: string;
}) {
  const { businessId, branchId, paymentId, amount, customerName, paymentMethod, userId } = params;
  const payAcct = PAYMENT_ACCOUNT_MAP[paymentMethod] || ACC.CASH;

  const lines: JournalLine[] = [
    { accountCode: payAcct, debit: amount, description: `Payment from customer (${paymentMethod})` },
    { accountCode: ACC.ACCOUNTS_RECEIVABLE, credit: amount, description: `Receivable cleared - ${customerName}` },
  ];

  return postJournalEntry(businessId, branchId, 'customer_payment', paymentId, `Customer payment: ${customerName}`, lines, userId);
}

// ════════════════════════════════════════════════════════════
// AUTO-POST: STOCK TRANSFER (Inter-branch movement)
// ════════════════════════════════════════════════════════════
// At Source Branch (Sender):
//   DR Stock Transfers (6400)   value
//   CR Inventory (1200)         value
//
// At Destination Branch (Receiver):
//   DR Inventory (1200)         value
//   CR Stock Transfers (6400)   value
//
// The 'Stock Transfers' account acts as a clearing account. 
// If it has a balance, it means stock is "In Transit".

export async function postStockTransferEntry(params: {
  businessId: string;
  branchId: string;
  transferId: string;
  value: number;
  type: 'send' | 'receive';
  otherBranchName: string;
  userId?: string;
}) {
  const { businessId, branchId, transferId, value, type, otherBranchName, userId } = params;

  const lines: JournalLine[] = type === 'send' 
    ? [
        { accountCode: ACC.STOCK_TRANSFERS, debit: value, description: `Stock sent to ${otherBranchName}` },
        { accountCode: ACC.INVENTORY, credit: value, description: `Inventory removed (transfer out)` },
      ]
    : [
        { accountCode: ACC.INVENTORY, debit: value, description: `Inventory added (transfer in)` },
        { accountCode: ACC.STOCK_TRANSFERS, credit: value, description: `Stock received from ${otherBranchName}` },
      ];

  return postJournalEntry(businessId, branchId, 'stock_transfer', transferId, `Transfer ${type}: ${otherBranchName}`, lines, userId);
}

// ════════════════════════════════════════════════════════════
// AUTO-POST: EXPENSE
// ════════════════════════════════════════════════════════════

export async function postExpenseEntry(params: {
  businessId: string;
  branchId: string | null;
  expenseId: string;
  amount: number;
  category: string;
  description: string;
  paymentMethod?: string;
  userId?: string;
}) {
  const { businessId, branchId, expenseId, amount, category, description, paymentMethod = 'cash', userId } = params;
  const expenseAcct = EXPENSE_ACCOUNT_MAP[category] || ACC.MISC_EXPENSE;
  const payAcct = PAYMENT_ACCOUNT_MAP[paymentMethod] || ACC.CASH;

  const lines: JournalLine[] = [
    { accountCode: expenseAcct, debit: amount, description },
    { accountCode: payAcct, credit: amount, description: `Paid: ${description}` },
  ];

  return postJournalEntry(businessId, branchId, 'expense', expenseId, `Expense: ${description}`, lines, userId);
}

// ════════════════════════════════════════════════════════════
// AUTO-POST: CREDIT NOTE / RETURNS
// ════════════════════════════════════════════════════════════

export async function postCreditNoteEntry(params: {
  businessId: string;
  branchId: string;
  creditNoteId: string;
  totalAmount: number;
  taxAmount?: number;
  costOfGoods?: number;
  paymentMethod?: string;
  userId?: string;
}) {
  const { businessId, branchId, creditNoteId, totalAmount, taxAmount = 0, costOfGoods = 0, paymentMethod = 'cash', userId } = params;
  const payAcct = PAYMENT_ACCOUNT_MAP[paymentMethod] || ACC.CASH;

  // totalAmount is gross (incl. tax). Net return = totalAmount - taxAmount
  const netReturn = totalAmount - taxAmount;

  const lines: JournalLine[] = [
    { accountCode: ACC.SALES_RETURNS, debit: netReturn, description: 'Customer return (net of VAT)' },
    { accountCode: payAcct, credit: totalAmount, description: 'Refund issued' },
  ];

  // Reverse the output VAT that was originally collected
  if (taxAmount > 0) {
    lines.push({ accountCode: ACC.VAT_PAYABLE, debit: taxAmount, description: 'Output VAT reversed on return' });
  }

  if (costOfGoods > 0) {
    lines.push({ accountCode: ACC.INVENTORY, debit: costOfGoods, description: 'Stock returned' });
    lines.push({ accountCode: ACC.COGS, credit: costOfGoods, description: 'COGS reversed' });
  }

  return postJournalEntry(businessId, branchId, 'credit_note', creditNoteId, `Credit Note #${creditNoteId.slice(0, 8)}`, lines, userId);
}

// ════════════════════════════════════════════════════════════
// GL QUERIES — for Trial Balance, P&L, Balance Sheet
// ════════════════════════════════════════════════════════════

export type AccountBalance = {
  account_id: string;
  code: string;
  name: string;
  account_type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  total_debit: number;
  total_credit: number;
  balance: number;
};

/**
 * Fetch Trial Balance — all account balances
 */
export async function getTrialBalance(params: {
  businessId: string;
  branchId?: string | null;
  fromDate?: string;
  toDate?: string;
}): Promise<AccountBalance[]> {
  const { businessId, branchId, fromDate, toDate } = params;

  const { data: accounts } = await supabase
    .from('accounts')
    .select('id, code, name, account_type')
    .eq('business_id', businessId)
    .eq('is_active', true)
    .order('code');

  if (!accounts || accounts.length === 0) return [];

  let jeQuery = supabase
    .from('journal_entries')
    .select('id')
    .eq('business_id', businessId);

  if (branchId) jeQuery = jeQuery.eq('branch_id', branchId);
  if (fromDate) jeQuery = jeQuery.gte('entry_date', fromDate);
  if (toDate) jeQuery = jeQuery.lte('entry_date', toDate);

  const { data: entries } = await jeQuery;
  if (!entries || entries.length === 0) {
    return accounts.map(a => ({
      account_id: a.id, code: a.code, name: a.name, account_type: a.account_type,
      total_debit: 0, total_credit: 0, balance: 0,
    }));
  }

  const entryIds = entries.map(e => e.id);
  const allLines: any[] = [];
  for (let i = 0; i < entryIds.length; i += 100) {
    const chunk = entryIds.slice(i, i + 100);
    const { data: lines } = await supabase
      .from('journal_entry_lines')
      .select('account_id, debit, credit')
      .in('journal_entry_id', chunk);
    if (lines) allLines.push(...lines);
  }

  const totals: Record<string, { debit: number; credit: number }> = {};
  allLines.forEach(line => {
    if (!totals[line.account_id]) totals[line.account_id] = { debit: 0, credit: 0 };
    totals[line.account_id].debit += Number(line.debit) || 0;
    totals[line.account_id].credit += Number(line.credit) || 0;
  });

  return accounts.map(a => {
    const t = totals[a.id] || { debit: 0, credit: 0 };
    const isDebitNormal = a.account_type === 'asset' || a.account_type === 'expense';
    const balance = isDebitNormal ? t.debit - t.credit : t.credit - t.debit;

    return {
      account_id: a.id, code: a.code, name: a.name, account_type: a.account_type,
      total_debit: Math.round(t.debit * 100) / 100,
      total_credit: Math.round(t.credit * 100) / 100,
      balance: Math.round(balance * 100) / 100,
    };
  }).filter(a => a.total_debit > 0 || a.total_credit > 0);
}

export function computePnL(trialBalance: AccountBalance[]) {
  let grossRevenue = 0, salesDiscount = 0, salesReturns = 0, otherIncome = 0, cogs = 0;
  const operatingExpenses: { name: string; amount: number }[] = [];
  let totalOpEx = 0;

  trialBalance.forEach(a => {
    switch (a.code) {
      case ACC.SALES_REVENUE: grossRevenue = a.balance; break;
      case ACC.SALES_DISCOUNT: salesDiscount = a.balance; break;
      case ACC.SALES_RETURNS: salesReturns = a.balance; break;
      case ACC.OTHER_INCOME: otherIncome = a.balance; break;
      case ACC.COGS: cogs = a.balance; break;
      default:
        if (a.account_type === 'expense' && a.code !== ACC.COGS && a.balance !== 0) {
          operatingExpenses.push({ name: a.name, amount: a.balance });
          totalOpEx += a.balance;
        }
    }
  });

  const netRevenue = grossRevenue - salesDiscount - salesReturns;
  const grossProfit = netRevenue - cogs;
  const netProfit = grossProfit + otherIncome - totalOpEx;

  return { grossRevenue, salesDiscount, salesReturns, netRevenue, cogs, grossProfit,
           otherIncome, operatingExpenses, totalOperatingExpenses: totalOpEx, netProfit };
}

export function computeBalanceSheet(trialBalance: AccountBalance[]) {
  const assets: { name: string; code: string; amount: number }[] = [];
  const liabilities: { name: string; code: string; amount: number }[] = [];
  const equity: { name: string; code: string; amount: number }[] = [];
  let totalAssets = 0, totalLiabilities = 0, totalEquity = 0;

  trialBalance.forEach(a => {
    if (a.balance === 0) return;
    switch (a.account_type) {
      case 'asset':
        assets.push({ name: a.name, code: a.code, amount: a.balance });
        totalAssets += a.balance; break;
      case 'liability':
        liabilities.push({ name: a.name, code: a.code, amount: a.balance });
        totalLiabilities += a.balance; break;
      case 'equity':
        equity.push({ name: a.name, code: a.code, amount: a.balance });
        totalEquity += a.balance; break;
    }
  });

  const pnl = computePnL(trialBalance);
  if (pnl.netProfit !== 0) {
    equity.push({ name: 'Current Period Profit', code: 'P&L', amount: pnl.netProfit });
    totalEquity += pnl.netProfit;
  }

  return { assets, liabilities, equity,
           totalAssets: Math.round(totalAssets), totalLiabilities: Math.round(totalLiabilities),
           totalEquity: Math.round(totalEquity),
           isBalanced: Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 1 };
}

export function computeVatSummary(trialBalance: AccountBalance[]) {
  const outputVat = trialBalance.find(a => a.code === ACC.VAT_PAYABLE)?.balance || 0;
  const inputVat = trialBalance.find(a => a.code === ACC.VAT_INPUT)?.balance || 0;
  return { outputVat, inputVat, netPayable: outputVat - inputVat };
}

export async function ensureChartOfAccounts(businessId: string) {
  const { count } = await supabase
    .from('accounts')
    .select('*', { count: 'exact', head: true })
    .eq('business_id', businessId);
  if (!count || count === 0) {
    await supabase.rpc('seed_chart_of_accounts', { p_business_id: businessId });
  }
}
