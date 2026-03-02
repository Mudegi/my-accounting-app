-- ════════════════════════════════════════════════════════════
-- MANUAL PAYMENT (MoMo) MIGRATION
-- Run in Supabase SQL Editor
-- Adds: payment_reason column, phone_number display in admin RPCs,
--        pending_reason for businesses, updated admin RPCs
-- ════════════════════════════════════════════════════════════

-- ─── 1. ADD payment_reason AND phone_number COLUMNS TO PAYMENTS ────
ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_reason TEXT;
-- phone_number may already exist, but just in case:
ALTER TABLE payments ADD COLUMN IF NOT EXISTS phone_number TEXT;


-- ─── 2. UPDATE admin_list_businesses TO INCLUDE PENDING PAYMENT REASON ────
-- Shows the most recent pending payment reason alongside each business

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
  user_count bigint,
  pending_reason text
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
    (SELECT COUNT(*) FROM profiles pr WHERE pr.business_id = b.id) AS user_count,
    (
      SELECT pay.payment_reason
      FROM payments pay
      WHERE pay.business_id = b.id AND pay.status = 'pending' AND pay.payment_reason IS NOT NULL
      ORDER BY pay.created_at DESC
      LIMIT 1
    )::text AS pending_reason
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


-- ─── 3. UPDATE admin_list_payments TO INCLUDE REASON AND PHONE ────

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
  payment_reason text,
  phone_number text,
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
    pay.payment_reason::text,
    pay.phone_number::text,
    pay.status::text,
    pay.paid_at,
    pay.created_at
  FROM payments pay
  JOIN businesses b ON b.id = pay.business_id
  ORDER BY pay.created_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;
