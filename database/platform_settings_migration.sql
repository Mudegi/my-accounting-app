-- ═══════════════════════════════════════════════════════════════════
-- Platform Settings Migration
-- Global settings managed by Super Admin — contact info, etc.
-- ═══════════════════════════════════════════════════════════════════

-- 1. Create platform_settings table (single-row key-value store)
CREATE TABLE IF NOT EXISTS platform_settings (
  key    text PRIMARY KEY,
  value  text NOT NULL DEFAULT ''
);

-- Enable RLS
ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY;

-- Everyone can read settings
DROP POLICY IF EXISTS "Anyone can read platform settings" ON platform_settings;
CREATE POLICY "Anyone can read platform settings" ON platform_settings
  FOR SELECT USING (true);

-- Only super admins can update
DROP POLICY IF EXISTS "Super admins can update platform settings" ON platform_settings;
CREATE POLICY "Super admins can update platform settings" ON platform_settings
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_super_admin = true)
  );

-- Only super admins can insert
DROP POLICY IF EXISTS "Super admins can insert platform settings" ON platform_settings;
CREATE POLICY "Super admins can insert platform settings" ON platform_settings
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_super_admin = true)
  );


-- 2. Seed default contact settings (empty — admin fills them in)
INSERT INTO platform_settings (key, value) VALUES
  ('contact_phone', ''),
  ('contact_whatsapp', ''),
  ('contact_email', '')
ON CONFLICT (key) DO NOTHING;


-- 3. RPC: Get all platform settings (public read)
CREATE OR REPLACE FUNCTION get_platform_settings()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result jsonb := '{}'::jsonb;
  r record;
BEGIN
  FOR r IN SELECT key, value FROM platform_settings LOOP
    v_result := v_result || jsonb_build_object(r.key, r.value);
  END LOOP;
  RETURN v_result;
END;
$$;


-- 4. RPC: Update a platform setting (super admin only)
CREATE OR REPLACE FUNCTION update_platform_setting(p_key text, p_value text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND is_super_admin = true
  ) THEN
    RAISE EXCEPTION 'Super admin access required';
  END IF;

  INSERT INTO platform_settings (key, value)
  VALUES (p_key, p_value)
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
END;
$$;
