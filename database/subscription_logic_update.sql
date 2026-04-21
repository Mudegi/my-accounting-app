-- Update check_subscription_status to return billing_cycle
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
    RETURN jsonb_build_object(
      'active', false, 
      'reason', 'expired', 
      'plan', sub.plan_name, 
      'ended_at', sub.current_period_end,
      'billing_cycle', sub.billing_cycle
    );
  END IF;

  -- Check trial expired
  IF sub.status = 'trial' AND sub.trial_ends_at < now() THEN
    UPDATE subscriptions SET status = 'expired' WHERE id = sub.id;
    UPDATE businesses SET subscription_status = 'expired' WHERE id = p_business_id;
    RETURN jsonb_build_object(
      'active', false, 
      'reason', 'trial_expired', 
      'plan', sub.plan_name, 
      'ended_at', sub.trial_ends_at,
      'billing_cycle', sub.billing_cycle
    );
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
    'features', sub.features,
    'billing_cycle', sub.billing_cycle
  );
END;
$$;
