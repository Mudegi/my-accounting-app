
-- Get daily signup trend for platform admin dashboard
CREATE OR REPLACE FUNCTION admin_platform_signup_trend(p_days int DEFAULT 14)
RETURNS TABLE (day date, count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND is_super_admin = true
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT 
    d.day::date,
    COUNT(b.id) as count
  FROM (
    SELECT generate_series(CURRENT_DATE - (p_days - 1) * INTERVAL '1 day', CURRENT_DATE, '1 day')::date AS day
  ) d
  LEFT JOIN businesses b ON b.created_at::date = d.day
  GROUP BY d.day
  ORDER BY d.day ASC;
END;
$$;
