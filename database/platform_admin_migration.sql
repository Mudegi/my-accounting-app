-- ═══════════════════════════════════════════════════════════════
-- Platform Super Admin Migration
-- Adds is_super_admin flag + RPC helpers for platform management
-- Safe to run multiple times (uses IF NOT EXISTS)
-- ═══════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────
-- 1) ADD is_super_admin TO profiles
-- ────────────────────────────────────────────────

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'is_super_admin'
  ) THEN
    ALTER TABLE profiles ADD COLUMN is_super_admin boolean DEFAULT false;
  END IF;
END $$;

-- ────────────────────────────────────────────────
-- 2) GRANT your account super admin
--    NOTE: Sign up with this email in the app first,
--    then run this migration to promote it.
-- ────────────────────────────────────────────────

-- Revoke super admin from demo account (safety)
UPDATE profiles
SET is_super_admin = false
WHERE id IN (
  SELECT id FROM auth.users WHERE email = 'mudegiemma@gmail.com'
);

-- Grant super admin to platform owner
UPDATE profiles
SET is_super_admin = true
WHERE id IN (
  SELECT id FROM auth.users WHERE email = 'kissakian@gmail.com'
);

-- ────────────────────────────────────────────────
-- 3) SECURITY DEFINER helper to check super admin
-- ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION is_super_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT COALESCE(
    (SELECT is_super_admin FROM profiles WHERE id = auth.uid()),
    false
  );
$$;

-- ────────────────────────────────────────────────
-- 4) RPC: List all businesses (super admin only)
-- ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION admin_list_businesses()
RETURNS TABLE (
  id uuid,
  name text,
  tin text,
  default_currency text,
  subscription_status text,
  subscription_ends_at timestamptz,
  created_at timestamptz,
  owner_name text,
  owner_email text,
  plan_name text,
  user_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Access denied: super admin only';
  END IF;

  RETURN QUERY
  SELECT DISTINCT ON (b.id)
    b.id,
    b.name::text,
    b.tin::text,
    b.default_currency::text,
    b.subscription_status::text,
    b.subscription_ends_at,
    b.created_at,
    p.full_name::text AS owner_name,
    u.email::text AS owner_email,
    sp.display_name::text AS plan_name,
    (SELECT COUNT(*) FROM profiles pr WHERE pr.business_id = b.id) AS user_count
  FROM businesses b
  LEFT JOIN profiles p ON p.business_id = b.id AND p.role = 'admin'
  LEFT JOIN auth.users u ON u.id = p.id
  LEFT JOIN LATERAL (
    SELECT s.plan_id
    FROM subscriptions s
    WHERE s.business_id = b.id
    ORDER BY s.current_period_start DESC
    LIMIT 1
  ) sub ON true
  LEFT JOIN subscription_plans sp ON sp.id = sub.plan_id
  ORDER BY b.id, b.created_at DESC;
END;
$$;

-- ────────────────────────────────────────────────
-- 5) RPC: Manually activate subscription (cash payment)
-- ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION admin_activate_subscription(
  p_business_id uuid,
  p_plan_name text,
  p_billing_cycle text DEFAULT 'monthly',
  p_amount numeric DEFAULT 0,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_plan RECORD;
  v_sub_id uuid;
  v_period_end timestamptz;
  v_payment_id uuid;
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Access denied: super admin only';
  END IF;

  -- Find the plan
  SELECT * INTO v_plan FROM subscription_plans WHERE name = p_plan_name;
  IF v_plan IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Plan not found: ' || p_plan_name);
  END IF;

  -- Calculate period end
  IF p_billing_cycle = 'yearly' THEN
    v_period_end := now() + interval '1 year';
  ELSE
    v_period_end := now() + interval '1 month';
  END IF;

  -- Expire any active subscription
  UPDATE subscriptions SET status = 'expired'
  WHERE business_id = p_business_id AND status IN ('trial', 'active');

  -- Create new subscription
  INSERT INTO subscriptions (
    business_id, plan_id, status, billing_cycle,
    current_period_start, current_period_end
  ) VALUES (
    p_business_id, v_plan.id, 'active', p_billing_cycle,
    now(), v_period_end
  ) RETURNING id INTO v_sub_id;

  -- Update business status
  UPDATE businesses
  SET subscription_status = 'active', subscription_ends_at = v_period_end
  WHERE id = p_business_id;

  -- Record cash payment if amount > 0
  IF p_amount > 0 THEN
    INSERT INTO payments (
      business_id, subscription_id, amount, currency, payment_method,
      payment_reference, status, paid_at
    ) VALUES (
      p_business_id, v_sub_id, p_amount, 'UGX', 'manual',
      COALESCE(p_notes, 'Cash payment - activated by admin'), 'completed', now()
    ) RETURNING id INTO v_payment_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'subscription_id', v_sub_id,
    'payment_id', v_payment_id,
    'plan', v_plan.display_name,
    'status', 'active',
    'ends_at', v_period_end
  );
END;
$$;

-- ────────────────────────────────────────────────
-- 6) RPC: Extend subscription manually
-- ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION admin_extend_subscription(
  p_business_id uuid,
  p_days int DEFAULT 30,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_sub RECORD;
  v_new_end timestamptz;
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Access denied: super admin only';
  END IF;

  SELECT * INTO v_sub FROM subscriptions
  WHERE business_id = p_business_id
  ORDER BY created_at DESC LIMIT 1;

  IF v_sub IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'No subscription found');
  END IF;

  -- Extend from current end or from now (whichever is later)
  v_new_end := GREATEST(v_sub.current_period_end, now()) + (p_days || ' days')::interval;

  UPDATE subscriptions
  SET current_period_end = v_new_end, status = 'active', updated_at = now()
  WHERE id = v_sub.id;

  UPDATE businesses
  SET subscription_status = 'active', subscription_ends_at = v_new_end
  WHERE id = p_business_id;

  RETURN jsonb_build_object(
    'success', true,
    'subscription_id', v_sub.id,
    'new_end', v_new_end,
    'days_added', p_days
  );
END;
$$;

-- ────────────────────────────────────────────────
-- 7) RPC: Deactivate / cancel subscription
-- ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION admin_cancel_subscription(
  p_business_id uuid,
  p_reason text DEFAULT 'Cancelled by admin'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_sub RECORD;
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Access denied: super admin only';
  END IF;

  SELECT * INTO v_sub FROM subscriptions
  WHERE business_id = p_business_id AND status IN ('trial', 'active', 'past_due')
  ORDER BY created_at DESC LIMIT 1;

  IF v_sub IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'No active subscription found');
  END IF;

  UPDATE subscriptions SET status = 'cancelled', cancelled_at = now(), updated_at = now()
  WHERE id = v_sub.id;

  UPDATE businesses SET subscription_status = 'cancelled'
  WHERE id = p_business_id;

  RETURN jsonb_build_object('success', true, 'cancelled', true, 'reason', p_reason);
END;
$$;

-- ────────────────────────────────────────────────
-- 8) RPC: Get all payments (super admin)
-- ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION admin_list_payments(
  p_limit int DEFAULT 50,
  p_offset int DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  business_id uuid,
  business_name text,
  amount numeric,
  currency text,
  payment_method text,
  payment_reference text,
  status text,
  paid_at timestamptz,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Access denied: super admin only';
  END IF;

  RETURN QUERY
  SELECT
    pay.id,
    pay.business_id,
    b.name::text AS business_name,
    pay.amount,
    pay.currency::text,
    pay.payment_method::text,
    pay.payment_reference::text,
    pay.status::text,
    pay.paid_at,
    pay.created_at
  FROM payments pay
  JOIN businesses b ON b.id = pay.business_id
  ORDER BY pay.created_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

-- ────────────────────────────────────────────────
-- 9) RPC: Platform stats for admin dashboard
-- ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION admin_platform_stats()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_total_businesses bigint;
  v_active_subs bigint;
  v_trial_subs bigint;
  v_expired_subs bigint;
  v_total_revenue numeric;
  v_this_month_revenue numeric;
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Access denied: super admin only';
  END IF;

  SELECT COUNT(*) INTO v_total_businesses FROM businesses;

  SELECT COUNT(*) INTO v_active_subs
  FROM businesses WHERE subscription_status = 'active';

  SELECT COUNT(*) INTO v_trial_subs
  FROM businesses WHERE subscription_status = 'trial';

  SELECT COUNT(*) INTO v_expired_subs
  FROM businesses WHERE subscription_status IN ('expired', 'cancelled');

  SELECT COALESCE(SUM(amount), 0) INTO v_total_revenue
  FROM payments WHERE status = 'completed';

  SELECT COALESCE(SUM(amount), 0) INTO v_this_month_revenue
  FROM payments WHERE status = 'completed'
    AND paid_at >= date_trunc('month', now());

  RETURN jsonb_build_object(
    'total_businesses', v_total_businesses,
    'active_subscriptions', v_active_subs,
    'trial_subscriptions', v_trial_subs,
    'expired_subscriptions', v_expired_subs,
    'total_revenue', v_total_revenue,
    'this_month_revenue', v_this_month_revenue
  );
END;
$$;
