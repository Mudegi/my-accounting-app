-- ============================================
-- Consolidated Account Setup Migration
-- Updates setup_new_account to handle country, currency, and auto-trial
-- ============================================

CREATE OR REPLACE FUNCTION setup_new_account(
    p_user_id UUID,
    p_full_name TEXT,
    p_business_name TEXT,
    p_country TEXT,
    p_currency TEXT
)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_business_id UUID;
    v_branch_id UUID;
    v_plan_id UUID;
BEGIN
    -- 1. Create Business with base country and currency
    INSERT INTO businesses (name, country, default_currency, subscription_status)
    VALUES (p_business_name, p_country, p_currency, 'trial')
    RETURNING id INTO v_business_id;

    -- 2. Create Default "Main" Branch
    INSERT INTO branches (business_id, name, location)
    VALUES (v_business_id, 'Main Branch', '')
    RETURNING id INTO v_branch_id;

    -- 3. Create Admin Profile
    INSERT INTO profiles (id, business_id, branch_id, full_name, role)
    VALUES (p_user_id, v_business_id, v_branch_id, p_full_name, 'admin');

    -- 4. Seed Chart of Accounts
    PERFORM seed_chart_of_accounts(v_business_id);

    -- 5. Auto-Activate Free Trial
    -- Get the ID for the 'free_trial' plan
    SELECT id INTO v_plan_id FROM subscription_plans WHERE name = 'free_trial' LIMIT 1;
    
    IF v_plan_id IS NOT NULL THEN
        INSERT INTO subscriptions (
            business_id, 
            plan_id, 
            status, 
            billing_cycle, 
            current_period_start, 
            current_period_end, 
            trial_ends_at
        )
        VALUES (
            v_business_id,
            v_plan_id,
            'trial',
            'monthly',
            NOW(),
            NOW() + INTERVAL '30 days',
            NOW() + INTERVAL '30 days'
        );
        
        -- Update business with trial end date
        UPDATE businesses 
        SET subscription_ends_at = NOW() + INTERVAL '30 days'
        WHERE id = v_business_id;
    END IF;

    -- Return the result
    RETURN json_build_object(
        'business_id', v_business_id,
        'branch_id', v_branch_id,
        'plan_id', v_plan_id
    );
EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Setup failed: %', SQLERRM;
END;
$$;
