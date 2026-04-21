-- ═══════════════════════════════════════════════════════════════════
-- Admin Business Management Migration
-- Add Disabling capability for platform admins
-- ═══════════════════════════════════════════════════════════════════

-- 1. Add columns to businesses
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'businesses' AND column_name = 'is_disabled'
  ) THEN
    ALTER TABLE businesses ADD COLUMN is_disabled boolean DEFAULT false;
    ALTER TABLE businesses ADD COLUMN disabled_reason text;
  END IF;
END $$;

-- 2. Update check_user_access_allowed to block access if business is disabled
CREATE OR REPLACE FUNCTION check_user_access_allowed(p_user_id UUID)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_profile RECORD;
  v_biz RECORD;
  v_schedule RECORD;
  v_now_time time;
  v_today integer;
BEGIN
  -- Check profile
  SELECT id, business_id, is_active, suspended_at, deleted_at, full_name
  INTO v_profile
  FROM profiles WHERE id = p_user_id;

  IF v_profile IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'Account not found');
  END IF;

  -- 1) Check Business status first (Platform-level disable)
  SELECT is_disabled, disabled_reason INTO v_biz
  FROM businesses WHERE id = v_profile.business_id;

  IF v_biz.is_disabled = true THEN
    RETURN jsonb_build_object(
      'allowed', false, 
      'reason', COALESCE(v_biz.disabled_reason, 'Access denied: your business account has been disabled by the platform administrator.')
    );
  END IF;

  -- 2) Check individual profile status
  IF v_profile.is_active = false THEN
    IF v_profile.deleted_at IS NOT NULL THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'Account has been deactivated. Contact your administrator.');
    ELSE
      RETURN jsonb_build_object('allowed', false, 'reason', 'Your account has been suspended. Contact your administrator.');
    END IF;
  END IF;

  -- 3) Check working hours schedule
  v_now_time := (now() AT TIME ZONE 'Africa/Kampala')::time;
  v_today := EXTRACT(DOW FROM now() AT TIME ZONE 'Africa/Kampala')::integer;

  SELECT * INTO v_schedule
  FROM user_access_schedules
  WHERE user_id = p_user_id AND day_of_week = v_today;

  IF v_schedule IS NULL THEN
    RETURN jsonb_build_object('allowed', true);
  END IF;

  IF v_schedule.is_enabled = false THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'Access denied outside scheduled working hours.');
  END IF;

  IF v_now_time < v_schedule.start_time OR v_now_time > v_schedule.end_time THEN
    RETURN jsonb_build_object(
      'allowed', false, 
      'reason', format('Your access is restricted to %s - %s.', 
                 v_schedule.start_time::text, 
                 v_schedule.end_time::text)
    );
  END IF;

  RETURN jsonb_build_object('allowed', true);
END;
$$;

-- 3. RPC: Disable a business
CREATE OR REPLACE FUNCTION admin_disable_business(p_business_id UUID, p_reason TEXT)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  UPDATE businesses 
  SET is_disabled = true, 
      disabled_reason = p_reason 
  WHERE id = p_business_id;

  -- Kill all active sessions for this business immediately
  DELETE FROM device_sessions WHERE business_id = p_business_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- 4. RPC: Enable a business
CREATE OR REPLACE FUNCTION admin_enable_business(p_business_id UUID)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  UPDATE businesses 
  SET is_disabled = false, 
      disabled_reason = NULL 
  WHERE id = p_business_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- 5. Update admin_list_businesses to include disabled stats
DROP FUNCTION IF EXISTS admin_list_businesses();
CREATE OR REPLACE FUNCTION admin_list_businesses()
RETURNS TABLE(
  id                   uuid,
  name                 text,
  tin                  text,
  default_currency     text,
  subscription_status  text,
  subscription_ends_at timestamptz,
  created_at           timestamptz,
  owner_name           text,
  owner_email          text,
  plan_name            text,
  user_count           bigint,
  is_efris_enabled     boolean,
  active_devices       bigint,
  is_disabled          boolean,
  disabled_reason      text
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
    p.full_name::text   AS owner_name,
    u.email::text        AS owner_email,
    sp.display_name::text AS plan_name,
    (SELECT COUNT(*) FROM profiles pr WHERE pr.business_id = b.id) AS user_count,
    b.is_efris_enabled,
    COALESCE((SELECT count(*) FROM device_sessions ds
     WHERE ds.business_id = b.id
       AND ds.last_active_at > now() - interval '24 hours'), 0) AS active_devices,
    b.is_disabled,
    b.disabled_reason
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
