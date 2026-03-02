-- ════════════════════════════════════════════════════════════
-- APPROVED STATUS MIGRATION
-- Run in Supabase SQL Editor
-- Adds 'approved' as a distinct subscription_status for
-- businesses activated by the platform admin
-- ════════════════════════════════════════════════════════════

-- ─── 1. UPDATE CHECK CONSTRAINT TO ALLOW 'approved' ────
ALTER TABLE businesses DROP CONSTRAINT IF EXISTS businesses_subscription_status_check;
ALTER TABLE businesses ADD CONSTRAINT businesses_subscription_status_check
  CHECK (subscription_status IN ('trial', 'active', 'approved', 'past_due', 'cancelled', 'expired'));


-- ─── 2. UPDATE admin_activate_subscription TO SET 'approved' ────
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

  -- Update business status to 'approved' (distinguishes admin-activated)
  UPDATE businesses
  SET subscription_status = 'approved', subscription_ends_at = v_period_end
  WHERE id = p_business_id;

  -- Also mark any pending payments as completed for this business
  UPDATE payments
  SET status = 'completed', paid_at = now()
  WHERE business_id = p_business_id AND status = 'pending';

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
    'status', 'approved',
    'ends_at', v_period_end
  );
END;
$$;


-- ─── 3. UPDATE check_subscription_status TO TREAT 'approved' AS ACTIVE ────
CREATE OR REPLACE FUNCTION check_subscription_status(p_business_id UUID)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  sub RECORD;
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

  -- Check if expired (treat 'approved' businesses same as 'active' — don't auto-expire)
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


-- ─── 4. UPDATE admin_platform_stats TO COUNT 'approved' AS ACTIVE ────
DROP FUNCTION IF EXISTS admin_platform_stats();

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

  -- Count both 'active' and 'approved' as active subscriptions
  SELECT COUNT(*) INTO v_active_subs
  FROM businesses WHERE subscription_status IN ('active', 'approved');

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
