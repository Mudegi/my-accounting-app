-- ============================================================
-- FIX: Infinite recursion in profiles RLS policies
-- ============================================================

-- 1. Drop the broken/recursive policies
DROP POLICY IF EXISTS "p_read" ON profiles;
DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
DROP POLICY IF EXISTS "Users can view business profiles" ON profiles;
DROP POLICY IF EXISTS "Admin can update business profiles" ON profiles;
DROP POLICY IF EXISTS "Admin can insert profiles" ON profiles;
DROP POLICY IF EXISTS "Admin can delete profiles" ON profiles;

DROP POLICY IF EXISTS "b_read" ON businesses;
DROP POLICY IF EXISTS "Users can view own business" ON businesses;

-- 2. Ensure profiles table has all required columns
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS sales_type text DEFAULT 'in_store' CHECK (sales_type IN ('in_store', 'field', 'both')),
ADD COLUMN IF NOT EXISTS phone text,
ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true;

-- 3. Create SECURITY DEFINER helper functions to bypass RLS recursion
CREATE OR REPLACE FUNCTION get_my_business_id()
RETURNS UUID AS $$
  SELECT business_id FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION get_my_role()
RETURNS TEXT AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION is_super_admin()
RETURNS BOOLEAN AS $$
  SELECT is_super_admin FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- 4. Re-enable RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.businesses ENABLE ROW LEVEL SECURITY;

-- 5. Create clean, non-recursive policies
-- Users can read their own profile and profiles of others in their business
CREATE POLICY "p_read" ON public.profiles 
FOR SELECT USING (
  id = auth.uid() 
  OR business_id = get_my_business_id()
  OR (SELECT is_super_admin())
);

-- Admins can manage profiles in their business
CREATE POLICY "p_admin_all" ON public.profiles 
FOR ALL USING (
  (business_id = get_my_business_id() AND get_my_role() = 'admin')
  OR (SELECT is_super_admin())
);

-- Users can read their own business data
CREATE POLICY "b_read" ON public.businesses 
FOR SELECT USING (
  id = get_my_business_id()
  OR (SELECT is_super_admin())
);

-- Admins can update their own business data
CREATE POLICY "b_update" ON public.businesses 
FOR UPDATE USING (
  (id = get_my_business_id() AND get_my_role() = 'admin')
  OR (SELECT is_super_admin())
);

-- 6. Ensure setup_new_account function is up to date
CREATE OR REPLACE FUNCTION setup_new_account(
  p_user_id uuid, p_full_name text, p_business_name text, p_country text, p_currency text
) RETURNS void AS $$
DECLARE v_biz_id uuid; v_branch_id uuid; v_plan_id uuid;
BEGIN
  -- 1. Create Business
  INSERT INTO public.businesses (name, country, default_currency, subscription_status, subscription_ends_at)
  VALUES (p_business_name, p_country, p_currency, 'trial', now() + interval '30 days') 
  RETURNING id INTO v_biz_id;

  -- 2. Create Main Branch
  INSERT INTO public.branches (business_id, name) 
  VALUES (v_biz_id, 'Main Branch') 
  RETURNING id INTO v_branch_id;

  -- 3. Create Admin Profile
  INSERT INTO public.profiles (id, business_id, branch_id, full_name, role, sales_type, is_active) 
  VALUES (p_user_id, v_biz_id, v_branch_id, p_full_name, 'admin', 'both', true);

  -- 4. Assign Free Trial Plan
  SELECT id INTO v_plan_id FROM public.subscription_plans WHERE name = 'free_trial' LIMIT 1;
  IF v_plan_id IS NOT NULL THEN
    INSERT INTO public.subscriptions (business_id, plan_id, status, current_period_end) 
    VALUES (v_biz_id, v_plan_id, 'trial', now() + interval '30 days');
  END IF;

  -- 5. Default Tax Rate
  INSERT INTO public.tax_rates (business_id, name, code, rate, is_default) 
  VALUES (v_biz_id, 'VAT 18%', '01', 0.18, true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
