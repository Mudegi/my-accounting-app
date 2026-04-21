import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { Session, User } from '@supabase/supabase-js';
import { loadCurrencies, getCurrency, formatCurrency, type Currency } from './currency';
import { checkSubscription, type SubscriptionStatus } from './subscription';
import { registerDeviceSession, removeDeviceSession, heartbeatSession } from './device-sessions';

const IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const LAST_ACTIVE_KEY = '@yourbooks_last_active';

type Profile = {
  id: string;
  business_id: string;
  branch_id: string | null;
  full_name: string;
  role: 'admin' | 'branch_manager' | 'salesperson';
  sales_type: 'in_store' | 'field' | 'both';
  phone: string | null;
  is_active: boolean;
  is_super_admin?: boolean;
};

type Business = {
  id: string;
  name: string;
  tin: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  receipt_footer: string | null;
  is_efris_enabled: boolean;
  efris_api_key: string | null;
  efris_api_url: string | null;
  efris_test_mode: boolean;
  app_mode: 'basic' | 'pro';
  default_currency: string;
  subscription_status: 'trial' | 'active' | 'approved' | 'past_due' | 'cancelled' | 'expired' | null;
  subscription_ends_at: string | null;
  logo_url: string | null;
  fiscal_year_start_month: number;
};

type Branch = {
  id: string;
  business_id: string;
  name: string;
  location: string | null;
  is_efris_enabled: boolean;
};

export type TaxRate = {
  id: string;
  name: string;
  code: string;
  rate: number;
  is_active: boolean;
  is_default: boolean;
};

type AuthContextType = {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  business: Business | null;
  branches: Branch[];
  currentBranch: Branch | null;
  loading: boolean;
  isInitializing: boolean;
  currency: Currency;
  taxes: TaxRate[];
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
  hasFeature: (feature: string) => boolean;
};

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  profile: null,
  business: null,
  branches: [],
  currentBranch: null,
  taxes: [],
  loading: true,
  isInitializing: false,
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
  hasFeature: () => false,
});

export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [business, setBusiness] = useState<Business | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [currentBranch, setCurrentBranch] = useState<Branch | null>(null);
  const [taxes, setTaxes] = useState<TaxRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [isInitializing, setIsInitializing] = useState(false);
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
        
        // Heartbeat to keep session alive + check access
        // IMPORTANT: Only heartbeat if we have a profile. 
        // If we don't have a profile yet, it means we are still signing in, 
        // and calling heartbeat too early causes an "Account not found" error.
        if (session && profile) {
          const hb = await heartbeatSession();
          if (hb && !hb.allowed) {
            const { Alert } = require('react-native');
            Alert.alert(
              'Access Revoked',
              hb.reason || 'Your access has been revoked. Contact your administrator.',
              [{ text: 'OK', onPress: () => supabase.auth.signOut() }]
            );
            return;
          }
        }
      } else if (nextState.match(/inactive|background/)) {
        // Going to background — stamp the time
        touchActivity();
      }
      appState.current = nextState;
    };

    const sub = AppState.addEventListener('change', handleAppStateChange);
    return () => sub.remove();
  }, [session, profile]);

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
      // Load profile (retry a few times if not found, useful for new sign-ups)
      let profileData = null;
      let profileError = null;
      let retries = 0;
      const MAX_RETRIES = 5;

      while (retries < MAX_RETRIES) {
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', userId)
          .maybeSingle(); // Better than .single() because we expect it might be missing
        
        if (data) {
          profileData = data;
          break;
        }
        
        if (error && error.code !== 'PGRST116') { // PGRST116 is just "no rows found"
          console.error('Profile query error:', error.message);
        }
        
        console.log(`Waiting for profile... attempt ${retries + 1}`);
        await new Promise(resolve => setTimeout(resolve, 800 * (retries + 1))); // Incremental backoff
        retries++;
      }

      if (!profileData) {
        console.error('No profile record found after retries for user:', userId);
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

        // Enforce device limit
        await enforceDeviceLimit(businessData.id);
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
      }

      // Load Taxes
      const { data: taxesData } = await supabase
        .from('tax_rates')
        .select('*')
        .eq('business_id', profileData.business_id)
        .eq('is_active', true)
        .order('rate', { ascending: false });

      if (taxesData) {
        setTaxes(taxesData.map((t: any) => ({
          id: t.id,
          name: t.name,
          code: t.code,
          rate: Number(t.rate),
          is_active: t.is_active,
          is_default: t.is_default
        })));
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

  // ── Device session enforcement: called after profile + business are loaded ──
  const enforceDeviceLimit = async (bizId: string) => {
    try {
      const result = await registerDeviceSession(bizId);
      if (!result.allowed) {
        const { Alert } = require('react-native');
        // If reason is set, it's a suspension/schedule denial
        if (result.reason) {
          Alert.alert(
            'Access Denied',
            result.reason,
            [{ text: 'OK', onPress: () => supabase.auth.signOut() }]
          );
        } else {
          Alert.alert(
            'Device Limit Reached',
            `Your plan allows ${result.maxDevices} device${result.maxDevices === 1 ? '' : 's'}. ` +
            `${result.activeCount} already active.\n\nPlease log out from another device or upgrade your plan.`,
            [{ text: 'OK', onPress: () => supabase.auth.signOut() }]
          );
        }
        return false;
      }
    } catch (e) {
      console.error('Device limit check error:', e);
    }
    return true;
  };

  const signUp = async (email: string, password: string, fullName: string, businessName: string, country: string, currency: string) => {
    try {
      setIsInitializing(true);
      // 1. Create the auth user
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
      });

      if (authError) {
        setIsInitializing(false);
        return { error: authError };
      }

      if (authData.user) {
        // 2. Setup the entire account at once (Atomic RPC)
        const { error: setupError } = await supabase.rpc('setup_new_account', {
          p_user_id: authData.user.id,
          p_full_name: fullName,
          p_business_name: businessName,
          p_country: country,
          p_currency: currency,
        });

        if (setupError) {
          setIsInitializing(false);
          return { error: setupError };
        }

        // 3. Ensure the user is signed in.
        // If supabase.auth.signUp didn't return a session (e.g. email verification is enabled or config differs),
        // we explicitly sign in here to get a session.
        if (!authData.session) {
          const { error: signInError } = await supabase.auth.signInWithPassword({
            email,
            password,
          });
          if (signInError) {
            setIsInitializing(false);
            return { error: signInError };
          }
        }

        // 4. Manually load user data to ensure state is ready BEFORE we release the UI
        // This is important because the onAuthStateChange listener might be slightly delayed
        await loadUserData(authData.user.id);
      }

      setIsInitializing(false);
      return { error: null };
    } catch (e: any) {
      console.error('Signup error:', e);
      setIsInitializing(false);
      return { error: { message: e.message || 'Signup failed' } };
    }
  };

  const signOut = async () => {
    await removeDeviceSession();
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

  const hasFeature = (feature: string) => {
    if (isSuperAdmin) return true;
    if (!subscriptionStatus?.active) return false;
    return subscriptionStatus.features?.includes(feature) || false;
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        user,
        profile,
        business,
        branches,
        currentBranch,
        taxes,
        loading,
        isInitializing,
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
        hasFeature,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
