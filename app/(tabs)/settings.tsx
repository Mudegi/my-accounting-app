import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Switch,
  Alert,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Image,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Text, View } from '@/components/Themed';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { statusLabel, statusColor, trialDaysRemaining } from '@/lib/subscription';
import { getBusinessSessions, removeOtherSession, getDeviceId, type DeviceSession } from '@/lib/device-sessions';
import { loadCurrencies, type Currency } from '@/lib/currency';

const SettingsSection = ({ title, icon, children, expanded, onToggle }: any) => (
  <View style={styles.section}>
    <TouchableOpacity style={styles.sectionHeader} onPress={onToggle}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: 'transparent' }}>
        <View style={styles.iconContainer}>
          <FontAwesome name={icon} size={16} color="#e94560" />
        </View>
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      <FontAwesome name={expanded ? 'chevron-up' : 'chevron-down'} size={14} color="#666" />
    </TouchableOpacity>
    {expanded && (
      <View style={styles.sectionContent}>
        {children}
      </View>
    )}
  </View>
);

export default function SettingsScreen() {
  const { profile, business, branches, currentBranch, setCurrentBranch, signOut, refreshBusiness, reloadUserData, subscriptionStatus, currency, isSuperAdmin, changePassword } = useAuth();
  const router = useRouter();
  const [proMode, setProMode] = useState(business?.app_mode === 'pro');
  const [autoPrint, setAutoPrint] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showDevices, setShowDevices] = useState(false);
  const [devices, setDevices] = useState<DeviceSession[]>([]);
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [currentDeviceId, setCurrentDeviceId] = useState<string>('');
  const [expandedSection, setExpandedSection] = useState<string | null>('profile'); // Default expand profile

  // Business Profile states
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [editBusinessName, setEditBusinessName] = useState(business?.name || '');
  const [editTin, setEditTin] = useState(business?.tin || '');
  const [editPhone, setEditPhone] = useState(business?.phone || '');
  const [editEmail, setEditEmail] = useState(business?.email || '');
  const [editAddress, setEditAddress] = useState(business?.address || '');
  const [editReceiptFooter, setEditReceiptFooter] = useState(business?.receipt_footer || '');
  const [editFullName, setEditFullName] = useState(profile?.full_name || '');
  const [editFiscalMonth, setEditFiscalMonth] = useState(1);
  const [editDefaultCurrency, setEditDefaultCurrency] = useState(business?.default_currency || 'UGX');
  const [editCountry, setEditCountry] = useState(business?.country || '');
  const [availableCurrencies, setAvailableCurrencies] = useState<Currency[]>([]);
  const [logoUrl, setLogoUrl] = useState(business?.logo_url || null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem('auto_print').then(v => setAutoPrint(v === 'true'));
    getDeviceId().then(id => setCurrentDeviceId(id));
    loadCurrencies().then(setAvailableCurrencies);
  }, []);

  useEffect(() => {
    if (business && !isEditingProfile) {
      setEditBusinessName(business.name);
      setEditTin(business.tin || '');
      setEditPhone(business.phone || '');
      setEditEmail(business.email || '');
      setEditAddress(business.address || '');
      setEditReceiptFooter(business.receipt_footer || '');
      setEditFiscalMonth(business.fiscal_year_start_month || 1);
      setEditDefaultCurrency(business.default_currency || 'UGX');
      setEditCountry(business.country || '');
      setLogoUrl(business.logo_url || null);
    }
    if (profile && !isEditingProfile) {
      setEditFullName(profile.full_name || '');
    }
  }, [business, profile, isEditingProfile]);

  const loadDevices = async () => {
    if (!business) return;
    setLoadingDevices(true);
    const sessions = await getBusinessSessions(business.id);
    setDevices(sessions);
    setLoadingDevices(false);
  };

  const handleToggleDevices = () => {
    const next = !showDevices;
    setShowDevices(next);
    if (next) loadDevices();
  };

  const handleRemoveDevice = (session: DeviceSession) => {
    if (!business) return;
    Alert.alert(
      'Remove Device',
      `Log out "${session.device_name}" (${session.user_name})?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            const ok = await removeOtherSession(session.id, business.id);
            if (ok) {
              Alert.alert('Done', 'Device session removed.');
              loadDevices();
            } else {
              Alert.alert('Error', 'Could not remove session.');
            }
          },
        },
      ]
    );
  };

  const toggleAutoPrint = async (value: boolean) => {
    setAutoPrint(value);
    await AsyncStorage.setItem('auto_print', value ? 'true' : 'false');
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

  const pickLogo = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.5,
    });

    if (!result.canceled && result.assets[0].uri && business) {
      setUploadingLogo(true);
      try {
        const uri = result.assets[0].uri;
        const ext = uri.split('.').pop();
        const path = `${business.id}/logo_${Date.now()}.${ext}`;

        const formData = new FormData();
        formData.append('file', {
          uri,
          name: path,
          type: `image/${ext}`,
        } as any);

        const { data, error } = await supabase.storage
          .from('business-logos')
          .upload(path, formData);

        if (error) throw error;

        const { data: { publicUrl } } = supabase.storage
          .from('business-logos')
          .getPublicUrl(path);

        // Update database
        const { error: dbErr } = await supabase
          .from('businesses')
          .update({ logo_url: publicUrl })
          .eq('id', business.id);
        
        if (dbErr) throw dbErr;

        setLogoUrl(publicUrl);
        await refreshBusiness();
        Alert.alert('Success', 'Logo updated successfully');
      } catch (e: any) {
        Alert.alert('Upload Error', e.message);
      } finally {
        setUploadingLogo(false);
      }
    }
  };

  const handleSaveProfile = async () => {
    if (!profile || !business) return;
    setSavingProfile(true);
    try {
      // 1. Update Profile (Full Name)
      const { error: pErr } = await supabase
        .from('profiles')
        .update({ full_name: editFullName })
        .eq('id', profile.id);
      
      if (pErr) throw pErr;

      // 2. Update Business
      const { error: bErr } = await supabase
        .from('businesses')
        .update({
          name: editBusinessName,
          tin: editTin,
          phone: editPhone,
          email: editEmail,
          address: editAddress,
          receipt_footer: editReceiptFooter,
          fiscal_year_start_month: editFiscalMonth,
          default_currency: editDefaultCurrency,
          country: editCountry,
        })
        .eq('id', business.id);
      
      if (bErr) throw bErr;

      await refreshBusiness();
      await reloadUserData();
      setIsEditingProfile(false);
      Alert.alert('Success', 'Business profile updated successfully.');
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to update profile');
    } finally {
      setSavingProfile(false);
    }
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
  const isManager = profile?.role === 'branch_manager';
  const isAdminOrManager = isAdmin || isManager;
  const canDoFieldSales = isAdminOrManager || profile?.sales_type === 'field' || profile?.sales_type === 'both';
  const isFieldOnly = profile?.role === 'salesperson' && profile?.sales_type === 'field';

  // Check if user has active field stock assignments (auto-show field sales section)
  const [hasFieldAssignments, setHasFieldAssignments] = useState(false);
  useEffect(() => {
    if (profile && !canDoFieldSales) {
      supabase
        .from('field_stock_assignments')
        .select('id')
        .eq('user_id', profile.id)
        .eq('status', 'active')
        .limit(1)
        .then(({ data }) => {
          if (data && data.length > 0) setHasFieldAssignments(true);
        });
    }
  }, [profile]);
  const showFieldSales = canDoFieldSales || hasFieldAssignments;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
    <ScrollView style={styles.container}>
      {/* Profile Card */}
      <View style={styles.profileCard}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {profile?.full_name?.charAt(0).toUpperCase() || '?'}
          </Text>
        </View>
        <View style={styles.profileInfo}>
          <Text style={styles.profileName}>{profile?.full_name || 'Personal Account'}</Text>
          <Text style={styles.profileRole}>{profile?.role?.toUpperCase() || 'Synchronizing...'}</Text>
          <Text style={styles.businessName}>{business?.name ? `🏢 ${business.name}` : 'Finalizing business setup...'}</Text>
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

      {/* Subscription & Currency — admin only */}
      {isAdmin && (
        <SettingsSection
          title="Subscription & Billing"
          icon="credit-card"
          expanded={expandedSection === 'subscription'}
          onToggle={() => setExpandedSection(expandedSection === 'subscription' ? null : 'subscription')}
        >
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
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, backgroundColor: 'transparent', borderTopWidth: 1, borderTopColor: '#333', marginTop: 12 }}>
            <FontAwesome name="money" size={16} color="#4CAF50" style={{ marginRight: 10 }} />
            <Text style={{ color: '#ccc', fontSize: 14 }}>Currency: <Text style={{ color: '#fff', fontWeight: '600' }}>{currency.symbol} ({currency.code})</Text></Text>
          </View>
        </SettingsSection>
      )}

      {/* Business & Profile — admin only */}
      {isAdmin && (
        <SettingsSection
          title="Business & Profile"
          icon="building"
          expanded={expandedSection === 'profile'}
          onToggle={() => setExpandedSection(expandedSection === 'profile' ? null : 'profile')}
        >
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 12, backgroundColor: 'transparent' }}>
            <TouchableOpacity onPress={() => setIsEditingProfile(!isEditingProfile)}>
              <Text style={{ color: '#e94560', fontWeight: 'bold' }}>{isEditingProfile ? 'Cancel' : 'Edit Profile'}</Text>
            </TouchableOpacity>
          </View>

          {/* Business Logo Upload */}
          <View style={styles.logoSection}>
            <TouchableOpacity style={styles.logoWrapper} onPress={pickLogo} disabled={uploadingLogo}>
              {uploadingLogo ? (
                <ActivityIndicator color="#e94560" />
              ) : logoUrl ? (
                <Image source={{ uri: logoUrl }} style={styles.logoImage} />
              ) : (
                <View style={styles.logoPlaceholder}>
                  <FontAwesome name="camera" size={24} color="#555" />
                </View>
              )}
            </TouchableOpacity>
            <View style={{ flex: 1, backgroundColor: 'transparent' }}>
              <Text style={{ color: '#fff', fontSize: 16, fontWeight: 'bold' }}>Business Logo</Text>
              <Text style={{ color: '#aaa', fontSize: 12 }}>Visible on statements & receipts</Text>
              <TouchableOpacity onPress={pickLogo} disabled={uploadingLogo}>
                <Text style={{ color: '#e94560', fontSize: 13, marginTop: 4, fontWeight: '600' }}>
                  {logoUrl ? 'Change Logo' : 'Upload Logo'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {isEditingProfile ? (
            <View style={{ backgroundColor: 'transparent', gap: 12 }}>
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Admin Full Name</Text>
                <TextInput
                  style={styles.input}
                  value={editFullName}
                  onChangeText={setEditFullName}
                  placeholder="Your Name"
                  placeholderTextColor="#666"
                />
              </View>
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Business Name</Text>
                <TextInput
                  style={styles.input}
                  value={editBusinessName}
                  onChangeText={setEditBusinessName}
                  placeholder="Business Name"
                  placeholderTextColor="#666"
                />
              </View>
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Base Country</Text>
                <TextInput
                  style={styles.input}
                  value={editCountry}
                  onChangeText={setEditCountry}
                  placeholder="e.g. Uganda"
                  placeholderTextColor="#666"
                />
              </View>
              {business?.is_efris_enabled && (
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>TIN (Tax ID)</Text>
                  <TextInput
                    style={styles.input}
                    value={editTin}
                    onChangeText={setEditTin}
                    placeholder="e.g. 10xxxxxxxx"
                    placeholderTextColor="#666"
                  />
                </View>
              )}
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Official Phone</Text>
                <TextInput
                  style={styles.input}
                  value={editPhone}
                  onChangeText={setEditPhone}
                  placeholder="Business Phone"
                  placeholderTextColor="#666"
                  keyboardType="phone-pad"
                />
              </View>
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Official Email</Text>
                <TextInput
                  style={styles.input}
                  value={editEmail}
                  onChangeText={setEditEmail}
                  placeholder="Business Email"
                  placeholderTextColor="#666"
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
              </View>
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Head Office Location / Address</Text>
                <TextInput
                  style={styles.input}
                  value={editAddress}
                  onChangeText={setEditAddress}
                  placeholder="e.g. Street Name, City"
                  placeholderTextColor="#666"
                  multiline
                />
              </View>
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Receipt Footer Message</Text>
                <TextInput
                  style={styles.input}
                  value={editReceiptFooter}
                  onChangeText={setEditReceiptFooter}
                  placeholder="e.g. Thank you for your purchase!"
                  placeholderTextColor="#666"
                  multiline
                />
              </View>
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Fiscal Year Start Month</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
                  {['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].map((m, i) => (
                    <TouchableOpacity 
                      key={m} 
                      onPress={() => setEditFiscalMonth(i + 1)}
                      style={{ paddingHorizontal: 12, paddingVertical: 8, backgroundColor: editFiscalMonth === i + 1 ? '#e94560' : '#222', marginRight: 8, borderRadius: 6 }}
                    >
                      <Text style={{ color: '#fff' }}>{m}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Business Default Currency</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
                  {availableCurrencies.map((c) => (
                    <TouchableOpacity 
                      key={c.code} 
                      onPress={() => setEditDefaultCurrency(c.code)}
                      style={{ paddingHorizontal: 12, paddingVertical: 8, backgroundColor: editDefaultCurrency === c.code ? '#4CAF50' : '#222', marginRight: 8, borderRadius: 6 }}
                    >
                      <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600' }}>{c.symbol} ({c.code})</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
                <Text style={{ color: '#888', fontSize: 11, marginTop: 4 }}>Used for all pricing and base accounting reports</Text>
              </View>

              <TouchableOpacity
                style={[styles.saveBtn, savingProfile && { opacity: 0.7 }]}
                onPress={handleSaveProfile}
                disabled={savingProfile}
              >
                {savingProfile ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.saveBtnText}>Save Changes</Text>
                )}
              </TouchableOpacity>
            </View>
          ) : (
            <View style={{ backgroundColor: 'transparent', gap: 8 }}>
              <InfoRow icon="user" label="Admin Name" value={profile?.full_name} />
              <InfoRow icon="globe" label="Country" value={business?.country || 'Not set'} />
              <InfoRow icon="building" label="Business" value={business?.name} />
              {business?.is_efris_enabled && <InfoRow icon="id-card" label="TIN" value={business?.tin || 'Not set'} />}
              <InfoRow icon="phone" label="Phone" value={business?.phone || 'Not set'} />
              <InfoRow icon="envelope" label="Email" value={business?.email || 'Not set'} />
              <InfoRow icon="map-marker" label="Location" value={business?.address || 'Not set'} />
              <InfoRow icon="sticky-note" label="Footer" value={business?.receipt_footer || 'Default'} />
              <InfoRow 
                 icon="calendar" 
                 label="Fiscal Year Start" 
                 value={['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][(business?.fiscal_year_start_month || 1) - 1]} 
               />
            </View>
          )}
        </SettingsSection>
      )}

      {/* Platform Admin — super admins only */}
      {isSuperAdmin && (
        <SettingsSection
          title="Platform Administration"
          icon="shield"
          expanded={expandedSection === 'platform'}
          onToggle={() => setExpandedSection(expandedSection === 'platform' ? null : 'platform')}
        >
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
        </SettingsSection>
      )}

      {/* Current Branch */}
      <SettingsSection
        title="Current Branch"
        icon="map-marker"
        expanded={expandedSection === 'branch'}
        onToggle={() => setExpandedSection(expandedSection === 'branch' ? null : 'branch')}
      >
        {isAdminOrManager ? (
          <>
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
          </>
        ) : (
          <View style={[styles.branchRow, styles.branchRowActive]}>
            <FontAwesome name="dot-circle-o" size={18} color="#e94560" />
            <View style={styles.branchInfo}>
              <Text style={[styles.branchName, styles.branchNameActive]}>
                {currentBranch?.name || 'No branch assigned'}
              </Text>
              {currentBranch?.location ? (
                <Text style={styles.branchLocation}>{currentBranch.location}</Text>
              ) : null}
            </View>
          </View>
        )}
      </SettingsSection>

      {/* App & Printing */}
      <SettingsSection
        title="App & Printing"
        icon="cog"
        expanded={expandedSection === 'app'}
        onToggle={() => setExpandedSection(expandedSection === 'app' ? null : 'app')}
      >
        <View style={styles.settingRow}>
          <View style={styles.settingInfo}>
            <Text style={styles.settingLabel}>Auto-Print Receipts</Text>
            <Text style={styles.settingSubLabel}>Automatically open print dialog after sale</Text>
          </View>
          <Switch
            value={autoPrint}
            onValueChange={toggleAutoPrint}
            trackColor={{ false: '#333', true: '#4CAF50' }}
            thumbColor={autoPrint ? '#fff' : '#666'}
          />
        </View>

        {isAdmin && (
          <View style={[styles.settingRow, { marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: '#333' }]}>
            <View style={styles.settingInfo}>
              <Text style={styles.settingLabel}>{proMode ? '🎓 Pro Mode' : '🟢 Basic Mode'}</Text>
              <Text style={styles.settingSubLabel}>{proMode ? 'Full accounting enabled' : 'Simple POS mode'}</Text>
            </View>
            <Switch
              value={proMode}
              onValueChange={toggleMode}
              trackColor={{ false: '#333', true: '#533483' }}
              thumbColor={proMode ? '#fff' : '#666'}
            />
          </View>
        )}
      </SettingsSection>

      {/* Admin Panel */}
      {isAdmin && (
        <SettingsSection
          title="Admin Panel"
          icon="cogs"
          expanded={expandedSection === 'admin'}
          onToggle={() => setExpandedSection(expandedSection === 'admin' ? null : 'admin')}
        >
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
          {business?.is_efris_enabled && (
            <TouchableOpacity style={styles.menuRow} onPress={() => router.push('/tax-settings' as any)}>
              <FontAwesome name="percent" size={18} color="#aaa" />
              <Text style={styles.menuLabel}>Tax Configurations</Text>
              <FontAwesome name="chevron-right" size={14} color="#555" />
            </TouchableOpacity>
          )}
        </SettingsSection>
      )}

      {/* Field Sales */}
      {showFieldSales && (
        <SettingsSection
          title="Field Sales"
          icon="truck"
          expanded={expandedSection === 'fieldSales'}
          onToggle={() => setExpandedSection(expandedSection === 'fieldSales' ? null : 'fieldSales')}
        >
          {isAdmin && (
            <>
              <TouchableOpacity style={styles.menuRow} onPress={() => router.push('/field-sales/assign-stock' as any)}>
                <FontAwesome name="cubes" size={18} color="#FF9800" />
                <Text style={styles.menuLabel}>Assign Stock to Users</Text>
                <FontAwesome name="chevron-right" size={14} color="#555" />
              </TouchableOpacity>
              <TouchableOpacity style={styles.menuRow} onPress={() => router.push('/field-sales/approve-sales' as any)}>
                <FontAwesome name="check-circle" size={18} color="#4CAF50" />
                <Text style={styles.menuLabel}>Approve Field Sales</Text>
                <FontAwesome name="chevron-right" size={14} color="#555" />
              </TouchableOpacity>
              <TouchableOpacity style={styles.menuRow} onPress={() => router.push('/field-sales/reconciliation' as any)}>
                <FontAwesome name="pie-chart" size={18} color="#7C3AED" />
                <Text style={styles.menuLabel}>Stock Reconciliation</Text>
                <FontAwesome name="chevron-right" size={14} color="#555" />
              </TouchableOpacity>
            </>
          )}
          <TouchableOpacity style={styles.menuRow} onPress={() => router.push('/field-sales/my-stock' as any)}>
            <FontAwesome name="archive" size={18} color="#2196F3" />
            <Text style={styles.menuLabel}>My Assigned Stock</Text>
            <FontAwesome name="chevron-right" size={14} color="#555" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.menuRow} onPress={() => router.push('/field-sales/sell' as any)}>
            <FontAwesome name="map-marker" size={18} color="#e94560" />
            <Text style={styles.menuLabel}>Field Sale</Text>
            <FontAwesome name="chevron-right" size={14} color="#555" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.menuRow} onPress={() => router.push('/field-sales/field-customers' as any)}>
            <FontAwesome name="address-book" size={18} color="#FF9800" />
            <Text style={styles.menuLabel}>Field Customers</Text>
            <FontAwesome name="chevron-right" size={14} color="#555" />
          </TouchableOpacity>
        </SettingsSection>
      )}

      {/* More Options */}
      <SettingsSection
        title="Modules & History"
        icon="th-large"
        expanded={expandedSection === 'more'}
        onToggle={() => setExpandedSection(expandedSection === 'more' ? null : 'more')}
      >
        {!isFieldOnly && (
          <TouchableOpacity style={styles.menuRow} onPress={() => router.push('/suppliers' as any)}>
            <FontAwesome name="truck" size={18} color="#aaa" />
            <Text style={styles.menuLabel}>Suppliers</Text>
            <FontAwesome name="chevron-right" size={14} color="#555" />
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.menuRow} onPress={() => router.push('/customers' as any)}>
          <FontAwesome name="users" size={18} color="#aaa" />
          <Text style={styles.menuLabel}>Customers</Text>
          <FontAwesome name="chevron-right" size={14} color="#555" />
        </TouchableOpacity>
        {!isFieldOnly && (
          <TouchableOpacity style={styles.menuRow} onPress={() => router.push('/sales' as any)}>
            <FontAwesome name="history" size={18} color="#aaa" />
            <Text style={styles.menuLabel}>Sales History</Text>
            <FontAwesome name="chevron-right" size={14} color="#555" />
          </TouchableOpacity>
        )}
        {!isFieldOnly && (
          <TouchableOpacity style={styles.menuRow} onPress={() => router.push('/purchase-history' as any)}>
            <FontAwesome name="archive" size={18} color="#aaa" />
            <Text style={styles.menuLabel}>Purchase History</Text>
            <FontAwesome name="chevron-right" size={14} color="#555" />
          </TouchableOpacity>
        )}
        {isAdmin && (
          <TouchableOpacity style={styles.menuRow} onPress={() => router.push('/reports')}>
            <FontAwesome name="line-chart" size={18} color="#aaa" />
            <Text style={styles.menuLabel}>Sales Reports</Text>
            <FontAwesome name="chevron-right" size={14} color="#555" />
          </TouchableOpacity>
        )}
        {!isFieldOnly && (
          <TouchableOpacity style={styles.menuRow} onPress={() => router.push('/transfers')}>
            <FontAwesome name="exchange" size={18} color="#aaa" />
            <Text style={styles.menuLabel}>Stock Transfers</Text>
            <FontAwesome name="chevron-right" size={14} color="#555" />
          </TouchableOpacity>
        )}
        {!isFieldOnly && (
          <TouchableOpacity style={styles.menuRow} onPress={() => router.push('/credit-note' as any)}>
            <FontAwesome name="undo" size={18} color="#aaa" />
            <Text style={styles.menuLabel}>Credit Notes / Returns</Text>
            <FontAwesome name="chevron-right" size={14} color="#555" />
          </TouchableOpacity>
        )}
      </SettingsSection>

      {/* Security & Support */}
      <SettingsSection
        title="Security & Support"
        icon="lock"
        expanded={expandedSection === 'security'}
        onToggle={() => setExpandedSection(expandedSection === 'security' ? null : 'security')}
      >
        <TouchableOpacity style={styles.menuRow} onPress={() => router.push('/help' as any)}>
          <FontAwesome name="book" size={18} color="#4CAF50" />
          <Text style={styles.menuLabel}>Help & User Guide</Text>
          <FontAwesome name="chevron-right" size={14} color="#555" />
        </TouchableOpacity>

        <TouchableOpacity style={styles.menuRow} onPress={() => setShowChangePassword(!showChangePassword)}>
          <FontAwesome name="key" size={18} color="#2196F3" />
          <Text style={styles.menuLabel}>Change Password</Text>
          <FontAwesome name={showChangePassword ? 'chevron-up' : 'chevron-down'} size={14} color="#555" />
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
              style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 }}
              onPress={() => setShowPassword(!showPassword)}
            >
              <FontAwesome name={showPassword ? 'check-square-o' : 'square-o'} size={18} color="#888" />
              <Text style={{ color: '#888', fontSize: 13 }}>Show passwords</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.efrisSaveBtn, { marginTop: 16, backgroundColor: '#2196F3' }]}
              onPress={handleChangePassword}
              disabled={changingPassword}
            >
              {changingPassword ? <ActivityIndicator color="#fff" /> : <Text style={styles.efrisSaveText}>Update Password</Text>}
            </TouchableOpacity>
          </View>
        )}

        {isAdmin && (
          <>
            <TouchableOpacity style={[styles.menuRow, { marginTop: 8 }]} onPress={handleToggleDevices}>
              <FontAwesome name="mobile-phone" size={22} color="#FF9800" />
              <Text style={styles.menuLabel}>Manage Active Devices</Text>
              <FontAwesome name={showDevices ? 'chevron-up' : 'chevron-down'} size={14} color="#555" />
            </TouchableOpacity>

            {showDevices && (
              <View style={styles.changePasswordCard}>
                {loadingDevices ? (
                  <ActivityIndicator color="#e94560" />
                ) : devices.length === 0 ? (
                  <Text style={{ color: '#888', textAlign: 'center', fontSize: 13 }}>No other active devices</Text>
                ) : (
                  <>
                    {devices.map((d) => {
                      const isCurrent = d.device_id === currentDeviceId;
                      const ago = Math.round((Date.now() - new Date(d.last_active_at).getTime()) / 60000);
                      const agoLabel = ago < 1 ? 'Just now' : ago < 60 ? `${ago}m ago` : `${Math.round(ago / 60)}h ago`;
                      return (
                        <View key={d.id} style={{ backgroundColor: '#0f3460', borderRadius: 10, padding: 12, marginBottom: 8, borderLeftWidth: isCurrent ? 3 : 0, borderLeftColor: '#4CAF50' }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'transparent' }}>
                            <View style={{ flex: 1, backgroundColor: 'transparent' }}>
                              <Text style={{ color: '#fff', fontWeight: '600', fontSize: 14 }}>
                                <FontAwesome name={d.platform === 'ios' ? 'apple' : d.platform === 'android' ? 'android' : 'globe'} size={14} color="#aaa" />
                                {'  '}{d.device_name}{isCurrent ? ' (This device)' : ''}
                              </Text>
                              <Text style={{ color: '#aaa', fontSize: 12, marginTop: 2 }}>{d.user_name} · {agoLabel}</Text>
                            </View>
                            {!isCurrent && isAdmin && (
                              <TouchableOpacity onPress={() => handleRemoveDevice(d)} style={{ backgroundColor: '#8B1A1A', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6 }}>
                                <Text style={{ color: '#fff', fontSize: 11, fontWeight: '600' }}>Log Out</Text>
                              </TouchableOpacity>
                            )}
                          </View>
                        </View>
                      );
                    })}
                    <TouchableOpacity onPress={loadDevices} style={{ alignSelf: 'center', marginTop: 4 }}>
                      <Text style={{ color: '#FF9800', fontSize: 12 }}>Refresh</Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>
            )}
          </>
        )}
      </SettingsSection>

      {/* Platform Admin — Super Admin only */}
      {isSuperAdmin && (
        <SettingsSection
          title="Platform Administration"
          icon="shield"
          expanded={expandedSection === 'platform'}
          onToggle={() => setExpandedSection(expandedSection === 'platform' ? null : 'platform')}
        >
          <TouchableOpacity 
            style={[styles.actionRow, { backgroundColor: '#16213e', borderRadius: 12, padding: 16 }]} 
            onPress={() => router.push('/platform-admin')}
          >
            <FontAwesome name="dashboard" size={18} color="#e94560" style={{ marginRight: 12 }} />
            <View style={{ backgroundColor: 'transparent', flex: 1 }}>
              <Text style={{ color: '#fff', fontSize: 16, fontWeight: 'bold' }}>Platform Management</Text>
              <Text style={{ color: '#aaa', fontSize: 12 }}>View logs, businesses & global stats</Text>
            </View>
            <FontAwesome name="chevron-right" size={16} color="#666" />
          </TouchableOpacity>
        </SettingsSection>
      )}

      {/* Sign Out */}
      <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut}>
        <FontAwesome name="sign-out" size={18} color="#e94560" />
        <Text style={styles.signOutText}>Sign Out Account</Text>
      </TouchableOpacity>

      <View style={{ height: 40 }} />
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

const InfoRow = ({ icon, label, value }: { icon: string, label: string, value?: string | null }) => (
  <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6, backgroundColor: 'transparent' }}>
    <FontAwesome name={icon as any} size={14} color="#666" style={{ width: 20 }} />
    <Text style={{ color: '#aaa', fontSize: 13, flex: 1 }}>{label}: <Text style={{ color: '#fff' }}>{value || '-'}</Text></Text>
  </View>
);

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
  sectionTitle: { fontSize: 18, fontWeight: 'bold', color: '#fff', marginBottom: 10 },
  logoSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginBottom: 20,
    padding: 12,
    backgroundColor: '#16213e',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#0f3460',
  },
  logoWrapper: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: '#0f3460',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#1a1a2e',
  },
  logoImage: {
    width: '100%',
    height: '100%',
  },
  logoPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileName: { fontSize: 20, fontWeight: 'bold', color: '#fff' },
  inputGroup: { marginTop: 8, backgroundColor: 'transparent' },
  inputLabel: { color: '#aaa', fontSize: 12, marginBottom: 4 },
  input: { backgroundColor: '#0f3460', borderRadius: 10, padding: 12, color: '#fff', fontSize: 14 },
  saveBtn: { backgroundColor: '#e94560', borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 12 },
  saveBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 15 },
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
  profileRole: { fontSize: 12, color: '#e94560', fontWeight: 'bold', marginTop: 2 },
  businessName: { fontSize: 13, color: '#aaa', marginTop: 4 },
  section: {
    backgroundColor: '#16213e',
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 20,
    overflow: 'hidden',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: 'transparent',
  },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#fff' },
  sectionContent: {
    padding: 16,
    paddingTop: 0,
    backgroundColor: 'transparent',
  },
  iconContainer: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#e9456015',
    justifyContent: 'center',
    alignItems: 'center',
  },
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
