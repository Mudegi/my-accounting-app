-- ════════════════════════════════════════════════════════════
-- NEW FEATURES MIGRATION
-- Run in Supabase SQL Editor
-- Features: Customer Debt Payments, Cash Register, Sales Targets, Customer Loyalty
-- ════════════════════════════════════════════════════════════

-- ─── 1. DEBT PAYMENTS (partial payments against credit sales) ────
CREATE TABLE IF NOT EXISTS debt_payments (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  sale_id     UUID NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  amount      NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  payment_method TEXT NOT NULL DEFAULT 'cash'
    CHECK (payment_method IN ('cash','mobile_money','card','bank')),
  note        TEXT,
  received_by UUID REFERENCES auth.users(id),
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- RLS
ALTER TABLE debt_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "debt_payments_select" ON debt_payments FOR SELECT
  USING (business_id = get_my_business_id());
CREATE POLICY "debt_payments_insert" ON debt_payments FOR INSERT
  WITH CHECK (business_id = get_my_business_id());
CREATE POLICY "debt_payments_update" ON debt_payments FOR UPDATE
  USING (business_id = get_my_business_id());
CREATE POLICY "debt_payments_delete" ON debt_payments FOR DELETE
  USING (business_id = get_my_business_id() AND get_my_role() = 'admin');

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_debt_payments_sale ON debt_payments(sale_id);
CREATE INDEX IF NOT EXISTS idx_debt_payments_customer ON debt_payments(customer_id);
CREATE INDEX IF NOT EXISTS idx_debt_payments_business ON debt_payments(business_id);


-- ─── 2. CASH REGISTER SESSIONS (daily open/close) ────
CREATE TABLE IF NOT EXISTS cash_register_sessions (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id     UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id       UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  opened_by       UUID REFERENCES auth.users(id),
  closed_by       UUID REFERENCES auth.users(id),
  opening_balance NUMERIC(15,2) NOT NULL DEFAULT 0,
  closing_balance NUMERIC(15,2),
  expected_balance NUMERIC(15,2),
  difference      NUMERIC(15,2),  -- closing - expected (variance)
  cash_sales      NUMERIC(15,2) DEFAULT 0,
  mobile_sales    NUMERIC(15,2) DEFAULT 0,
  card_sales      NUMERIC(15,2) DEFAULT 0,
  credit_sales    NUMERIC(15,2) DEFAULT 0,
  total_sales     NUMERIC(15,2) DEFAULT 0,
  transaction_count INT DEFAULT 0,
  expenses_total  NUMERIC(15,2) DEFAULT 0,
  note            TEXT,
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  opened_at       TIMESTAMPTZ DEFAULT now(),
  closed_at       TIMESTAMPTZ
);

ALTER TABLE cash_register_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cash_register_select" ON cash_register_sessions FOR SELECT
  USING (business_id = get_my_business_id());
CREATE POLICY "cash_register_insert" ON cash_register_sessions FOR INSERT
  WITH CHECK (business_id = get_my_business_id());
CREATE POLICY "cash_register_update" ON cash_register_sessions FOR UPDATE
  USING (business_id = get_my_business_id());

CREATE INDEX IF NOT EXISTS idx_cash_register_branch ON cash_register_sessions(branch_id);
CREATE INDEX IF NOT EXISTS idx_cash_register_status ON cash_register_sessions(status);


-- ─── 3. SALES TARGETS ────
CREATE TABLE IF NOT EXISTS sales_targets (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id   UUID REFERENCES branches(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES auth.users(id),           -- NULL = branch/company target
  target_type TEXT NOT NULL DEFAULT 'monthly'
    CHECK (target_type IN ('daily','weekly','monthly')),
  target_amount NUMERIC(15,2) NOT NULL CHECK (target_amount > 0),
  period_start DATE NOT NULL,
  period_end   DATE NOT NULL,
  created_by  UUID REFERENCES auth.users(id),
  created_at  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE sales_targets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sales_targets_select" ON sales_targets FOR SELECT
  USING (business_id = get_my_business_id());
CREATE POLICY "sales_targets_insert" ON sales_targets FOR INSERT
  WITH CHECK (business_id = get_my_business_id() AND get_my_role() = 'admin');
CREATE POLICY "sales_targets_update" ON sales_targets FOR UPDATE
  USING (business_id = get_my_business_id() AND get_my_role() = 'admin');
CREATE POLICY "sales_targets_delete" ON sales_targets FOR DELETE
  USING (business_id = get_my_business_id() AND get_my_role() = 'admin');

CREATE INDEX IF NOT EXISTS idx_sales_targets_business ON sales_targets(business_id);
CREATE INDEX IF NOT EXISTS idx_sales_targets_branch ON sales_targets(branch_id);
CREATE INDEX IF NOT EXISTS idx_sales_targets_period ON sales_targets(period_start, period_end);


-- ─── 4. CUSTOMER LOYALTY ────
-- Running points balance per customer
ALTER TABLE customers ADD COLUMN IF NOT EXISTS loyalty_points INT DEFAULT 0;

CREATE TABLE IF NOT EXISTS loyalty_transactions (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  sale_id     UUID REFERENCES sales(id),
  points      INT NOT NULL,           -- positive = earned, negative = redeemed
  type        TEXT NOT NULL CHECK (type IN ('earn','redeem','adjust')),
  description TEXT,
  created_by  UUID REFERENCES auth.users(id),
  created_at  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE loyalty_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "loyalty_tx_select" ON loyalty_transactions FOR SELECT
  USING (business_id = get_my_business_id());
CREATE POLICY "loyalty_tx_insert" ON loyalty_transactions FOR INSERT
  WITH CHECK (business_id = get_my_business_id());

CREATE INDEX IF NOT EXISTS idx_loyalty_tx_customer ON loyalty_transactions(customer_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_tx_business ON loyalty_transactions(business_id);

-- Loyalty settings on business
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS loyalty_points_per_amount INT DEFAULT 1;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS loyalty_amount_unit NUMERIC(10,2) DEFAULT 1000;
-- e.g. earn 1 point per 1,000 UGX spent
-- Redeem: 100 points = loyalty_amount_unit discount

-- ─── 5. Add customer_name to completeSale for credit tracking ────
-- (customer_id column on sales already exists from suppliers_customers_migration)
-- Ensure index exists for customer debt queries
CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales(customer_id);
CREATE INDEX IF NOT EXISTS idx_sales_payment_method ON sales(payment_method);
CREATE INDEX IF NOT EXISTS idx_sales_status ON sales(status);

-- ═══════════════════════════════════════════════════════════════
-- DONE — run this migration in Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════
