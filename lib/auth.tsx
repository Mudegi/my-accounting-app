import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { Session, User } from '@supabase/supabase-js';
import { loadCurrencies, getCurrency, formatCurrency, type Currency } from './currency';
import { checkSubscription, type SubscriptionStatus } from './subscription';

const IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const LAST_ACTIVE_KEY = '@yourbooks_last_active';

type Profile = {
  id: string;
  business_id: string;
  branch_id: string | null;
  full_name: string;
  role: 'admin' | 'branch_manager' | 'salesperson';
  phone: string | null;
  is_active: boolean;
  is_super_admin?: boolean;
};

type Business = {
  id: string;
  name: string;
  tin: string | null;
  is_efris_enabled: boolean;
  efris_api_key: string | null;
  efris_api_url: string | null;
  efris_test_mode: boolean;
  app_mode: 'basic' | 'pro';
  default_currency: string;
  subscription_status: 'trial' | 'active' | 'past_due' | 'cancelled' | 'expired' | null;
  subscription_ends_at: string | null;
};

type Branch = {
  id: string;
  business_id: string;
  name: string;
  location: string | null;
  is_efris_enabled: boolean;
};

type AuthContextType = {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  business: Business | null;
  branches: Branch[];
  currentBranch: Branch | null;
  loading: boolean;
  currency: Currency;
  fmt: (amount: number) => string;
  subscriptionStatus: SubscriptionStatus | null;
  isSuperAdmin: boolean;
  signIn: (email: string, password: string) => Promise<{ error: any }>;
  signUp: (email: string, password: string, fullName: string, businessName: string) => Promise<{ error: any }>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<{ error: any }>;
  changePassword: (newPassword: string) => Promise<{ error: any }>;
  setCurrentBranch: (branch: Branch) => void;
  refreshBusiness: () => Promise<void>;
  reloadUserData: () => Promise<void>;
  refreshSubscription: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  profile: null,
  business: null,
  branches: [],
  currentBranch: null,
  loading: true,
  currency: { code: 'UGX', name: 'Ugandan Shilling', symbol: 'UGX', decimal_places: 0 },
  fmt: (a: number) => `UGX ${Math.round(a).toLocaleString()}`,
  subscriptionStatus: null,
  isSuperAdmin: false,
  signIn: async () => ({ error: null }),
  signUp: async () => ({ error: null }),
  signOut: async () => {},
  resetPassword: async () => ({ error: null }),
  changePassword: async () => ({ error: null }),
  setCurrentBranch: () => {},
  refreshBusiness: async () => {},
  reloadUserData: async () => {},
  refreshSubscription: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [business, setBusiness] = useState<Business | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [currentBranch, setCurrentBranch] = useState<Branch | null>(null);
  const [loading, setLoading] = useState(true);
  const [subscriptionStatus, setSubscriptionStatus] = useState<SubscriptionStatus | null>(null);
  const initialLoadDone = React.useRef(false);
  const appState = useRef(AppState.currentState);

  // ── Idle auto-logout: track last active time ──
  const touchActivity = async () => {
    try { await AsyncStorage.setItem(LAST_ACTIVE_KEY, Date.now().toString()); } catch {}
  };

  useEffect(() => {
    // Record activity on mount
    if (session) touchActivity();

    const handleAppStateChange = async (nextState: AppStateStatus) => {
      if (nextState === 'active' && appState.current.match(/inactive|background/)) {
        // App came to foreground — check idle timeout
        try {
          const last = await AsyncStorage.getItem(LAST_ACTIVE_KEY);
          if (last && Date.now() - parseInt(last, 10) > IDLE_TIMEOUT_MS) {
            // Idle too long → force logout
            console.log('Auto-logout: idle >10 min');
            await supabase.auth.signOut();
            return;
          }
        } catch {}
        touchActivity();
      } else if (nextState.match(/inactive|background/)) {
        // Going to background — stamp the time
        touchActivity();
      }
      appState.current = nextState;
    };

    const sub = AppState.addEventListener('change', handleAppStateChange);
    return () => sub.remove();
  }, [session]);

  useEffect(() => {
    // Get initial session — fast path, no network call
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        initialLoadDone.current = true;
        loadUserData(session.user.id);
      } else {
        setLoading(false);
      }
    });

    // Listen for subsequent auth changes (sign in, sign out, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        // Skip the INITIAL_SESSION event — we already handled it above
        if (_event === 'INITIAL_SESSION') return;

        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user) {
          await loadUserData(session.user.id);
        } else {
          setProfile(null);
          setBusiness(null);
          setBranches([]);
          setCurrentBranch(null);
          setLoading(false);
        }
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const loadUserData = async (userId: string) => {
    try {
      // Load profile
      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (profileError) {
        console.error('Profile load error:', profileError.message, profileError.code);
        return;
      }

      if (!profileData) {
        console.error('No profile data returned for user:', userId);
        return;
      }

      setProfile(profileData);

      // Load business
      const { data: businessData, error: bizError } = await supabase
        .from('businesses')
        .select('*')
        .eq('id', profileData.business_id)
        .single();

      if (bizError) {
        console.error('Business load error:', bizError);
      }
      if (businessData) {
        setBusiness(businessData);

        // Load currencies + check subscription in parallel
        try {
          const [, subStatus] = await Promise.all([
            loadCurrencies(),
            checkSubscription(businessData.id),
          ]);
          setSubscriptionStatus(subStatus);
        } catch (e) {
          console.error('Currency/subscription load error:', e);
        }
      }

      // Load branches
      const { data: branchesData, error: branchError } = await supabase
        .from('branches')
        .select('*')
        .eq('business_id', profileData.business_id)
        .order('name');

      if (branchError) {
        console.error('Branches load error:', branchError);
      }
      if (branchesData) {
        setBranches(branchesData);
        // Auto-select branch based on user role
        if (profileData.branch_id) {
          const userBranch = branchesData.find((b: any) => b.id === profileData.branch_id);
          if (userBranch) setCurrentBranch(userBranch);
        } else if (branchesData.length > 0) {
          setCurrentBranch(branchesData[0]);
        }
      }
    } catch (error: any) {
      console.error('Error loading user data:', error);
    } finally {
      setLoading(false);
    }
  };

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (!error) touchActivity();
    return { error };
  };

  const signUp = async (email: string, password: string, fullName: string, businessName: string) => {
    // 1. Create the auth user
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
    });

    if (authError) return { error: authError };

    if (authData.user) {
      // 2. Create business
      const { data: businessData, error: bizError } = await supabase
        .from('businesses')
        .insert({ name: businessName })
        .select()
        .single();

      if (bizError) return { error: bizError };

      // 3. Create a default "Main" branch
      const { data: branchData, error: branchError } = await supabase
        .from('branches')
        .insert({
          business_id: businessData.id,
          name: 'Main Branch',
          location: '',
        })
        .select()
        .single();

      if (branchError) return { error: branchError };

      // 4. Create profile as admin
      const { error: profileError } = await supabase
        .from('profiles')
        .insert({
          id: authData.user.id,
          business_id: businessData.id,
          branch_id: branchData.id,
          full_name: fullName,
          role: 'admin',
        });

      if (profileError) return { error: profileError };

      // 5. Seed chart of accounts
      await supabase.rpc('seed_chart_of_accounts', { p_business_id: businessData.id });
    }

    return { error: null };
  };

  const signOut = async () => {
    await AsyncStorage.removeItem(LAST_ACTIVE_KEY);
    await supabase.auth.signOut();
  };

  const resetPassword = async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: 'yourbookslite://reset-password',
    });
    return { error };
  };

  const changePassword = async (newPassword: string) => {
    const { error } = await supabase.auth.updateUser({
      password: newPassword,
      data: { needs_password_change: false },
    });
    if (!error) {
      // Update local user state to clear the prompt
      const { data: { user: updatedUser } } = await supabase.auth.getUser();
      if (updatedUser) setUser(updatedUser);
    }
    return { error };
  };

  const reloadUserData = async () => {
    const { data: { session: s } } = await supabase.auth.getSession();
    if (s?.user) {
      setLoading(true);
      await loadUserData(s.user.id);
    }
  };

  const refreshBusiness = async () => {
    if (!profile?.business_id) return;
    const { data: businessData } = await supabase
      .from('businesses')
      .select('*')
      .eq('id', profile.business_id)
      .single();
    if (businessData) setBusiness(businessData);
  };

  const refreshSubscription = async () => {
    if (!business?.id) return;
    const status = await checkSubscription(business.id);
    setSubscriptionStatus(status);
  };

  // Derived: currency helpers based on business default_currency
  const currency = getCurrency(business?.default_currency || 'UGX');
  const fmt = (amount: number) => formatCurrency(amount, business?.default_currency || 'UGX');
  const isSuperAdmin = profile?.is_super_admin === true;

  return (
    <AuthContext.Provider
      value={{
        session,
        user,
        profile,
        business,
        branches,
        currentBranch,
        loading,
        currency,
        fmt,
        subscriptionStatus,
        isSuperAdmin,
        signIn,
        signUp,
        signOut,
        resetPassword,
        changePassword,
        setCurrentBranch,
        refreshBusiness,
        reloadUserData,
        refreshSubscription,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
