-- ═══════════════════════════════════════════════════════════════════
-- Device Sessions Migration
-- Track active device sessions per business to enforce plan limits
-- ═══════════════════════════════════════════════════════════════════

-- 1. Create device_sessions table
CREATE TABLE IF NOT EXISTS device_sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  business_id   uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  device_id     text NOT NULL,
  device_name   text NOT NULL DEFAULT 'Unknown Device',
  platform      text NOT NULL DEFAULT 'unknown',
  last_active_at timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE(device_id, user_id)
);

-- Index for fast lookups by business
CREATE INDEX IF NOT EXISTS idx_device_sessions_business
  ON device_sessions(business_id);

-- Index for fast lookups by user
CREATE INDEX IF NOT EXISTS idx_device_sessions_user
  ON device_sessions(user_id);

-- 2. Add max_devices column to subscription_plans
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'subscription_plans' AND column_name = 'max_devices'
  ) THEN
    ALTER TABLE subscription_plans ADD COLUMN max_devices integer NOT NULL DEFAULT -1;
  END IF;
END $$;

-- Set device limits per plan
UPDATE subscription_plans SET max_devices = 2  WHERE name = 'starter';
UPDATE subscription_plans SET max_devices = 5  WHERE name = 'basic';
UPDATE subscription_plans SET max_devices = 10 WHERE name = 'pro';
UPDATE subscription_plans SET max_devices = 2  WHERE name = 'free_trial';

-- 3. Enable RLS on device_sessions
ALTER TABLE device_sessions ENABLE ROW LEVEL SECURITY;

-- Users can read their own business's sessions
DROP POLICY IF EXISTS "Users can view own business sessions" ON device_sessions;
CREATE POLICY "Users can view own business sessions" ON device_sessions
  FOR SELECT USING (
    business_id IN (
      SELECT business_id FROM profiles WHERE id = auth.uid()
    )
  );

-- Users can insert their own sessions
DROP POLICY IF EXISTS "Users can insert own sessions" ON device_sessions;
CREATE POLICY "Users can insert own sessions" ON device_sessions
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- Users can update their own sessions (heartbeat)
DROP POLICY IF EXISTS "Users can update own sessions" ON device_sessions;
CREATE POLICY "Users can update own sessions" ON device_sessions
  FOR UPDATE USING (user_id = auth.uid());

-- Users can delete their own sessions (logout)
DROP POLICY IF EXISTS "Users can delete own sessions" ON device_sessions;
CREATE POLICY "Users can delete own sessions" ON device_sessions
  FOR DELETE USING (user_id = auth.uid());

-- Admins can delete sessions in their business (remote logout)
DROP POLICY IF EXISTS "Business admins can delete business sessions" ON device_sessions;
CREATE POLICY "Business admins can delete business sessions" ON device_sessions
  FOR DELETE USING (
    business_id IN (
      SELECT business_id FROM profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );


-- ═══════════════════════════════════════════════════════════════════
-- 4. RPC: Register a device session (checks limit)
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION register_device_session(
  p_business_id uuid,
  p_device_id   text,
  p_device_name text DEFAULT 'Unknown Device',
  p_platform    text DEFAULT 'unknown'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_max_devices integer;
  v_active_count integer;
  v_session_exists boolean;
  v_stale_cutoff timestamptz := now() - interval '24 hours';
BEGIN
  -- Clean up stale sessions for this business (inactive > 24h)
  DELETE FROM device_sessions
  WHERE business_id = p_business_id
    AND last_active_at < v_stale_cutoff;

  -- Check if this device already has a session (re-login / token refresh)
  SELECT EXISTS(
    SELECT 1 FROM device_sessions
    WHERE device_id = p_device_id AND user_id = auth.uid()
  ) INTO v_session_exists;

  IF v_session_exists THEN
    -- Just update the existing session
    UPDATE device_sessions
    SET last_active_at = now(),
        device_name = p_device_name,
        platform = p_platform
    WHERE device_id = p_device_id AND user_id = auth.uid();

    RETURN jsonb_build_object('allowed', true, 'existing', true);
  END IF;

  -- Get max_devices for this business's plan
  SELECT sp.max_devices INTO v_max_devices
  FROM subscriptions s
  JOIN subscription_plans sp ON sp.id = s.plan_id
  WHERE s.business_id = p_business_id
    AND s.status IN ('trial', 'active')
  ORDER BY sp.sort_order DESC
  LIMIT 1;

  -- Default to 2 if no plan found
  IF v_max_devices IS NULL THEN
    v_max_devices := 2;
  END IF;

  -- -1 means unlimited
  IF v_max_devices != -1 THEN
    -- Count active sessions for this business
    SELECT count(*) INTO v_active_count
    FROM device_sessions
    WHERE business_id = p_business_id;

    IF v_active_count >= v_max_devices THEN
      RETURN jsonb_build_object(
        'allowed', false,
        'max_devices', v_max_devices,
        'active_count', v_active_count
      );
    END IF;
  END IF;

  -- Insert new session
  INSERT INTO device_sessions (user_id, business_id, device_id, device_name, platform)
  VALUES (auth.uid(), p_business_id, p_device_id, p_device_name, p_platform)
  ON CONFLICT (device_id, user_id) DO UPDATE
    SET last_active_at = now(),
        device_name = EXCLUDED.device_name,
        platform = EXCLUDED.platform;

  RETURN jsonb_build_object('allowed', true, 'existing', false);
END;
$$;


-- ═══════════════════════════════════════════════════════════════════
-- 5. RPC: Heartbeat — update last_active_at
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION heartbeat_device_session(p_device_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE device_sessions
  SET last_active_at = now()
  WHERE device_id = p_device_id AND user_id = auth.uid();
END;
$$;


-- ═══════════════════════════════════════════════════════════════════
-- 6. RPC: Remove device session (logout)
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION remove_device_session(p_device_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM device_sessions
  WHERE device_id = p_device_id AND user_id = auth.uid();
END;
$$;


-- ═══════════════════════════════════════════════════════════════════
-- 7. RPC: Get active sessions for a business (settings page)
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION get_business_device_sessions(p_business_id uuid)
RETURNS TABLE(
  id            uuid,
  user_id       uuid,
  user_name     text,
  device_id     text,
  device_name   text,
  platform      text,
  last_active_at timestamptz,
  created_at    timestamptz,
  is_current    boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_stale_cutoff timestamptz := now() - interval '24 hours';
BEGIN
  -- Clean up stale sessions first
  DELETE FROM device_sessions ds
  WHERE ds.business_id = p_business_id
    AND ds.last_active_at < v_stale_cutoff;

  -- Verify caller belongs to this business
  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.business_id = p_business_id
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT
    ds.id,
    ds.user_id,
    COALESCE(p.full_name, 'Unknown') AS user_name,
    ds.device_id,
    ds.device_name,
    ds.platform,
    ds.last_active_at,
    ds.created_at,
    (ds.user_id = auth.uid()) AS is_current
  FROM device_sessions ds
  LEFT JOIN profiles p ON p.id = ds.user_id
  WHERE ds.business_id = p_business_id
  ORDER BY ds.last_active_at DESC;
END;
$$;


-- ═══════════════════════════════════════════════════════════════════
-- 8. RPC: Admin remove any session (remote logout by business admin)
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION admin_remove_device_session(p_session_id uuid, p_business_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Verify caller is admin of the business or super admin
  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
      AND (
        (profiles.business_id = p_business_id AND profiles.role = 'admin')
        OR profiles.is_super_admin = true
      )
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  DELETE FROM device_sessions
  WHERE device_sessions.id = p_session_id
    AND device_sessions.business_id = p_business_id;
END;
$$;


-- ═══════════════════════════════════════════════════════════════════
-- 9. Super Admin: Get sessions for any business
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION admin_get_business_sessions(p_business_id uuid)
RETURNS TABLE(
  id            uuid,
  user_id       uuid,
  user_name     text,
  device_id     text,
  device_name   text,
  platform      text,
  last_active_at timestamptz,
  created_at    timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Super admin check
  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_super_admin = true
  ) THEN
    RAISE EXCEPTION 'Super admin access required';
  END IF;

  -- Clean stale
  DELETE FROM device_sessions ds
  WHERE ds.business_id = p_business_id
    AND ds.last_active_at < now() - interval '24 hours';

  RETURN QUERY
  SELECT
    ds.id,
    ds.user_id,
    COALESCE(p.full_name, 'Unknown') AS user_name,
    ds.device_id,
    ds.device_name,
    ds.platform,
    ds.last_active_at,
    ds.created_at
  FROM device_sessions ds
  LEFT JOIN profiles p ON p.id = ds.user_id
  WHERE ds.business_id = p_business_id
  ORDER BY ds.last_active_at DESC;
END;
$$;


-- ═══════════════════════════════════════════════════════════════════
-- 10. Update admin_list_businesses to include device session count
-- ═══════════════════════════════════════════════════════════════════
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
  efris_api_key        text,
  efris_api_url        text,
  efris_test_mode      boolean,
  active_devices       bigint
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
    b.efris_api_key::text,
    b.efris_api_url::text,
    b.efris_test_mode,
    COALESCE((SELECT count(*) FROM device_sessions ds
     WHERE ds.business_id = b.id
       AND ds.last_active_at > now() - interval '24 hours'), 0) AS active_devices
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


-- ═══════════════════════════════════════════════════════════════════
-- 11. Update check_subscription_status to include max_devices
-- ═══════════════════════════════════════════════════════════════════
-- We add max_devices to the returned JSON so the client can display limits
-- This is a non-breaking addition to the existing RPC
