import FontAwesome from '@expo/vector-icons/FontAwesome';
import { DarkTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState, useRef } from 'react';
import 'react-native-reanimated';
import { ActivityIndicator, TouchableOpacity, Modal, TextInput, StyleSheet, Alert, KeyboardAvoidingView, Platform, AppState, type AppStateStatus } from 'react-native';
import { View, Text } from '@/components/Themed';

import { AuthProvider, useAuth } from '@/lib/auth';
import { SubscriptionBanner } from '@/components/SubscriptionBanner';
import * as Network from 'expo-network';

export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary,
} from 'expo-router';

export const unstable_settings = {
  // Ensure that reloading on `/modal` keeps a back button present.
  initialRouteName: '(tabs)',
};

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
    ...FontAwesome.font,
  });

  // Expo Router uses Error Boundaries to catch errors in the navigation tree.
  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded) {
    return null;
  }

  return (
    <AuthProvider>
      <RootLayoutNav />
    </AuthProvider>
  );
}

function RootLayoutNav() {
  const { session, user, loading, error, isInitializing, profile, business, subscriptionStatus, signOut, reloadUserData, changePassword } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const [showPasswordPrompt, setShowPasswordPrompt] = useState(false);
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [changingPwd, setChangingPwd] = useState(false);
  const [showPwd, setShowPwd] = useState(false);
  const appState = useRef(AppState.currentState);
  const lastConnected = useRef<boolean | null>(null);

  // Show loading while auth is initializing OR while session exists but profile isn't ready yet
  const isSyncing = session && !profile;
  const showSpinner = loading || isInitializing || isSyncing;

  // Monitor network connectivity and AppState for background/foreground refresh
  useEffect(() => {
    const handleAppStateChange = async (nextState: AppStateStatus) => {
      if (nextState === 'active' && appState.current.match(/inactive|background/)) {
        console.log('[App] Foregrounded, checking connection...');
        const state = await Network.getNetworkStateAsync();
        if (state.isConnected && state.isInternetReachable) {
          reloadUserData();
        }
      }
      appState.current = nextState;
    };

    const checkConnectivity = async () => {
      const state = await Network.getNetworkStateAsync();
      const isOnline = !!(state.isConnected && state.isInternetReachable);
      
      // If we transition from offline to online, refresh
      if (lastConnected.current === false && isOnline === true) {
        console.log('[Network] Back online! Auto-refreshing...');
        reloadUserData();
      }
      lastConnected.current = isOnline;
    };

    const appStateSub = AppState.addEventListener('change', handleAppStateChange);
    const connInterval = setInterval(checkConnectivity, 10000);

    return () => {
      appStateSub.remove();
      clearInterval(connInterval);
    };
  }, []);

  // Auto-retry sync in background if taking too long (>15s)
  useEffect(() => {
    let timer: NodeJS.Timeout;
    let interval: NodeJS.Timeout;

    if (showSpinner) {
      timer = setTimeout(() => {
        // After 15s of spinning, start auto-retrying every 10s
        interval = setInterval(() => {
          console.log('[Sync] Background auto-retry...');
          reloadUserData();
        }, 10000);
      }, 15000);
    }

    return () => {
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, [showSpinner]);

  // Detect first login for invited users — prompt password change
  useEffect(() => {
    if (!loading && session && user) {
      const meta = user.user_metadata;
      if (meta?.needs_password_change === true) {
        setShowPasswordPrompt(true);
      }
    }
  }, [loading, session, user]);

  const handleFirstPasswordChange = async () => {
    if (!newPwd.trim()) { Alert.alert('Error', 'Please enter a new password'); return; }
    if (newPwd.length < 6) { Alert.alert('Error', 'Password must be at least 6 characters'); return; }
    if (newPwd !== confirmPwd) { Alert.alert('Error', 'Passwords do not match'); return; }
    setChangingPwd(true);
    const { error } = await changePassword(newPwd);
    setChangingPwd(false);
    if (error) {
      Alert.alert('Error', error.message);
    } else {
      Alert.alert('Password Updated!', 'Your password has been changed successfully. You\'re all set!');
      setShowPasswordPrompt(false);
      setNewPwd('');
      setConfirmPwd('');
    }
  };

  useEffect(() => {
    if (loading) return;

    const inAuthGroup = segments[0] === 'login';
    const inOnboarding = segments[0] === 'onboarding';
    const inSubscription = segments[0] === 'subscription';

    if (!session && !inAuthGroup) {
      // Not signed in → redirect to login
      router.replace('/login');
    } else if (session && !profile && !inOnboarding) {
      // Signed in but no profile → needs onboarding/setup
      router.replace('/onboarding');
    } else if (session && profile && inAuthGroup) {
      // Signed in → check if needs onboarding
      const needsOnboarding = !business || !business.name || !business.country || !business.default_currency;
      
      if (needsOnboarding) {
        router.replace('/onboarding');
      } else if (business.subscription_status === 'expired' || business.subscription_status === 'cancelled') {
        router.replace('/subscription');
      } else {
        router.replace('/(tabs)');
      }
    } else if (session && !inAuthGroup && !inOnboarding && !inSubscription && business) {
      // Already signed in — enforce paywall for expired/cancelled
      const needsOnboarding = !business.name || !business.country || !business.default_currency;
      if (needsOnboarding) {
        router.replace('/onboarding');
      } else if (business.subscription_status === 'expired' || business.subscription_status === 'cancelled') {
        router.replace('/subscription');
      }
    }
  }, [session, loading, segments, business]);

  // Show loading while auth is initializing OR while session exists but profile isn't ready yet


  if (showSpinner) {
    const inOnboarding = segments[0] === 'onboarding';
    let spinnerText = "Syncing your data...";
    
    if (isInitializing) {
      spinnerText = "Signing in...";
    } else if (inOnboarding) {
      spinnerText = "Hold on, we're setting up your account...";
    } else if (segments[0] === 'login') {
      spinnerText = "Signing in...";
    }

    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#1a1a2e', paddingHorizontal: 32 }}>
        <View style={{ marginBottom: 40, alignItems: 'center' }}>
          <Text style={{ fontSize: 32, fontWeight: 'bold', color: '#e94560', marginBottom: 10 }}>📒 YourBooks</Text>
          {!error && <ActivityIndicator size="large" color="#e94560" />}
        </View>
        
        {error ? (
          <View style={{ alignItems: 'center' }}>
            <Text style={{ color: '#ff4d4d', fontSize: 16, textAlign: 'center', marginBottom: 20 }}>{error}</Text>
            <TouchableOpacity 
              onPress={() => reloadUserData()}
              style={{ backgroundColor: '#e94560', paddingVertical: 12, paddingHorizontal: 24, borderRadius: 8, marginBottom: 12 }}
            >
              <Text style={{ color: '#fff', fontWeight: 'bold' }}>Try Again</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => signOut()}>
              <Text style={{ color: '#888', textDecorationLine: 'underline' }}>Sign Out</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <Text style={{ color: '#fff', fontSize: 18, fontWeight: '600', textAlign: 'center' }}>{spinnerText}</Text>
        )}
      </View>
    );
  }

  // Force dark theme — the entire app uses dark colors
  const appTheme = {
    ...DarkTheme,
    colors: {
      ...DarkTheme.colors,
      background: '#1a1a2e',
      card: '#16213e',
      text: '#fff',
      border: '#0f3460',
      primary: '#e94560',
    },
  };

  return (
    <ThemeProvider value={appTheme}>
      {session && business && <SubscriptionBanner />}
      <Stack>
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="onboarding" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="subscription"
          options={{ title: 'Subscription & Billing', headerStyle: { backgroundColor: '#1a1a2e' }, headerTintColor: '#fff' }}
        />
        <Stack.Screen
          name="platform-admin"
          options={{ title: 'Platform Admin', headerStyle: { backgroundColor: '#1a1a2e' }, headerTintColor: '#fff' }}
        />
        <Stack.Screen
          name="product/[id]"
          options={({ route }: any) => ({
            title: route.params?.id === 'new' ? 'Add Product / Service' : 'Edit Product / Service',
            headerStyle: { backgroundColor: '#1a1a2e' },
            headerTintColor: '#fff',
          })}
        />
        <Stack.Screen
          name="admin/branches"
          options={{ title: 'Manage Branches', headerStyle: { backgroundColor: '#1a1a2e' }, headerTintColor: '#fff' }}
        />
        <Stack.Screen
          name="admin/users"
          options={{ title: 'Manage Users', headerStyle: { backgroundColor: '#1a1a2e' }, headerTintColor: '#fff' }}
        />
        <Stack.Screen
          name="admin/categories"
          options={{ title: 'Product Categories', headerStyle: { backgroundColor: '#1a1a2e' }, headerTintColor: '#fff' }}
        />
        <Stack.Screen
          name="admin/schedule"
          options={{ title: 'Working Hours', headerStyle: { backgroundColor: '#1a1a2e' }, headerTintColor: '#fff' }}
        />
        <Stack.Screen
          name="reports"
          options={{ title: 'Sales Reports', headerStyle: { backgroundColor: '#1a1a2e' }, headerTintColor: '#fff' }}
        />
        <Stack.Screen
          name="tax-center"
          options={{ title: 'Tax Center', headerStyle: { backgroundColor: '#1a1a2e' }, headerTintColor: '#fff' }}
        />
        <Stack.Screen
          name="transfers"
          options={{ title: 'Stock Transfers', headerStyle: { backgroundColor: '#1a1a2e' }, headerTintColor: '#fff' }}
        />
        <Stack.Screen
          name="expenses"
          options={{ title: 'Expenses', headerStyle: { backgroundColor: '#1a1a2e' }, headerTintColor: '#fff' }}
        />
        <Stack.Screen
          name="purchases"
          options={{ title: 'Stock Purchases', headerStyle: { backgroundColor: '#1a1a2e' }, headerTintColor: '#fff' }}
        />
        <Stack.Screen
          name="credit-note"
          options={{ title: 'Credit Notes / Returns', headerStyle: { backgroundColor: '#1a1a2e' }, headerTintColor: '#fff' }}
        />
        <Stack.Screen
          name="suppliers"
          options={{ title: 'Suppliers', headerStyle: { backgroundColor: '#1a1a2e' }, headerTintColor: '#fff' }}
        />
        <Stack.Screen
          name="customers"
          options={{ title: 'Customers', headerStyle: { backgroundColor: '#1a1a2e' }, headerTintColor: '#fff' }}
        />
        <Stack.Screen
          name="sales"
          options={{ title: 'Sales History', headerStyle: { backgroundColor: '#1a1a2e' }, headerTintColor: '#fff' }}
        />
        <Stack.Screen
          name="sale-detail"
          options={{ title: 'Sale Details', headerStyle: { backgroundColor: '#1a1a2e' }, headerTintColor: '#fff' }}
        />
        <Stack.Screen
          name="purchase-history"
          options={{ title: 'Purchase History', headerStyle: { backgroundColor: '#1a1a2e' }, headerTintColor: '#fff' }}
        />
        <Stack.Screen
          name="purchase-detail"
          options={{ title: 'Purchase Details', headerStyle: { backgroundColor: '#1a1a2e' }, headerTintColor: '#fff' }}
        />
        <Stack.Screen
          name="debts"
          options={{ title: 'Customer Debts', headerStyle: { backgroundColor: '#1a1a2e' }, headerTintColor: '#fff' }}
        />
        <Stack.Screen
          name="low-stock"
          options={{ title: 'Low Stock Alerts', headerStyle: { backgroundColor: '#1a1a2e' }, headerTintColor: '#fff' }}
        />
        <Stack.Screen
          name="cash-register"
          options={{ title: 'Cash Register', headerStyle: { backgroundColor: '#1a1a2e' }, headerTintColor: '#fff' }}
        />
        <Stack.Screen
          name="export"
          options={{ title: 'Export Data', headerStyle: { backgroundColor: '#1a1a2e' }, headerTintColor: '#fff' }}
        />
        <Stack.Screen
          name="sales-targets"
          options={{ title: 'Sales Targets', headerStyle: { backgroundColor: '#1a1a2e' }, headerTintColor: '#fff' }}
        />
        <Stack.Screen
          name="loyalty"
          options={{ title: 'Customer Loyalty', headerStyle: { backgroundColor: '#1a1a2e' }, headerTintColor: '#fff' }}
        />
        <Stack.Screen
          name="receipt"
          options={{ title: 'Receipt', headerStyle: { backgroundColor: '#1a1a2e' }, headerTintColor: '#fff', presentation: 'modal' }}
        />
        <Stack.Screen
          name="help"
          options={{ title: 'Help & Guide', headerStyle: { backgroundColor: '#1a1a2e' }, headerTintColor: '#fff' }}
        />
        <Stack.Screen
          name="field-sales/assign-stock"
          options={{ title: 'Assign Field Stock', headerStyle: { backgroundColor: '#1a1a2e' }, headerTintColor: '#fff' }}
        />
        <Stack.Screen
          name="field-sales/my-stock"
          options={{ title: 'My Assigned Stock', headerStyle: { backgroundColor: '#1a1a2e' }, headerTintColor: '#fff' }}
        />
        <Stack.Screen
          name="field-sales/sell"
          options={{ title: 'Field Sale', headerStyle: { backgroundColor: '#1a1a2e' }, headerTintColor: '#fff' }}
        />
        <Stack.Screen
          name="field-sales/approve-sales"
          options={{ title: 'Approve Field Sales', headerStyle: { backgroundColor: '#1a1a2e' }, headerTintColor: '#fff' }}
        />
        <Stack.Screen
          name="field-sales/field-customers"
          options={{ title: 'Field Customers', headerStyle: { backgroundColor: '#1a1a2e' }, headerTintColor: '#fff' }}
        />
        <Stack.Screen
          name="field-sales/reconciliation"
          options={{ title: 'Stock Reconciliation', headerStyle: { backgroundColor: '#1a1a2e' }, headerTintColor: '#fff' }}
        />
        <Stack.Screen name="modal" options={{ presentation: 'modal' }} />
      </Stack>

      {/* First-login password change prompt for invited users */}
      <Modal visible={showPasswordPrompt} transparent animationType="fade">
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <View style={pwdStyles.overlay}>
          <View style={pwdStyles.card}>
            <Text style={pwdStyles.icon}>🔐</Text>
            <Text style={pwdStyles.title}>Welcome to YourBooks!</Text>
            <Text style={pwdStyles.subtitle}>
              You're signed in with a temporary password.{'\n'}Please set your own password to keep your account secure.
            </Text>
            <TextInput
              style={pwdStyles.input}
              placeholder="New Password (min 6 chars)"
              placeholderTextColor="#666"
              value={newPwd}
              onChangeText={setNewPwd}
              secureTextEntry={!showPwd}
            />
            <TextInput
              style={pwdStyles.input}
              placeholder="Confirm New Password"
              placeholderTextColor="#666"
              value={confirmPwd}
              onChangeText={setConfirmPwd}
              secureTextEntry={!showPwd}
            />
            <TouchableOpacity
              style={pwdStyles.showPwdRow}
              onPress={() => setShowPwd(!showPwd)}
            >
              <FontAwesome name={showPwd ? 'check-square-o' : 'square-o'} size={18} color="#888" />
              <Text style={pwdStyles.showPwdText}>Show passwords</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={pwdStyles.button}
              onPress={handleFirstPasswordChange}
              disabled={changingPwd}
            >
              {changingPwd ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={pwdStyles.buttonText}>Set My Password</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={pwdStyles.skipBtn}
              onPress={() => setShowPasswordPrompt(false)}
            >
              <Text style={pwdStyles.skipText}>I'll do it later in Settings</Text>
            </TouchableOpacity>
          </View>
        </View>
        </KeyboardAvoidingView>
      </Modal>
    </ThemeProvider>
  );
}

const pwdStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: '#16213e',
    borderRadius: 20,
    padding: 28,
    width: '100%',
    maxWidth: 400,
    borderWidth: 1,
    borderColor: '#0f3460',
  },
  icon: { fontSize: 40, textAlign: 'center', marginBottom: 12 },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#fff',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#aaa',
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 20,
  },
  input: {
    backgroundColor: '#0f3460',
    borderRadius: 12,
    padding: 14,
    color: '#fff',
    fontSize: 15,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#1a4a7a',
  },
  button: {
    backgroundColor: '#e94560',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 4,
  },
  buttonText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  showPwdRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  showPwdText: { color: '#888', fontSize: 13 },
  skipBtn: { marginTop: 14, alignItems: 'center', paddingVertical: 8 },
  skipText: { color: '#666', fontSize: 13, textDecorationLine: 'underline' },
});
