-- ═══════════════════════════════════════════════════════════════
-- MIGRATION: Move EFRIS controls to Super Admin
-- Adds EFRIS fields to admin_list_businesses RPC
-- ═══════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS admin_list_businesses();

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
  is_efris_enabled boolean,
  efris_api_key text,
  efris_api_url text,
  efris_test_mode boolean
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
    b.is_efris_enabled,
    b.efris_api_key::text,
    b.efris_api_url::text,
    b.efris_test_mode
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
