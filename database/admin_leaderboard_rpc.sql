
-- Get business activity leaderboard for platform admin
CREATE OR REPLACE FUNCTION admin_platform_business_leaderboard(
  p_period text DEFAULT 'month' -- 'today', 'week', 'month'
)
RETURNS TABLE (
  business_id UUID,
  business_name text,
  transaction_count bigint,
  total_revenue numeric,
  last_activity timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_from timestamptz;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND is_super_admin = true
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  CASE p_period
    WHEN 'today' THEN v_from := CURRENT_DATE;
    WHEN 'week' THEN v_from := CURRENT_DATE - INTERVAL '7 days';
    WHEN 'month' THEN v_from := CURRENT_DATE - INTERVAL '30 days';
    ELSE v_from := CURRENT_DATE - INTERVAL '30 days';
  END CASE;

  RETURN QUERY
  SELECT 
    b.id as business_id,
    b.name::text as business_name,
    COUNT(s.id) as transaction_count,
    COALESCE(SUM(s.total_amount), 0) as total_revenue,
    MAX(s.created_at) as last_activity
  FROM businesses b
  LEFT JOIN sales s ON s.business_id = b.id AND s.created_at >= v_from AND s.status = 'completed'
  GROUP BY b.id, b.name
  ORDER BY transaction_count DESC, total_revenue DESC
  LIMIT 20;
END;
$$;
