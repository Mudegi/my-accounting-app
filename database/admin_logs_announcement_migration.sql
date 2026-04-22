-- ═══════════════════════════════════════════════════════════════════
-- Platform Admin Activity Logs & Announcements
-- ═══════════════════════════════════════════════════════════════════

-- 1. Ensure platform_announcement key exists
INSERT INTO platform_settings (key, value)
VALUES ('platform_announcement', '')
ON CONFLICT (key) DO NOTHING;

-- 2. RPC: admin_list_activity_logs
-- Aggregates recent sales and other key events across the platform
CREATE OR REPLACE FUNCTION admin_list_activity_logs(
  p_limit int DEFAULT 50,
  p_offset int DEFAULT 0
)
RETURNS TABLE (
  created_at timestamptz,
  business_name text,
  action_type text,
  details text,
  amount numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND is_super_admin = true
  ) THEN
    RAISE EXCEPTION 'Access denied: super admin only';
  END IF;

  RETURN QUERY
  (
    -- Recent Sales
    SELECT 
      s.created_at,
      b.name::text AS business_name,
      'SALE'::text AS action_type,
      ('Sale by ' || COALESCE(p.full_name, 'Unknown'))::text AS details,
      s.total_amount AS amount
    FROM sales s
    JOIN businesses b ON b.id = s.business_id
    LEFT JOIN profiles p ON p.id = s.user_id
    
    UNION ALL

    -- Recent Payments (Subscriptions)
    SELECT 
      pay.created_at,
      b.name::text AS business_name,
      'PAYMENT'::text AS action_type,
      (pay.payment_method || ' payment for ' || pay.currency)::text AS details,
      pay.amount
    FROM payments pay
    JOIN businesses b ON b.id = pay.business_id
    
    UNION ALL

    -- New Business Registrations
    SELECT 
      b.created_at,
      b.name::text AS business_name,
      'SIGNUP'::text AS action_type,
      ('New business registered in ' || COALESCE(b.country, 'Unknown'))::text AS details,
      0::numeric AS amount
    FROM businesses b
  )
  ORDER BY created_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;
