-- ═══════════════════════════════════════════════════════════════
-- MIGRATION: Add Starter plan (30K/mo) and update plan descriptions
-- Removes EFRIS from plan descriptions/features
-- ═══════════════════════════════════════════════════════════════

-- 1. Re-activate 'starter' plan name (was previously deactivated)
-- Insert new starter plan at 30K UGX/mo
INSERT INTO subscription_plans (name, display_name, description, price_monthly, price_yearly, currency, trial_days, max_branches, max_users, max_products, features, sort_order, is_active)
VALUES
  ('starter', 'YourBooks Starter', 'POS, inventory & receipts for small shops', 30000, 300000, 'UGX', 0, 1, 1, 100,
   '["pos", "inventory", "receipts"]'::jsonb, 2, true)
ON CONFLICT (name) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  price_monthly = EXCLUDED.price_monthly,
  price_yearly = EXCLUDED.price_yearly,
  max_branches = EXCLUDED.max_branches,
  max_users = EXCLUDED.max_users,
  max_products = EXCLUDED.max_products,
  features = EXCLUDED.features,
  sort_order = EXCLUDED.sort_order,
  is_active = true;

-- 2. Update Basic plan: remove EFRIS from description, bump sort order
UPDATE subscription_plans SET
  description = 'Reports, expenses, multi-branch & credit notes',
  features = '["pos", "inventory", "receipts", "reports", "expenses", "multi_branch", "credit_notes"]'::jsonb,
  sort_order = 3
WHERE name = 'basic';

-- 3. Update Pro plan: remove EFRIS from description
UPDATE subscription_plans SET
  description = 'Full accounting, tax center, data export & analytics',
  features = '["pos", "inventory", "receipts", "reports", "expenses", "multi_branch", "credit_notes", "accounting", "tax_center", "data_export", "api_access"]'::jsonb,
  sort_order = 4
WHERE name = 'pro';

-- 4. Update Free Trial: remove EFRIS from features list
UPDATE subscription_plans SET
  features = '["pos", "inventory", "receipts", "reports", "expenses", "multi_branch", "credit_notes", "accounting", "tax_center", "data_export"]'::jsonb
WHERE name = 'free_trial';
