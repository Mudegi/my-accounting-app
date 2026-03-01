import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Switch,
  Alert,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { Text, View } from '@/components/Themed';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { testEfrisConnection } from '@/lib/efris';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { statusLabel, statusColor, trialDaysRemaining } from '@/lib/subscription';

export default function SettingsScreen() {
  const { profile, business, branches, currentBranch, setCurrentBranch, signOut, refreshBusiness, reloadUserData, subscriptionStatus, currency, isSuperAdmin, changePassword } = useAuth();
  const router = useRouter();
  const [efrisEnabled, setEfrisEnabled] = useState(business?.is_efris_enabled ?? false);
  const [proMode, setProMode] = useState(business?.app_mode === 'pro');
  const [efrisApiKey, setEfrisApiKey] = useState(business?.efris_api_key ?? '');
  const [efrisApiUrl, setEfrisApiUrl] = useState(business?.efris_api_url ?? '');
  const [efrisTestMode, setEfrisTestMode] = useState(business?.efris_test_mode ?? true);
  const [testingConnection, setTestingConnection] = useState(false);
  const [autoPrint, setAutoPrint] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem('auto_print').then(v => setAutoPrint(v === 'true'));
  }, []);

  const toggleAutoPrint = async (value: boolean) => {
    setAutoPrint(value);
    await AsyncStorage.setItem('auto_print', value ? 'true' : 'false');
  };

  const toggleEfris = async (value: boolean) => {
    if (!business) return;
    setEfrisEnabled(value);
    const { error } = await supabase
      .from('businesses')
      .update({ is_efris_enabled: value })
      .eq('id', business.id);
    if (error) {
      setEfrisEnabled(!value);
      Alert.alert('Error', `Failed to save: ${error.message}`);
      return;
    }
    await refreshBusiness();
    Alert.alert(
      value ? 'EFRIS Enabled' : 'EFRIS Disabled',
      value
        ? 'Receipts will now be fiscalized through URA.'
        : 'Receipts are for internal use only (not URA compliant).'
    );
  };

  const saveEfrisConfig = async () => {
    if (!business) return;
    const { error } = await supabase.from('businesses').update({
      efris_api_key: efrisApiKey.trim() || null,
      efris_api_url: efrisApiUrl.trim() || null,
      efris_test_mode: efrisTestMode,
    }).eq('id', business.id);
    if (error) {
      Alert.alert('Error', `Failed to save config: ${error.message}`);
      return;
    }
    await refreshBusiness();
    Alert.alert('Saved', 'EFRIS configuration updated.');
  };

  const handleTestConnection = async () => {
    if (!efrisApiKey.trim()) { Alert.alert('Error', 'Enter an API Key first'); return; }
    setTestingConnection(true);
    const ok = await testEfrisConnection(efrisApiKey.trim(), efrisApiUrl.trim() || undefined);
    setTestingConnection(false);
    Alert.alert(ok ? '✅ Connected' : '❌ Failed', ok ? 'EFRIS API is reachable.' : 'Could not connect. Check your API key and URL.');
  };

  const toggleMode = async (value: boolean) => {
    if (!business) return;
    setProMode(value);
    await supabase
      .from('businesses')
      .update({ app_mode: value ? 'pro' : 'basic' })
      .eq('id', business.id);
  };

  const handleSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: signOut },
    ]);
  };

  const handleChangePassword = async () => {
    if (!newPassword.trim()) { Alert.alert('Error', 'Please enter a new password'); return; }
    if (newPassword.length < 6) { Alert.alert('Error', 'Password must be at least 6 characters'); return; }
    if (newPassword !== confirmPassword) { Alert.alert('Error', 'Passwords do not match'); return; }
    setChangingPassword(true);
    const { error } = await changePassword(newPassword);
    setChangingPassword(false);
    if (error) {
      Alert.alert('Error', error.message);
    } else {
      Alert.alert('Success', 'Your password has been changed successfully.');
      setNewPassword('');
      setConfirmPassword('');
      setShowChangePassword(false);
    }
  };

  const isAdmin = profile?.role === 'admin';

  return (
    <ScrollView style={styles.container}>
      {/* Profile Card */}
      <View style={styles.profileCard}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {profile?.full_name?.charAt(0).toUpperCase() || '?'}
          </Text>
        </View>
        <View style={styles.profileInfo}>
          <Text style={styles.profileName}>{profile?.full_name || 'Loading...'}</Text>
          <Text style={styles.profileRole}>{profile?.role?.toUpperCase() || ''}</Text>
          <Text style={styles.businessName}>{business?.name ? `🏢 ${business.name}` : ''}</Text>
        </View>
        {!profile && (
          <TouchableOpacity
            style={{ marginLeft: 'auto', backgroundColor: '#0f3460', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 }}
            onPress={() => reloadUserData()}
          >
            <Text style={{ color: '#fff', fontSize: 12, fontWeight: 'bold' }}>Retry</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Subscription & Currency */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Subscription & Billing</Text>
        <TouchableOpacity style={styles.subscriptionCard} onPress={() => router.push('/subscription' as any)}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'transparent' }}>
            <View style={{ backgroundColor: 'transparent', flex: 1 }}>
              <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>
                {subscriptionStatus?.display_name || subscriptionStatus?.plan || 'No Plan'}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4, backgroundColor: 'transparent' }}>
                <View style={{ backgroundColor: statusColor(business?.subscription_status || ''), paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 }}>
                  <Text style={{ color: '#fff', fontSize: 11, fontWeight: '600' }}>{statusLabel(business?.subscription_status || '')}</Text>
                </View>
                {business?.subscription_status === 'trial' && business?.subscription_ends_at && (
                  <Text style={{ color: '#aaa', fontSize: 12 }}>
                    {trialDaysRemaining(business.subscription_ends_at)} days left
                  </Text>
                )}
              </View>
            </View>
            <FontAwesome name="chevron-right" size={16} color="#666" />
          </View>
        </TouchableOpacity>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, backgroundColor: 'transparent' }}>
          <FontAwesome name="money" size={16} color="#4CAF50" style={{ marginRight: 10 }} />
          <Text style={{ color: '#ccc', fontSize: 14 }}>Currency: <Text style={{ color: '#fff', fontWeight: '600' }}>{currency.symbol} ({currency.code})</Text></Text>
        </View>
      </View>

      {/* Platform Admin — super admins only */}
      {isSuperAdmin && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Platform Administration</Text>
          <TouchableOpacity style={styles.subscriptionCard} onPress={() => router.push('/platform-admin' as any)}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'transparent' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'transparent' }}>
                <FontAwesome name="shield" size={20} color="#e94560" />
                <View style={{ backgroundColor: 'transparent' }}>
                  <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>Admin Control Panel</Text>
                  <Text style={{ color: '#aaa', fontSize: 12 }}>Manage businesses, subscriptions & payments</Text>
                </View>
              </View>
              <FontAwesome name="chevron-right" size={16} color="#666" />
            </View>
          </TouchableOpacity>
        </View>
      )}

      {/* Current Branch Selector */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Current Branch</Text>
        {branches.map((branch) => (
          <TouchableOpacity
            key={branch.id}
            style={[
              styles.branchRow,
              currentBranch?.id === branch.id && styles.branchRowActive,
            ]}
            onPress={() => setCurrentBranch(branch)}
          >
            <FontAwesome
              name={currentBranch?.id === branch.id ? 'dot-circle-o' : 'circle-o'}
              size={18}
              color={currentBranch?.id === branch.id ? '#e94560' : '#666'}
            />
            <View style={styles.branchInfo}>
              <Text style={[styles.branchName, currentBranch?.id === branch.id && styles.branchNameActive]}>
                {branch.name}
              </Text>
              {branch.location ? (
                <Text style={styles.branchLocation}>{branch.location}</Text>
              ) : null}
            </View>
          </TouchableOpacity>
        ))}
        {isAdmin && (
          <TouchableOpacity
            style={styles.addRowButton}
            onPress={() => router.push('/admin/branches')}
          >
            <FontAwesome name="plus" size={14} color="#e94560" />
            <Text style={styles.addRowText}>Manage Branches</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Printing */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Printing</Text>
        <View style={styles.settingRow}>
          <View style={styles.settingInfo}>
            <Text style={styles.settingLabel}>Auto-Print Receipts</Text>
            <Text style={styles.settingSubLabel}>
              Automatically open print dialog after every sale
            </Text>
          </View>
          <Switch
            value={autoPrint}
            onValueChange={toggleAutoPrint}
            trackColor={{ false: '#333', true: '#4CAF50' }}
            thumbColor={autoPrint ? '#fff' : '#666'}
          />
        </View>
      </View>

      {/* App Mode (Admin Only) */}
      {isAdmin && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>App Mode</Text>
          <View style={styles.settingRow}>
            <View style={styles.settingInfo}>
              <Text style={styles.settingLabel}>
                {proMode ? '🎓 Pro Mode' : '🟢 Basic Mode'}
              </Text>
              <Text style={styles.settingSubLabel}>
                {proMode
                  ? 'Full accounting: GL, P&L, Trial Balance'
                  : 'Simple POS: Scan, Sell, Track'}
              </Text>
            </View>
            <Switch
              value={proMode}
              onValueChange={toggleMode}
              trackColor={{ false: '#333', true: '#533483' }}
              thumbColor={proMode ? '#fff' : '#666'}
            />
          </View>
        </View>
      )}

      {/* EFRIS Settings (Admin Only) */}
      {isAdmin && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>EFRIS (URA Compliance)</Text>
          <View style={styles.settingRow}>
            <View style={styles.settingInfo}>
              <Text style={styles.settingLabel}>
                {efrisEnabled ? '✅ EFRIS Enabled' : '⭕ EFRIS Disabled'}
              </Text>
              <Text style={styles.settingSubLabel}>
                {efrisEnabled
                  ? 'Receipts are URA-compliant'
                  : 'For internal use only — not URA compliant'}
              </Text>
            </View>
            <Switch
              value={efrisEnabled}
              onValueChange={toggleEfris}
              trackColor={{ false: '#333', true: '#4CAF50' }}
              thumbColor={efrisEnabled ? '#fff' : '#666'}
            />
          </View>
        </View>
      )}

      {/* EFRIS Configuration (only when enabled) */}
      {isAdmin && efrisEnabled && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>🇺🇬 EFRIS CONFIGURATION</Text>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>EFRIS API Key</Text>
            <TextInput style={styles.fieldInput} placeholder="Your organization API key" placeholderTextColor="#555" value={efrisApiKey} onChangeText={setEfrisApiKey} secureTextEntry />
          </View>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>API URL (optional)</Text>
            <TextInput style={styles.fieldInput} placeholder="Leave blank for default middleware URL" placeholderTextColor="#555" value={efrisApiUrl} onChangeText={setEfrisApiUrl} autoCapitalize="none" keyboardType="url" />
          </View>
          <View style={styles.settingRow}>
            <View style={styles.settingInfo}>
              <Text style={styles.settingLabel}>Environment</Text>
              <Text style={styles.settingSubLabel}>{efrisTestMode ? 'Test / Sandbox — No real URA submissions' : '🟢 PRODUCTION — Live URA submissions'}</Text>
            </View>
            <Switch value={efrisTestMode} onValueChange={setEfrisTestMode} trackColor={{ false: '#e94560', true: '#4CAF50' }} thumbColor="#fff" />
          </View>
          <View style={styles.efrisButtons}>
            <TouchableOpacity style={styles.efrisSaveBtn} onPress={saveEfrisConfig}>
              <Text style={styles.efrisSaveText}>Save Config</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.efrisTestBtn} onPress={handleTestConnection} disabled={testingConnection}>
              {testingConnection ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.efrisTestText}>Test Connection</Text>}
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Admin Panel Links */}
      {isAdmin && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Admin Panel</Text>
          <TouchableOpacity style={styles.menuRow} onPress={() => router.push('/admin/users')}>
            <FontAwesome name="users" size={18} color="#aaa" />
            <Text style={styles.menuLabel}>Manage Users & Roles</Text>
            <FontAwesome name="chevron-right" size={14} color="#555" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.menuRow} onPress={() => router.push('/admin/branches')}>
            <FontAwesome name="building" size={18} color="#aaa" />
            <Text style={styles.menuLabel}>Manage Branches</Text>
            <FontAwesome name="chevron-right" size={14} color="#555" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.menuRow} onPress={() => router.push('/admin/categories')}>
            <FontAwesome name="tags" size={18} color="#aaa" />
            <Text style={styles.menuLabel}>Product Categories</Text>
            <FontAwesome name="chevron-right" size={14} color="#555" />
          </TouchableOpacity>
        </View>
      )}

      {/* More Options */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>More</Text>
        <TouchableOpacity style={styles.menuRow} onPress={() => router.push('/suppliers' as any)}>
          <FontAwesome name="truck" size={18} color="#aaa" />
          <Text style={styles.menuLabel}>Suppliers</Text>
          <FontAwesome name="chevron-right" size={14} color="#555" />
        </TouchableOpacity>
        <TouchableOpacity style={styles.menuRow} onPress={() => router.push('/customers' as any)}>
          <FontAwesome name="users" size={18} color="#aaa" />
          <Text style={styles.menuLabel}>Customers</Text>
          <FontAwesome name="chevron-right" size={14} color="#555" />
        </TouchableOpacity>
        <TouchableOpacity style={styles.menuRow} onPress={() => router.push('/sales' as any)}>
          <FontAwesome name="history" size={18} color="#aaa" />
          <Text style={styles.menuLabel}>Sales History</Text>
          <FontAwesome name="chevron-right" size={14} color="#555" />
        </TouchableOpacity>
        <TouchableOpacity style={styles.menuRow} onPress={() => router.push('/purchase-history' as any)}>
          <FontAwesome name="archive" size={18} color="#aaa" />
          <Text style={styles.menuLabel}>Purchase History</Text>
          <FontAwesome name="chevron-right" size={14} color="#555" />
        </TouchableOpacity>
        {isAdmin && (
          <TouchableOpacity style={styles.menuRow} onPress={() => router.push('/reports')}>
            <FontAwesome name="line-chart" size={18} color="#aaa" />
            <Text style={styles.menuLabel}>Sales Reports</Text>
            <FontAwesome name="chevron-right" size={14} color="#555" />
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.menuRow} onPress={() => router.push('/transfers')}>
          <FontAwesome name="exchange" size={18} color="#aaa" />
          <Text style={styles.menuLabel}>Stock Transfers</Text>
          <FontAwesome name="chevron-right" size={14} color="#555" />
        </TouchableOpacity>
        <TouchableOpacity style={styles.menuRow} onPress={() => router.push('/credit-note' as any)}>
          <FontAwesome name="undo" size={18} color="#aaa" />
          <Text style={styles.menuLabel}>Credit Notes / Returns</Text>
          <FontAwesome name="chevron-right" size={14} color="#555" />
        </TouchableOpacity>
      </View>

      {/* Help & Guide */}
      <TouchableOpacity
        style={[styles.signOutButton, { borderColor: '#4CAF5033', marginBottom: 10 }]}
        onPress={() => router.push('/help' as any)}
      >
        <FontAwesome name="book" size={18} color="#4CAF50" />
        <Text style={[styles.signOutText, { color: '#4CAF50' }]}>Help & User Guide</Text>
      </TouchableOpacity>

      {/* Change Password */}
      <TouchableOpacity
        style={[styles.signOutButton, { borderColor: '#2196F333', marginBottom: 10 }]}
        onPress={() => setShowChangePassword(!showChangePassword)}
      >
        <FontAwesome name="lock" size={18} color="#2196F3" />
        <Text style={[styles.signOutText, { color: '#2196F3' }]}>Change Password</Text>
      </TouchableOpacity>

      {showChangePassword && (
        <View style={styles.changePasswordCard}>
          <TextInput
            style={styles.fieldInput}
            placeholder="New Password (min 6 chars)"
            placeholderTextColor="#555"
            value={newPassword}
            onChangeText={setNewPassword}
            secureTextEntry={!showPassword}
          />
          <TextInput
            style={[styles.fieldInput, { marginTop: 10 }]}
            placeholder="Confirm New Password"
            placeholderTextColor="#555"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            secureTextEntry={!showPassword}
          />
          <TouchableOpacity
            style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 }}
            onPress={() => setShowPassword(!showPassword)}
          >
            <FontAwesome name={showPassword ? 'check-square-o' : 'square-o'} size={18} color="#888" />
            <Text style={{ color: '#888', fontSize: 13 }}>Show passwords</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.efrisSaveBtn, { marginTop: 12, backgroundColor: '#2196F3' }]}
            onPress={handleChangePassword}
            disabled={changingPassword}
          >
            {changingPassword ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.efrisSaveText}>Update Password</Text>
            )}
          </TouchableOpacity>
        </View>
      )}

      {/* Sign Out */}
      <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut}>
        <FontAwesome name="sign-out" size={18} color="#e94560" />
        <Text style={styles.signOutText}>Sign Out</Text>
      </TouchableOpacity>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#16213e',
    margin: 16,
    borderRadius: 16,
    padding: 20,
  },
  subscriptionCard: {
    backgroundColor: '#0f3460',
    borderRadius: 12,
    padding: 14,
    marginBottom: 4,
  },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#e94560',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  avatarText: { fontSize: 28, fontWeight: 'bold', color: '#fff' },
  profileInfo: { flex: 1, backgroundColor: 'transparent' },
  profileName: { fontSize: 20, fontWeight: 'bold', color: '#fff' },
  profileRole: { fontSize: 12, color: '#e94560', fontWeight: 'bold', marginTop: 2 },
  businessName: { fontSize: 13, color: '#aaa', marginTop: 4 },
  section: {
    backgroundColor: '#16213e',
    marginHorizontal: 16,
    marginBottom: 14,
    borderRadius: 16,
    padding: 16,
  },
  sectionTitle: { fontSize: 12, color: '#666', fontWeight: 'bold', marginBottom: 12, letterSpacing: 1 },
  branchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 10,
    paddingHorizontal: 8,
    backgroundColor: 'transparent',
  },
  branchRowActive: { backgroundColor: '#e9456015' },
  branchInfo: { flex: 1, marginLeft: 12, backgroundColor: 'transparent' },
  branchName: { fontSize: 15, color: '#aaa' },
  branchNameActive: { color: '#e94560', fontWeight: 'bold' },
  branchLocation: { fontSize: 12, color: '#555', marginTop: 2 },
  addRowButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#0f3460',
    marginTop: 8,
  },
  addRowText: { color: '#e94560', fontSize: 14 },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  settingInfo: { flex: 1, backgroundColor: 'transparent' },
  settingLabel: { fontSize: 15, color: '#fff', fontWeight: 'bold' },
  settingSubLabel: { fontSize: 12, color: '#aaa', marginTop: 3 },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#0f3460',
    gap: 14,
  },
  menuLabel: { flex: 1, fontSize: 15, color: '#ddd' },
  signOutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 16,
    marginTop: 4,
    backgroundColor: '#16213e',
    borderRadius: 16,
    padding: 16,
    gap: 10,
    borderWidth: 1,
    borderColor: '#e9456033',
  },
  signOutText: { fontSize: 16, color: '#e94560', fontWeight: 'bold' },
  field: { marginBottom: 12, backgroundColor: 'transparent' },
  fieldLabel: { fontSize: 13, color: '#aaa', marginBottom: 4 },
  fieldInput: {
    backgroundColor: '#0f3460',
    borderRadius: 10,
    padding: 12,
    color: '#fff',
    fontSize: 15,
    borderWidth: 1,
    borderColor: '#1a4a7a',
  },
  efrisButtons: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 6,
    backgroundColor: 'transparent',
  },
  efrisSaveBtn: {
    flex: 1,
    backgroundColor: '#7C3AED',
    borderRadius: 10,
    padding: 12,
    alignItems: 'center',
  },
  efrisSaveText: { color: '#fff', fontWeight: 'bold', fontSize: 14 },
  efrisTestBtn: {
    flex: 1,
    backgroundColor: '#16213e',
    borderRadius: 10,
    padding: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#7C3AED',
  },
  efrisTestText: { color: '#7C3AED', fontWeight: 'bold', fontSize: 14 },
  changePasswordCard: {
    backgroundColor: '#16213e',
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#2196F333',
  },
});
