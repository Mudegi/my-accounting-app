-- ============================================
-- Accounting Module Migration
-- Chart of Accounts, General Ledger, Journal Entries
-- Run this in Supabase SQL Editor
-- ============================================

-- 1. CHART OF ACCOUNTS (Standard for Uganda small businesses)
CREATE TABLE IF NOT EXISTS accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES businesses(id) ON DELETE CASCADE,
  code text NOT NULL,               -- e.g. '1000', '4000'
  name text NOT NULL,               -- e.g. 'Cash', 'Sales Revenue'
  account_type text NOT NULL CHECK (account_type IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
  parent_id uuid REFERENCES accounts(id),
  is_system boolean DEFAULT false,  -- true = auto-created, cannot delete
  is_active boolean DEFAULT true,
  description text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(business_id, code)
);

-- 2. JOURNAL ENTRIES (header)
CREATE TABLE IF NOT EXISTS journal_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES branches(id),
  entry_date date NOT NULL DEFAULT CURRENT_DATE,
  reference_type text,              -- 'sale', 'purchase', 'expense', 'credit_note', 'manual'
  reference_id uuid,                -- links to sales.id, purchases.id, etc.
  description text NOT NULL,
  is_auto boolean DEFAULT true,     -- true = system-generated (basic mode)
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now()
);

-- 3. JOURNAL ENTRY LINES (debit/credit)
CREATE TABLE IF NOT EXISTS journal_entry_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_entry_id uuid REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_id uuid REFERENCES accounts(id),
  debit numeric(15,2) DEFAULT 0,
  credit numeric(15,2) DEFAULT 0,
  description text,
  created_at timestamptz DEFAULT now()
);

-- RLS
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entry_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own accounts" ON accounts FOR SELECT
  USING (business_id IN (SELECT business_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Admins can insert accounts" ON accounts FOR INSERT
  WITH CHECK (business_id IN (SELECT business_id FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'branch_manager')));
CREATE POLICY "Admins can update accounts" ON accounts FOR UPDATE
  USING (business_id IN (SELECT business_id FROM profiles WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Users can view journal entries" ON journal_entries FOR SELECT
  USING (business_id IN (SELECT business_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Users can insert journal entries" ON journal_entries FOR INSERT
  WITH CHECK (business_id IN (SELECT business_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can view journal lines" ON journal_entry_lines FOR SELECT
  USING (journal_entry_id IN (SELECT id FROM journal_entries WHERE business_id IN (SELECT business_id FROM profiles WHERE id = auth.uid())));
CREATE POLICY "Users can insert journal lines" ON journal_entry_lines FOR INSERT
  WITH CHECK (journal_entry_id IN (SELECT id FROM journal_entries WHERE business_id IN (SELECT business_id FROM profiles WHERE id = auth.uid())));

-- INDEXES
CREATE INDEX idx_accounts_business ON accounts(business_id);
CREATE INDEX idx_journal_entries_business ON journal_entries(business_id);
CREATE INDEX idx_journal_entries_ref ON journal_entries(reference_type, reference_id);
CREATE INDEX idx_journal_lines_entry ON journal_entry_lines(journal_entry_id);
CREATE INDEX idx_journal_lines_account ON journal_entry_lines(account_id);

-- ============================================
-- SEED: Default Chart of Accounts
-- This function creates standard accounts for a business
-- ============================================
CREATE OR REPLACE FUNCTION seed_chart_of_accounts(p_business_id UUID)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  -- ASSETS (1xxx)
  INSERT INTO accounts (business_id, code, name, account_type, is_system, description) VALUES
    (p_business_id, '1000', 'Cash', 'asset', true, 'Cash on hand and in registers'),
    (p_business_id, '1010', 'Mobile Money', 'asset', true, 'MTN MoMo, Airtel Money'),
    (p_business_id, '1020', 'Bank Account', 'asset', true, 'Business bank account'),
    (p_business_id, '1100', 'Accounts Receivable', 'asset', true, 'Money owed by customers'),
    (p_business_id, '1200', 'Inventory', 'asset', true, 'Stock on hand (valued at AVCO)'),
    (p_business_id, '1300', 'Equipment', 'asset', true, 'POS machines, computers, etc.'),
    (p_business_id, '1310', 'Furniture & Fixtures', 'asset', true, 'Shelves, displays, counters');

  -- LIABILITIES (2xxx)
  INSERT INTO accounts (business_id, code, name, account_type, is_system, description) VALUES
    (p_business_id, '2000', 'Accounts Payable', 'liability', true, 'Money owed to suppliers'),
    (p_business_id, '2100', 'VAT Payable', 'liability', true, 'VAT collected, owed to URA'),
    (p_business_id, '2200', 'Salaries Payable', 'liability', true, 'Employee wages owed'),
    (p_business_id, '2300', 'Loans Payable', 'liability', true, 'Bank or SACCO loans');

  -- EQUITY (3xxx)
  INSERT INTO accounts (business_id, code, name, account_type, is_system, description) VALUES
    (p_business_id, '3000', 'Owner Equity', 'equity', true, 'Owner investment / capital'),
    (p_business_id, '3100', 'Retained Earnings', 'equity', true, 'Accumulated profits');

  -- REVENUE (4xxx)
  INSERT INTO accounts (business_id, code, name, account_type, is_system, description) VALUES
    (p_business_id, '4000', 'Sales Revenue', 'revenue', true, 'Income from product sales'),
    (p_business_id, '4100', 'Sales Discount', 'revenue', true, 'Discounts given to customers'),
    (p_business_id, '4200', 'Sales Returns', 'revenue', true, 'Credit notes / returns'),
    (p_business_id, '4300', 'Other Income', 'revenue', true, 'Miscellaneous income');

  -- EXPENSES (5xxx-6xxx)
  INSERT INTO accounts (business_id, code, name, account_type, is_system, description) VALUES
    (p_business_id, '5000', 'Cost of Goods Sold', 'expense', true, 'Direct cost of items sold'),
    (p_business_id, '5100', 'Purchase Expenses', 'expense', true, 'Cost of purchasing stock'),
    (p_business_id, '6000', 'Rent', 'expense', true, 'Shop / premises rent'),
    (p_business_id, '6010', 'Electricity', 'expense', true, 'UMEME / power bills'),
    (p_business_id, '6020', 'Water', 'expense', true, 'NWSC water bills'),
    (p_business_id, '6030', 'Transport', 'expense', true, 'Delivery, boda, fuel'),
    (p_business_id, '6040', 'Communication', 'expense', true, 'Airtime, data, internet'),
    (p_business_id, '6050', 'Salaries & Wages', 'expense', true, 'Employee compensation'),
    (p_business_id, '6060', 'Supplies', 'expense', true, 'Office and shop supplies'),
    (p_business_id, '6070', 'Repairs & Maintenance', 'expense', true, 'Equipment repairs'),
    (p_business_id, '6080', 'Insurance', 'expense', true, 'Business insurance'),
    (p_business_id, '6090', 'Bank Charges', 'expense', true, 'Bank fees'),
    (p_business_id, '6100', 'Taxes & Licenses', 'expense', true, 'Trading licenses, URA'),
    (p_business_id, '6200', 'Depreciation', 'expense', true, 'Asset depreciation'),
    (p_business_id, '6300', 'Miscellaneous Expense', 'expense', true, 'Other expenses');

  -- No error if accounts already exist (unique constraint on business_id, code)
  -- ON CONFLICT is handled by IF NOT EXISTS on the table
END;
$$;
