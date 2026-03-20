-- ═══════════════════════════════════════════════════════════════
-- MIGRATION: User Security Controls
-- 1. User Suspension & Soft Delete
-- 2. Working Hours / Access Schedules
-- 3. User Limits Per Subscription Plan
-- ═══════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────
-- 1a. Add suspension & soft-delete columns to profiles
-- ─────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'suspended_at') THEN
    ALTER TABLE profiles ADD COLUMN suspended_at timestamptz DEFAULT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'suspension_reason') THEN
    ALTER TABLE profiles ADD COLUMN suspension_reason text DEFAULT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'suspended_by') THEN
    ALTER TABLE profiles ADD COLUMN suspended_by uuid DEFAULT NULL REFERENCES auth.users(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'deleted_at') THEN
    ALTER TABLE profiles ADD COLUMN deleted_at timestamptz DEFAULT NULL;
  END IF;
END $$;


-- ─────────────────────────────────────────────
-- 1b. RPC: Suspend a user (business admin only)
-- Kills all device sessions instantly
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION suspend_user(
  p_user_id UUID,
  p_reason TEXT DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_caller_biz uuid;
  v_target_biz uuid;
BEGIN
  -- Get caller's business
  SELECT business_id INTO v_caller_biz
  FROM profiles WHERE id = auth.uid() AND role = 'admin';

  IF v_caller_biz IS NULL THEN
    RAISE EXCEPTION 'Access denied: admin only';
  END IF;

  -- Get target's business
  SELECT business_id INTO v_target_biz
  FROM profiles WHERE id = p_user_id;

  IF v_target_biz IS NULL OR v_target_biz != v_caller_biz THEN
    RAISE EXCEPTION 'User not found in your business';
  END IF;

  -- Cannot suspend yourself
  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot suspend yourself';
  END IF;

  -- Suspend
  UPDATE profiles SET
    is_active = false,
    suspended_at = now(),
    suspension_reason = p_reason,
    suspended_by = auth.uid()
  WHERE id = p_user_id AND business_id = v_caller_biz;

  -- Kill all their device sessions immediately
  DELETE FROM device_sessions WHERE user_id = p_user_id;
END;
$$;


-- ─────────────────────────────────────────────
-- 1c. RPC: Reactivate a suspended user
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION reactivate_user(
  p_user_id UUID
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_caller_biz uuid;
BEGIN
  SELECT business_id INTO v_caller_biz
  FROM profiles WHERE id = auth.uid() AND role = 'admin';

  IF v_caller_biz IS NULL THEN
    RAISE EXCEPTION 'Access denied: admin only';
  END IF;

  UPDATE profiles SET
    is_active = true,
    suspended_at = NULL,
    suspension_reason = NULL,
    suspended_by = NULL
  WHERE id = p_user_id AND business_id = v_caller_biz;
END;
$$;


-- ─────────────────────────────────────────────
-- 1d. RPC: Soft-delete a user
-- Sets deleted_at, suspends, kills sessions
-- Historical records (sales, etc.) remain intact
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION soft_delete_user(
  p_user_id UUID,
  p_reason TEXT DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_caller_biz uuid;
  v_target_biz uuid;
BEGIN
  SELECT business_id INTO v_caller_biz
  FROM profiles WHERE id = auth.uid() AND role = 'admin';

  IF v_caller_biz IS NULL THEN
    RAISE EXCEPTION 'Access denied: admin only';
  END IF;

  SELECT business_id INTO v_target_biz
  FROM profiles WHERE id = p_user_id;

  IF v_target_biz IS NULL OR v_target_biz != v_caller_biz THEN
    RAISE EXCEPTION 'User not found in your business';
  END IF;

  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot delete yourself';
  END IF;

  -- Soft delete: mark inactive, set deleted_at
  UPDATE profiles SET
    is_active = false,
    suspended_at = now(),
    suspension_reason = COALESCE(p_reason, 'Account deleted'),
    suspended_by = auth.uid(),
    deleted_at = now()
  WHERE id = p_user_id AND business_id = v_caller_biz;

  -- Kill all sessions
  DELETE FROM device_sessions WHERE user_id = p_user_id;
END;
$$;


-- ─────────────────────────────────────────────
-- 2a. Create user_access_schedules table
-- Business-defined working hours per user
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_access_schedules (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  day_of_week integer NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  -- 0=Sunday, 1=Monday, ... 6=Saturday
  start_time time NOT NULL DEFAULT '07:00',
  end_time   time NOT NULL DEFAULT '20:00',
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, day_of_week)
);

CREATE INDEX IF NOT EXISTS idx_access_schedules_user
  ON user_access_schedules(user_id);

-- Enable RLS
ALTER TABLE user_access_schedules ENABLE ROW LEVEL SECURITY;

-- Admins can manage schedules for their business
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Admins manage access schedules') THEN
    CREATE POLICY "Admins manage access schedules"
      ON user_access_schedules FOR ALL
      USING (
        business_id IN (
          SELECT business_id FROM profiles WHERE id = auth.uid() AND role = 'admin'
        )
      );
  END IF;
END $$;

-- Users can read their own schedule
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users read own schedule') THEN
    CREATE POLICY "Users read own schedule"
      ON user_access_schedules FOR SELECT
      USING (user_id = auth.uid());
  END IF;
END $$;


-- ─────────────────────────────────────────────
-- 2b. RPC: Save working hours for a user
-- Upserts all 7 days at once
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION save_user_schedule(
  p_user_id UUID,
  p_schedule JSONB
  -- Expected: [{"day": 0, "start": "07:00", "end": "20:00", "enabled": true}, ...]
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_caller_biz uuid;
  v_target_biz uuid;
  v_item jsonb;
BEGIN
  SELECT business_id INTO v_caller_biz
  FROM profiles WHERE id = auth.uid() AND role = 'admin';

  IF v_caller_biz IS NULL THEN
    RAISE EXCEPTION 'Access denied: admin only';
  END IF;

  SELECT business_id INTO v_target_biz
  FROM profiles WHERE id = p_user_id;

  IF v_target_biz IS NULL OR v_target_biz != v_caller_biz THEN
    RAISE EXCEPTION 'User not found in your business';
  END IF;

  -- Upsert each day
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_schedule)
  LOOP
    INSERT INTO user_access_schedules (user_id, business_id, day_of_week, start_time, end_time, is_enabled)
    VALUES (
      p_user_id,
      v_caller_biz,
      (v_item->>'day')::integer,
      (v_item->>'start')::time,
      (v_item->>'end')::time,
      COALESCE((v_item->>'enabled')::boolean, true)
    )
    ON CONFLICT (user_id, day_of_week) DO UPDATE SET
      start_time = EXCLUDED.start_time,
      end_time = EXCLUDED.end_time,
      is_enabled = EXCLUDED.is_enabled;
  END LOOP;
END;
$$;


-- ─────────────────────────────────────────────
-- 2c. RPC: Check if user is within allowed hours
-- Called by register_device_session and heartbeat
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION check_user_access_allowed(p_user_id UUID)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_profile RECORD;
  v_schedule RECORD;
  v_now_time time;
  v_today integer;
BEGIN
  -- Check if user is active
  SELECT is_active, suspended_at, deleted_at, full_name
  INTO v_profile
  FROM profiles WHERE id = p_user_id;

  IF v_profile IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'Account not found');
  END IF;

  IF v_profile.is_active = false THEN
    IF v_profile.deleted_at IS NOT NULL THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'Account has been deactivated. Contact your administrator.');
    ELSE
      RETURN jsonb_build_object('allowed', false, 'reason', 'Your account has been suspended. Contact your administrator.');
    END IF;
  END IF;

  -- Check working hours schedule
  -- Use Africa/Kampala timezone for Uganda businesses
  v_now_time := (now() AT TIME ZONE 'Africa/Kampala')::time;
  v_today := EXTRACT(DOW FROM now() AT TIME ZONE 'Africa/Kampala')::integer;

  SELECT * INTO v_schedule
  FROM user_access_schedules
  WHERE user_id = p_user_id AND day_of_week = v_today;

  -- If no schedule exists for this user, allow access (no restrictions set)
  IF v_schedule IS NULL THEN
    RETURN jsonb_build_object('allowed', true);
  END IF;

  -- If day is disabled (day off), block
  IF v_schedule.is_enabled = false THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'Access is not allowed on this day. Contact your administrator.'
    );
  END IF;

  -- Check time range
  IF v_now_time < v_schedule.start_time OR v_now_time > v_schedule.end_time THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'Access is only allowed between ' ||
        to_char(v_schedule.start_time, 'HH12:MI AM') || ' and ' ||
        to_char(v_schedule.end_time, 'HH12:MI AM') || '. Contact your administrator.'
    );
  END IF;

  RETURN jsonb_build_object('allowed', true);
END;
$$;


-- ═══════════════════════════════════════════════════════════════
-- 3. User Limits Per Subscription Plan
-- ═══════════════════════════════════════════════════════════════

-- Set max_users per plan (column already exists from initial migration)
-- free_trial: 3 users, basic: 10 users, pro: 25 users
UPDATE subscription_plans SET max_users = 3   WHERE name = 'free_trial';
UPDATE subscription_plans SET max_users = 10  WHERE name = 'basic';
UPDATE subscription_plans SET max_users = 25  WHERE name = 'pro';
UPDATE subscription_plans SET max_users = 1   WHERE name = 'starter';

-- RPC: Check if business can add more users
CREATE OR REPLACE FUNCTION check_user_limit(p_business_id UUID)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_max_users integer;
  v_current_count integer;
BEGIN
  -- Get max_users from the business's plan
  SELECT sp.max_users INTO v_max_users
  FROM subscriptions s
  JOIN subscription_plans sp ON sp.id = s.plan_id
  WHERE s.business_id = p_business_id
    AND s.status IN ('trial', 'active')
  ORDER BY sp.sort_order DESC
  LIMIT 1;

  -- Default to 3 if no plan found
  IF v_max_users IS NULL THEN
    v_max_users := 3;
  END IF;

  -- -1 means unlimited
  IF v_max_users = -1 THEN
    RETURN jsonb_build_object('allowed', true, 'max_users', -1);
  END IF;

  -- Count active (non-deleted) users in the business
  SELECT COUNT(*) INTO v_current_count
  FROM profiles
  WHERE business_id = p_business_id
    AND deleted_at IS NULL;

  IF v_current_count >= v_max_users THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'max_users', v_max_users,
      'current_count', v_current_count
    );
  END IF;

  RETURN jsonb_build_object(
    'allowed', true,
    'max_users', v_max_users,
    'current_count', v_current_count
  );
END;
$$;
