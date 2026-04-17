-- ============================================
-- Fast Onboarding Migration (Atomic RPC)
-- This function atomizes account setup to under 1s
-- ============================================

CREATE OR REPLACE FUNCTION setup_new_account(
    p_user_id UUID,
    p_full_name TEXT,
    p_business_name TEXT
)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_business_id UUID;
    v_branch_id UUID;
BEGIN
    -- 1. Create Business
    INSERT INTO businesses (name)
    VALUES (p_business_name)
    RETURNING id INTO v_business_id;

    -- 2. Create Default "Main" Branch
    INSERT INTO branches (business_id, name, location)
    VALUES (v_business_id, 'Main Branch', '')
    RETURNING id INTO v_branch_id;

    -- 3. Create Admin Profile
    INSERT INTO profiles (id, business_id, branch_id, full_name, role)
    VALUES (p_user_id, v_business_id, v_branch_id, p_full_name, 'admin');

    -- 4. Seed Chart of Accounts (runs internally, no network hop)
    PERFORM seed_chart_of_accounts(v_business_id);

    -- Return the result
    RETURN json_build_object(
        'business_id', v_business_id,
        'branch_id', v_branch_id
    );
EXCEPTION WHEN OTHERS THEN
    -- Fallback for any errors during atomization
    RAISE EXCEPTION 'Setup failed: %', SQLERRM;
END;
$$;
