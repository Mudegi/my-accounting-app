-- ═══════════════════════════════════════════════════════════════
-- Multi-Currency + SaaS Subscription Migration
-- Adds currency support & subscription/payment gating
-- Safe to run multiple times (uses IF NOT EXISTS / ON CONFLICT)
-- ═══════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────
-- 1) CURRENCIES TABLE
-- ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS currencies (
  code text PRIMARY KEY,                    -- ISO 4217: UGX, USD, KES, EUR, etc.
  name text NOT NULL,
  symbol text NOT NULL,                     -- UGX, $, KSh, €
  decimal_places int DEFAULT 0,             -- UGX=0, USD=2, KES=2
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Seed common currencies (East Africa focused)
INSERT INTO currencies (code, name, symbol, decimal_places) VALUES
  ('UGX', 'Ugandan Shilling',   'UGX',  0),
  ('KES', 'Kenyan Shilling',    'KSh',  2),
  ('TZS', 'Tanzanian Shilling', 'TSh',  0),
  ('RWF', 'Rwandan Franc',      'FRw',  0),
  ('USD', 'US Dollar',          '$',    2),
  ('EUR', 'Euro',               '€',    2),
  ('GBP', 'British Pound',      '£',    2),
  ('ZAR', 'South African Rand', 'R',    2),
  ('NGN', 'Nigerian Naira',     '₦',    2),
  ('GHS', 'Ghanaian Cedi',      'GH₵',  2),
  ('SSP', 'South Sudanese Pound','SSP', 2),
  ('BIF', 'Burundian Franc',    'FBu',  0),
  ('CDF', 'Congolese Franc',    'FC',   2)
ON CONFLICT (code) DO NOTHING;

-- ────────────────────────────────────────────────
-- 2) EXCHANGE RATES TABLE
-- ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS exchange_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES businesses(id) ON DELETE CASCADE,
  from_currency text REFERENCES currencies(code),
  to_currency text REFERENCES currencies(code),
  rate numeric(18,8) NOT NULL,              -- 1 from_currency = rate to_currency
  effective_date date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(business_id, from_currency, to_currency, effective_date)
);

CREATE INDEX IF NOT EXISTS idx_exchange_rates_biz ON exchange_rates(business_id);
CREATE INDEX IF NOT EXISTS idx_exchange_rates_date ON exchange_rates(effective_date);

-- ────────────────────────────────────────────────
-- 3) ADD currency COLUMN TO businesses TABLE
-- ────────────────────────────────────────────────

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'businesses' AND column_name = 'default_currency'
  ) THEN
    ALTER TABLE businesses ADD COLUMN default_currency text DEFAULT 'UGX' REFERENCES currencies(code);
  END IF;
END $$;

-- ────────────────────────────────────────────────
-- 4) ADD currency TO sales TABLE
-- ────────────────────────────────────────────────

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sales' AND column_name = 'currency'
  ) THEN
    ALTER TABLE sales ADD COLUMN currency text DEFAULT 'UGX' REFERENCES currencies(code);
  END IF;
END $$;

-- ────────────────────────────────────────────────
-- 5) ADD currency TO purchases TABLE
-- ────────────────────────────────────────────────

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'purchases' AND column_name = 'currency'
  ) THEN
    ALTER TABLE purchases ADD COLUMN currency text DEFAULT 'UGX' REFERENCES currencies(code);
  END IF;
END $$;

-- ────────────────────────────────────────────────
-- 6) ADD currency TO expenses TABLE
-- ────────────────────────────────────────────────

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'expenses' AND column_name = 'currency'
  ) THEN
    ALTER TABLE expenses ADD COLUMN currency text DEFAULT 'UGX' REFERENCES currencies(code);
  END IF;
END $$;


-- ═══════════════════════════════════════════════════════════════
--  SaaS SUBSCRIPTION TABLES
-- ═══════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────
-- 7) SUBSCRIPTION PLANS — define pricing tiers
-- ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS subscription_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,                -- 'free_trial', 'starter', 'business', 'enterprise'
  display_name text NOT NULL,               -- 'Free Trial', 'Starter', etc.
  description text,
  price_monthly numeric(15,2) NOT NULL DEFAULT 0,
  price_yearly numeric(15,2) NOT NULL DEFAULT 0,
  currency text DEFAULT 'UGX' REFERENCES currencies(code),
  trial_days int DEFAULT 0,                 -- free trial duration
  max_branches int DEFAULT 1,
  max_users int DEFAULT 2,
  max_products int DEFAULT 50,
  features jsonb DEFAULT '[]'::jsonb,       -- array of feature flags
  is_active boolean DEFAULT true,
  sort_order int DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Seed plans (2 tiers: Basic without EFRIS, Pro with EFRIS)
INSERT INTO subscription_plans (name, display_name, description, price_monthly, price_yearly, currency, trial_days, max_branches, max_users, max_products, features, sort_order)
VALUES
  ('free_trial', 'Free Trial', '7-day free access to all features', 0, 0, 'UGX', 7, -1, -1, -1,
   '["pos", "inventory", "reports", "receipts", "expenses", "multi_branch", "accounting", "credit_notes", "efris"]'::jsonb, 1),

  ('basic', 'YourBooks Basic', 'All features without EFRIS integration', 70000, 700000, 'UGX', 0, -1, -1, -1,
   '["pos", "inventory", "reports", "receipts", "expenses", "multi_branch", "accounting", "credit_notes"]'::jsonb, 2),

  ('pro', 'YourBooks Pro', 'All features with full EFRIS/URA integration', 220000, 2200000, 'UGX', 0, -1, -1, -1,
   '["pos", "inventory", "reports", "receipts", "expenses", "multi_branch", "accounting", "credit_notes", "efris", "api_access"]'::jsonb, 3)

ON CONFLICT (name) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  price_monthly = EXCLUDED.price_monthly,
  price_yearly = EXCLUDED.price_yearly,
  max_branches = EXCLUDED.max_branches,
  max_users = EXCLUDED.max_users,
  max_products = EXCLUDED.max_products,
  features = EXCLUDED.features;

-- Deactivate old plans that were replaced
UPDATE subscription_plans SET is_active = false
WHERE name IN ('starter', 'business', 'enterprise', 'standard');

-- ────────────────────────────────────────────────
-- 8) SUBSCRIPTIONS — per business
-- ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES businesses(id) ON DELETE CASCADE,
  plan_id uuid REFERENCES subscription_plans(id),
  status text NOT NULL DEFAULT 'trial'
    CHECK (status IN ('trial', 'active', 'past_due', 'cancelled', 'expired')),
  billing_cycle text DEFAULT 'monthly' CHECK (billing_cycle IN ('monthly', 'yearly')),
  current_period_start timestamptz NOT NULL DEFAULT now(),
  current_period_end timestamptz NOT NULL,
  trial_ends_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_business ON subscriptions(business_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);

-- ────────────────────────────────────────────────
-- 9) PAYMENTS — payment history
-- ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES businesses(id) ON DELETE CASCADE,
  subscription_id uuid REFERENCES subscriptions(id),
  amount numeric(15,2) NOT NULL,
  currency text DEFAULT 'UGX' REFERENCES currencies(code),
  payment_method text NOT NULL CHECK (payment_method IN (
    'mtn_momo', 'airtel_money', 'bank_transfer', 'visa', 'mastercard', 'flutterwave', 'manual'
  )),
  payment_reference text,                    -- external reference from payment provider
  phone_number text,                         -- for mobile money
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'refunded')),
  provider_response jsonb,                   -- raw response from payment provider
  paid_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payments_business ON payments(business_id);
CREATE INDEX IF NOT EXISTS idx_payments_subscription ON payments(subscription_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);

-- ────────────────────────────────────────────────
-- 10) ADD subscription_plan_id TO businesses
-- ────────────────────────────────────────────────

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'businesses' AND column_name = 'subscription_status'
  ) THEN
    ALTER TABLE businesses ADD COLUMN subscription_status text DEFAULT 'trial'
      CHECK (subscription_status IN ('trial', 'active', 'past_due', 'cancelled', 'expired'));
    ALTER TABLE businesses ADD COLUMN subscription_ends_at timestamptz;
  END IF;
END $$;

-- ────────────────────────────────────────────────
-- 11) RLS POLICIES for new tables
-- ────────────────────────────────────────────────

ALTER TABLE currencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE exchange_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

-- Drop existing policies first (safe)
DO $$ BEGIN
  DROP POLICY IF EXISTS "Anyone can read currencies" ON currencies;
  DROP POLICY IF EXISTS "Users can view own exchange_rates" ON exchange_rates;
  DROP POLICY IF EXISTS "Users can insert exchange_rates" ON exchange_rates;
  DROP POLICY IF EXISTS "Anyone can read plans" ON subscription_plans;
  DROP POLICY IF EXISTS "Users can view own subscription" ON subscriptions;
  DROP POLICY IF EXISTS "Users can view own payments" ON payments;
END $$;

-- currencies: public read
CREATE POLICY "Anyone can read currencies" ON currencies FOR SELECT USING (true);

-- exchange_rates: business-scoped
CREATE POLICY "Users can view own exchange_rates" ON exchange_rates FOR SELECT
  USING (business_id = get_my_business_id());
CREATE POLICY "Users can insert exchange_rates" ON exchange_rates FOR INSERT
  WITH CHECK (business_id = get_my_business_id());

-- plans: public read
CREATE POLICY "Anyone can read plans" ON subscription_plans FOR SELECT USING (true);

-- subscriptions: business-scoped
CREATE POLICY "Users can view own subscription" ON subscriptions FOR SELECT
  USING (business_id = get_my_business_id());

-- payments: business-scoped
CREATE POLICY "Users can view own payments" ON payments FOR SELECT
  USING (business_id = get_my_business_id());

-- ────────────────────────────────────────────────
-- 12) AUTO-PROVISION: give existing businesses a free trial
-- ────────────────────────────────────────────────

DO $$
DECLARE
  biz RECORD;
  trial_plan_id UUID;
BEGIN
  SELECT id INTO trial_plan_id FROM subscription_plans WHERE name = 'free_trial' LIMIT 1;
  IF trial_plan_id IS NULL THEN RETURN; END IF;

  FOR biz IN
    SELECT id FROM businesses
    WHERE id NOT IN (SELECT business_id FROM subscriptions)
  LOOP
    INSERT INTO subscriptions (business_id, plan_id, status, billing_cycle, current_period_start, current_period_end, trial_ends_at)
    VALUES (biz.id, trial_plan_id, 'trial', 'monthly', now(), now() + interval '7 days', now() + interval '7 days');

    UPDATE businesses SET subscription_status = 'trial', subscription_ends_at = now() + interval '7 days'
    WHERE id = biz.id AND subscription_status IS NULL;
  END LOOP;
END;
$$;

-- ────────────────────────────────────────────────
-- 13) HELPER: check subscription validity (RPC)
-- ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION check_subscription_status(p_business_id UUID)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  sub RECORD;
  plan RECORD;
  result jsonb;
BEGIN
  SELECT s.*, sp.name as plan_name, sp.display_name, sp.max_branches, sp.max_users, sp.max_products, sp.features
  INTO sub
  FROM subscriptions s
  JOIN subscription_plans sp ON sp.id = s.plan_id
  WHERE s.business_id = p_business_id
  ORDER BY s.created_at DESC
  LIMIT 1;

  IF sub IS NULL THEN
    RETURN jsonb_build_object('active', false, 'reason', 'no_subscription');
  END IF;

  -- Check if expired
  IF sub.current_period_end < now() AND sub.status NOT IN ('active') THEN
    UPDATE subscriptions SET status = 'expired' WHERE id = sub.id;
    UPDATE businesses SET subscription_status = 'expired' WHERE id = p_business_id;
    RETURN jsonb_build_object('active', false, 'reason', 'expired', 'plan', sub.plan_name, 'ended_at', sub.current_period_end);
  END IF;

  -- Check trial expired
  IF sub.status = 'trial' AND sub.trial_ends_at < now() THEN
    UPDATE subscriptions SET status = 'expired' WHERE id = sub.id;
    UPDATE businesses SET subscription_status = 'expired' WHERE id = p_business_id;
    RETURN jsonb_build_object('active', false, 'reason', 'trial_expired', 'plan', sub.plan_name, 'ended_at', sub.trial_ends_at);
  END IF;

  RETURN jsonb_build_object(
    'active', true,
    'plan', sub.plan_name,
    'display_name', sub.display_name,
    'status', sub.status,
    'ends_at', sub.current_period_end,
    'trial_ends_at', sub.trial_ends_at,
    'max_branches', sub.max_branches,
    'max_users', sub.max_users,
    'max_products', sub.max_products,
    'features', sub.features
  );
END;
$$;
