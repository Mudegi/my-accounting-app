import React, { useState, useCallback } from 'react';
import {
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Alert,
  TextInput,
  ActivityIndicator,
  ScrollView,
  RefreshControl,
  Modal,
  KeyboardAvoidingView,
  Platform,
  Switch,
} from 'react-native';
import { Text, View } from '@/components/Themed';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useFocusEffect, useRouter } from 'expo-router';
import { testEfrisConnection } from '@/lib/efris';
import { getPlatformContacts, updatePlatformSetting, invalidatePlatformContacts } from '@/lib/platform-settings';

type PlatformStats = {
  total_businesses: number;
  active_subscriptions: number;
  trial_subscriptions: number;
  expired_subscriptions: number;
  total_revenue: number;
  this_month_revenue: number;
};

type BusinessRow = {
  id: string;
  name: string;
  tin: string | null;
  default_currency: string;
  subscription_status: string | null;
  subscription_ends_at: string | null;
  created_at: string;
  owner_name: string | null;
  owner_email: string | null;
  plan_name: string | null;
  user_count: number;
  is_efris_enabled: boolean;
  efris_api_key: string | null;
  efris_api_url: string | null;
  efris_test_mode: boolean;
  active_devices: number;
};

type PaymentRow = {
  id: string;
  business_id: string;
  business_name: string;
  amount: number;
  currency: string;
  payment_method: string;
  payment_reference: string | null;
  status: string;
  paid_at: string | null;
  created_at: string;
};

const PLANS = ['starter', 'basic', 'pro'] as const;
const PLAN_LABELS: Record<string, string> = {
  starter: 'Starter — 30K/mo',
  basic: 'Basic — 70K/mo',
  pro: 'Pro — 220K/mo',
};

export default function PlatformAdminScreen() {
  const { isSuperAdmin, fmt } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<'dashboard' | 'businesses' | 'payments'>('dashboard');
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Dashboard state
  const [stats, setStats] = useState<PlatformStats | null>(null);

  // Businesses state
  const [businesses, setBusinesses] = useState<BusinessRow[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  // Payment history
  const [payments, setPayments] = useState<PaymentRow[]>([]);

  // Modal for activating a subscription
  const [activateModal, setActivateModal] = useState(false);
  const [selectedBiz, setSelectedBiz] = useState<BusinessRow | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<string>('basic');
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');
  const [cashAmount, setCashAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [activating, setActivating] = useState(false);

  // Extend modal
  const [extendModal, setExtendModal] = useState(false);
  const [extendDays, setExtendDays] = useState('30');
  const [extending, setExtending] = useState(false);

  // Status filter for businesses
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // EFRIS config modal
  const [efrisModal, setEfrisModal] = useState(false);
  const [efrisEnabled, setEfrisEnabled] = useState(false);
  const [efrisApiKey, setEfrisApiKey] = useState('');
  const [efrisApiUrl, setEfrisApiUrl] = useState('');
  const [efrisTestMode, setEfrisTestMode] = useState(true);
  const [savingEfris, setSavingEfris] = useState(false);
  const [testingEfris, setTestingEfris] = useState(false);

  // Sessions modal
  const [sessionsModal, setSessionsModal] = useState(false);
  const [sessionsBiz, setSessionsBiz] = useState<BusinessRow | null>(null);
  const [sessionsList, setSessionsList] = useState<any[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);

  // Contact info settings
  const [contactPhone, setContactPhone] = useState('');
  const [contactWhatsapp, setContactWhatsapp] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [savingContacts, setSavingContacts] = useState(false);

  // Guard
  if (!isSuperAdmin) {
    return (
      <View style={styles.center}>
        <FontAwesome name="lock" size={48} color="#e94560" />
        <Text style={{ color: '#e94560', fontSize: 18, marginTop: 16, fontWeight: '700' }}>Access Denied</Text>
        <Text style={{ color: '#888', marginTop: 8 }}>Super Admin privileges required</Text>
      </View>
    );
  }

  const loadDashboard = async () => {
    try {
      const [statsResult, contacts] = await Promise.all([
        supabase.rpc('admin_platform_stats'),
        getPlatformContacts(),
      ]);
      if (statsResult.error) throw statsResult.error;
      setStats(statsResult.data as PlatformStats);
      setContactPhone(contacts.contact_phone);
      setContactWhatsapp(contacts.contact_whatsapp);
      setContactEmail(contacts.contact_email);
    } catch (e: any) {
      Alert.alert('Error', e.message);
    }
  };

  const loadBusinesses = async () => {
    try {
      const { data, error } = await supabase.rpc('admin_list_businesses');
      if (error) throw error;
      setBusinesses((data as BusinessRow[]) || []);
    } catch (e: any) {
      Alert.alert('Error', e.message);
    }
  };

  const loadPayments = async () => {
    try {
      const { data, error } = await supabase.rpc('admin_list_payments', { p_limit: 100, p_offset: 0 });
      if (error) throw error;
      setPayments((data as PaymentRow[]) || []);
    } catch (e: any) {
      Alert.alert('Error', e.message);
    }
  };

  const refresh = async () => {
    setRefreshing(true);
    if (tab === 'dashboard') await loadDashboard();
    else if (tab === 'businesses') await loadBusinesses();
    else await loadPayments();
    setRefreshing(false);
  };

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      Promise.all([loadDashboard(), loadBusinesses(), loadPayments()]).finally(() => setLoading(false));
    }, [])
  );

  // ── Activate Subscription ──
  const handleActivate = async () => {
    if (!selectedBiz) return;
    setActivating(true);
    try {
      const { data, error } = await supabase.rpc('admin_activate_subscription', {
        p_business_id: selectedBiz.id,
        p_plan_name: selectedPlan,
        p_billing_cycle: billingCycle,
        p_amount: parseFloat(cashAmount) || 0,
        p_notes: notes || null,
      });
      if (error) throw error;
      const result = data as any;
      if (result?.success) {
        Alert.alert('✅ Activated', `${selectedBiz.name} → ${result.plan}\nExpires: ${new Date(result.ends_at).toLocaleDateString()}`);
        setActivateModal(false);
        setCashAmount('');
        setNotes('');
        await Promise.all([loadBusinesses(), loadDashboard(), loadPayments()]);
      } else {
        Alert.alert('Error', result?.error || 'Unknown error');
      }
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setActivating(false);
    }
  };

  // ── Extend Subscription ──
  const handleExtend = async () => {
    if (!selectedBiz) return;
    setExtending(true);
    try {
      const { data, error } = await supabase.rpc('admin_extend_subscription', {
        p_business_id: selectedBiz.id,
        p_days: parseInt(extendDays) || 30,
        p_notes: notes || null,
      });
      if (error) throw error;
      const result = data as any;
      if (result?.success) {
        Alert.alert('✅ Extended', `${selectedBiz.name} extended by ${result.days_added} days\nNew end: ${new Date(result.new_end).toLocaleDateString()}`);
        setExtendModal(false);
        setExtendDays('30');
        setNotes('');
        await Promise.all([loadBusinesses(), loadDashboard()]);
      } else {
        Alert.alert('Error', result?.error || 'Unknown error');
      }
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setExtending(false);
    }
  };

  // ── Cancel Subscription ──
  const handleCancel = (biz: BusinessRow) => {
    Alert.alert(
      'Cancel Subscription',
      `Deactivate subscription for "${biz.name}"?\nThey will lose access until reactivated.`,
      [
        { text: 'No', style: 'cancel' },
        {
          text: 'Cancel Subscription',
          style: 'destructive',
          onPress: async () => {
            try {
              const { data, error } = await supabase.rpc('admin_cancel_subscription', {
                p_business_id: biz.id,
                p_reason: 'Cancelled by platform admin',
              });
              if (error) throw error;
              Alert.alert('Done', `${biz.name} subscription cancelled.`);
              await Promise.all([loadBusinesses(), loadDashboard()]);
            } catch (e: any) {
              Alert.alert('Error', e.message);
            }
          },
        },
      ]
    );
  };

  // ── Open EFRIS modal for a business ──
  const openEfrisModal = (biz: BusinessRow) => {
    setSelectedBiz(biz);
    setEfrisEnabled(biz.is_efris_enabled ?? false);
    setEfrisApiKey(biz.efris_api_key ?? '');
    setEfrisApiUrl(biz.efris_api_url ?? '');
    setEfrisTestMode(biz.efris_test_mode ?? true);
    setEfrisModal(true);
  };

  // ── Save EFRIS config for selected business ──
  const handleSaveEfris = async () => {
    if (!selectedBiz) return;
    setSavingEfris(true);
    try {
      const { error } = await supabase.from('businesses').update({
        is_efris_enabled: efrisEnabled,
        efris_api_key: efrisApiKey.trim() || null,
        efris_api_url: efrisApiUrl.trim() || null,
        efris_test_mode: efrisTestMode,
      }).eq('id', selectedBiz.id);
      if (error) throw error;
      Alert.alert('✅ Saved', `EFRIS config updated for ${selectedBiz.name}`);
      setEfrisModal(false);
      await loadBusinesses();
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setSavingEfris(false);
    }
  };

  // ── Test EFRIS connection ──
  const handleTestEfris = async () => {
    if (!efrisApiKey.trim()) { Alert.alert('Error', 'Enter an API Key first'); return; }
    setTestingEfris(true);
    const ok = await testEfrisConnection(efrisApiKey.trim(), efrisApiUrl.trim() || undefined);
    setTestingEfris(false);
    Alert.alert(ok ? '✅ Connected' : '❌ Failed', ok ? 'EFRIS API is reachable.' : 'Could not connect. Check the API key and URL.');
  };

  const filteredBusinesses = businesses.filter(
    (b) => {
      // Text search
      const matchesSearch = !searchQuery ||
        b.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        b.owner_email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        b.owner_name?.toLowerCase().includes(searchQuery.toLowerCase());

      // Status filter
      const matchesStatus = statusFilter === 'all' ||
        b.subscription_status === statusFilter;

      return matchesSearch && matchesStatus;
    }
  );

  const statusBadge = (status: string | null) => {
    const colors: Record<string, string> = {
      trial: '#FF9800',
      active: '#4CAF50',
      approved: '#00BCD4',
      past_due: '#FF5722',
      cancelled: '#8B1A1A',
      expired: '#666',
    };
    return (
      <View style={{ backgroundColor: colors[status || ''] || '#444', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 }}>
        <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700', textTransform: 'uppercase' }}>{status || 'none'}</Text>
      </View>
    );
  };

  const paymentMethodLabel = (m: string) => {
    const labels: Record<string, string> = {
      mtn_momo: 'MTN MoMo',
      airtel_money: 'Airtel Money',
      bank_transfer: 'Bank Transfer',
      visa: 'Visa',
      mastercard: 'Mastercard',
      manual: '💵 Cash/Manual',
      flutterwave: 'Flutterwave',
    };
    return labels[m] || m;
  };

  // ══════════════════════════════════════════════════
  //  RENDER
  // ══════════════════════════════════════════════════

  return (
    <View style={styles.container}>
      {/* Tab Bar */}
      <View style={styles.tabBar}>
        {(['dashboard', 'businesses', 'payments'] as const).map((t) => (
          <TouchableOpacity
            key={t}
            style={[styles.tabBtn, tab === t && styles.tabBtnActive]}
            onPress={() => setTab(t)}
          >
            <FontAwesome
              name={t === 'dashboard' ? 'tachometer' : t === 'businesses' ? 'building' : 'credit-card'}
              size={14}
              color={tab === t ? '#e94560' : '#888'}
            />
            <Text style={[styles.tabLabel, tab === t && styles.tabLabelActive]}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#e94560" />
        </View>
      ) : tab === 'dashboard' ? (
        // ──────── DASHBOARD TAB ────────
        <ScrollView
          style={styles.scroll}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor="#e94560" />}
        >
          <Text style={styles.sectionTitle}>📊 Platform Overview</Text>

          <View style={styles.statsGrid}>
            <View style={[styles.statCard, { backgroundColor: '#0f3460' }]}>
              <Text style={styles.statNumber}>{stats?.total_businesses ?? '—'}</Text>
              <Text style={styles.statLabel}>Total Businesses</Text>
            </View>
            <View style={[styles.statCard, { backgroundColor: '#2d6a4f' }]}>
              <Text style={styles.statNumber}>{stats?.active_subscriptions ?? '—'}</Text>
              <Text style={styles.statLabel}>Active</Text>
            </View>
            <View style={[styles.statCard, { backgroundColor: '#FF9800' }]}>
              <Text style={styles.statNumber}>{stats?.trial_subscriptions ?? '—'}</Text>
              <Text style={styles.statLabel}>On Trial</Text>
            </View>
            <View style={[styles.statCard, { backgroundColor: '#8B1A1A' }]}>
              <Text style={styles.statNumber}>{stats?.expired_subscriptions ?? '—'}</Text>
              <Text style={styles.statLabel}>Expired</Text>
            </View>
          </View>

          <Text style={[styles.sectionTitle, { marginTop: 16 }]}>💰 Revenue</Text>
          <View style={styles.revenueRow}>
            <View style={styles.revenueCard}>
              <Text style={styles.revenueAmount}>{fmt(stats?.total_revenue ?? 0)}</Text>
              <Text style={styles.revenueLabel}>Total Revenue</Text>
            </View>
            <View style={styles.revenueCard}>
              <Text style={styles.revenueAmount}>{fmt(stats?.this_month_revenue ?? 0)}</Text>
              <Text style={styles.revenueLabel}>This Month</Text>
            </View>
          </View>

          {/* Contact Info Settings */}
          <Text style={[styles.sectionTitle, { marginTop: 16 }]}>📞 Contact Info</Text>
          <Text style={{ color: '#888', fontSize: 12, marginBottom: 10 }}>Shown to businesses on subscription &amp; help screens</Text>
          <View style={{ backgroundColor: '#16213e', borderRadius: 12, padding: 14, marginBottom: 10 }}>
            <Text style={styles.formLabel}>Phone Number</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="e.g. +256 700 123456"
              placeholderTextColor="#555"
              value={contactPhone}
              onChangeText={setContactPhone}
              keyboardType="phone-pad"
            />
            <Text style={styles.formLabel}>WhatsApp Number</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="e.g. 256700123456 (no + or spaces)"
              placeholderTextColor="#555"
              value={contactWhatsapp}
              onChangeText={setContactWhatsapp}
              keyboardType="phone-pad"
            />
            <Text style={styles.formLabel}>Email Address</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="e.g. sales@yourbooks.app"
              placeholderTextColor="#555"
              value={contactEmail}
              onChangeText={setContactEmail}
              keyboardType="email-address"
              autoCapitalize="none"
            />
            <TouchableOpacity
              style={[styles.modalConfirm, { marginTop: 4 }]}
              onPress={async () => {
                setSavingContacts(true);
                invalidatePlatformContacts();
                await Promise.all([
                  updatePlatformSetting('contact_phone', contactPhone.trim()),
                  updatePlatformSetting('contact_whatsapp', contactWhatsapp.trim()),
                  updatePlatformSetting('contact_email', contactEmail.trim()),
                ]);
                setSavingContacts(false);
                Alert.alert('✅ Saved', 'Contact info updated. Businesses will see this immediately.');
              }}
              disabled={savingContacts}
            >
              {savingContacts ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={{ color: '#fff', fontWeight: '700' }}>💾 Save Contacts</Text>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      ) : tab === 'businesses' ? (
        // ──────── BUSINESSES TAB ────────
        <View style={{ flex: 1, backgroundColor: 'transparent' }}>
          <TextInput
            style={styles.searchInput}
            placeholder="Search by name, email, reason..."
            placeholderTextColor="#555"
            value={searchQuery}
            onChangeText={setSearchQuery}
          />

          {/* Status filter pills */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 12, marginBottom: 8, backgroundColor: 'transparent' }}>
            {[
              { key: 'all', label: 'All' },
              { key: 'trial', label: 'Trial' },
              { key: 'approved', label: '\u2705 Approved' },
              { key: 'active', label: 'Active' },
              { key: 'expired', label: 'Expired' },
            ].map(f => (
              <TouchableOpacity
                key={f.key}
                style={[styles.chip, statusFilter === f.key && styles.chipActive]}
                onPress={() => setStatusFilter(f.key)}
              >
                <Text style={[styles.chipText, statusFilter === f.key && styles.chipTextActive]}>{f.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <FlatList
            data={filteredBusinesses}
            keyExtractor={(b) => b.id}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor="#e94560" />}
            renderItem={({ item }) => (
              <View style={styles.bizCard}>
                <View style={styles.bizHeader}>
                  <View style={{ flex: 1, backgroundColor: 'transparent' }}>
                    <Text style={styles.bizName}>{item.name}</Text>
                    <Text style={styles.bizSub}>
                      {item.owner_name || '—'} · {item.owner_email || '—'}
                    </Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4, backgroundColor: 'transparent' }}>
                      {statusBadge(item.subscription_status)}
                      <Text style={{ color: '#888', fontSize: 11 }}>
                        {item.plan_name || 'No plan'} · {item.user_count} user{item.user_count !== 1 ? 's' : ''} · {item.active_devices || 0} device{(item.active_devices || 0) !== 1 ? 's' : ''}
                      </Text>
                    </View>
                    {item.subscription_ends_at && (
                      <Text style={{ color: '#777', fontSize: 11, marginTop: 2 }}>
                        Expires: {new Date(item.subscription_ends_at).toLocaleDateString()}
                      </Text>
                    )}
                  </View>
                </View>

                {/* Actions */}
                <View style={styles.bizActions}>
                  {item.subscription_status !== 'active' && item.subscription_status !== 'approved' && (
                    <TouchableOpacity
                      style={[styles.actionBtn, { backgroundColor: '#2d6a4f' }]}
                      onPress={() => {
                        setSelectedBiz(item);
                        setActivateModal(true);
                      }}
                    >
                      <FontAwesome name="check-circle" size={12} color="#fff" />
                      <Text style={styles.actionBtnText}>Activate</Text>
                    </TouchableOpacity>
                  )}
                  {(item.subscription_status === 'active' || item.subscription_status === 'approved' || item.subscription_status === 'trial') && (
                    <TouchableOpacity
                      style={[styles.actionBtn, { backgroundColor: '#0f3460' }]}
                      onPress={() => {
                        setSelectedBiz(item);
                        setExtendModal(true);
                      }}
                    >
                      <FontAwesome name="calendar-plus-o" size={12} color="#fff" />
                      <Text style={styles.actionBtnText}>Extend</Text>
                    </TouchableOpacity>
                  )}
                  {(item.subscription_status === 'active' || item.subscription_status === 'approved' || item.subscription_status === 'trial') && (
                    <TouchableOpacity
                      style={[styles.actionBtn, { backgroundColor: '#8B1A1A' }]}
                      onPress={() => handleCancel(item)}
                    >
                      <FontAwesome name="ban" size={12} color="#fff" />
                      <Text style={styles.actionBtnText}>Cancel</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    style={[styles.actionBtn, { backgroundColor: item.is_efris_enabled ? '#4CAF50' : '#533483' }]}
                    onPress={() => openEfrisModal(item)}
                  >
                    <FontAwesome name="file-text-o" size={12} color="#fff" />
                    <Text style={styles.actionBtnText}>{item.is_efris_enabled ? 'EFRIS ✓' : 'EFRIS'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.actionBtn, { backgroundColor: (item.active_devices || 0) > 0 ? '#FF9800' : '#555' }]}
                    onPress={async () => {
                      setSessionsBiz(item);
                      setSessionsModal(true);
                      setLoadingSessions(true);
                      const { data, error } = await supabase.rpc('admin_get_business_sessions', { p_business_id: item.id });
                      setSessionsList(error ? [] : (data || []));
                      setLoadingSessions(false);
                    }}
                  >
                    <FontAwesome name="mobile-phone" size={14} color="#fff" />
                    <Text style={styles.actionBtnText}>{item.active_devices || 0}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
            ListEmptyComponent={
              <View style={styles.center}>
                <Text style={{ color: '#888' }}>No businesses found</Text>
              </View>
            }
          />
        </View>
      ) : (
        // ──────── PAYMENTS TAB ────────
        <FlatList
          data={payments}
          keyExtractor={(p) => p.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor="#e94560" />}
          renderItem={({ item }) => (
            <View style={styles.payCard}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'transparent' }}>
                <View style={{ flex: 1, backgroundColor: 'transparent' }}>
                  <Text style={{ color: '#fff', fontSize: 14, fontWeight: '600' }}>{item.business_name}</Text>
                  <Text style={{ color: '#aaa', fontSize: 12 }}>
                    {paymentMethodLabel(item.payment_method)} · {new Date(item.created_at).toLocaleDateString()}
                  </Text>
                  {item.payment_reference && (
                    <Text style={{ color: '#777', fontSize: 11, marginTop: 2 }} numberOfLines={1}>{item.payment_reference}</Text>
                  )}
                </View>
                <View style={{ alignItems: 'flex-end', backgroundColor: 'transparent' }}>
                  <Text style={{ color: '#4CAF50', fontSize: 15, fontWeight: '700' }}>
                    {item.currency} {Number(item.amount).toLocaleString()}
                  </Text>
                  <View style={{
                    backgroundColor: item.status === 'completed' ? '#2d6a4f' : item.status === 'pending' ? '#FF9800' : '#8B1A1A',
                    borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1, marginTop: 2,
                  }}>
                    <Text style={{ color: '#fff', fontSize: 9, fontWeight: '600', textTransform: 'uppercase' }}>{item.status}</Text>
                  </View>
                </View>
              </View>
            </View>
          )}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={{ color: '#888' }}>No payments yet</Text>
            </View>
          }
        />
      )}

      {/* ══════ ACTIVATE MODAL ══════ */}
      <Modal visible={activateModal} transparent animationType="slide">
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Activate Subscription</Text>
            <Text style={styles.modalSubtitle}>{selectedBiz?.name}</Text>

            {/* Plan selector */}
            <Text style={styles.formLabel}>Plan</Text>
            <View style={styles.chipRow}>
              {PLANS.map((p) => (
                <TouchableOpacity
                  key={p}
                  style={[styles.chip, selectedPlan === p && styles.chipActive]}
                  onPress={() => setSelectedPlan(p)}
                >
                  <Text style={[styles.chipText, selectedPlan === p && styles.chipTextActive]}>
                    {PLAN_LABELS[p]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Billing cycle */}
            <Text style={styles.formLabel}>Billing Cycle</Text>
            <View style={styles.chipRow}>
              {(['monthly', 'yearly'] as const).map((c) => (
                <TouchableOpacity
                  key={c}
                  style={[styles.chip, billingCycle === c && styles.chipActive]}
                  onPress={() => setBillingCycle(c)}
                >
                  <Text style={[styles.chipText, billingCycle === c && styles.chipTextActive]}>
                    {c === 'monthly' ? 'Monthly' : 'Yearly'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Cash amount */}
            <Text style={styles.formLabel}>Cash Amount Received (optional)</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="e.g. 25000"
              placeholderTextColor="#555"
              value={cashAmount}
              onChangeText={setCashAmount}
              keyboardType="numeric"
            />

            {/* Notes */}
            <Text style={styles.formLabel}>Notes / Reference</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="e.g. Cash paid at office"
              placeholderTextColor="#555"
              value={notes}
              onChangeText={setNotes}
            />

            <View style={styles.modalButtons}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setActivateModal(false)}>
                <Text style={{ color: '#fff' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalConfirm} onPress={handleActivate} disabled={activating}>
                {activating ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={{ color: '#fff', fontWeight: '700' }}>✅ Activate</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ══════ EXTEND MODAL ══════ */}
      <Modal visible={extendModal} transparent animationType="slide">
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Extend Subscription</Text>
            <Text style={styles.modalSubtitle}>{selectedBiz?.name}</Text>

            <Text style={styles.formLabel}>Days to Add</Text>
            <View style={styles.chipRow}>
              {['7', '14', '30', '90', '365'].map((d) => (
                <TouchableOpacity
                  key={d}
                  style={[styles.chip, extendDays === d && styles.chipActive]}
                  onPress={() => setExtendDays(d)}
                >
                  <Text style={[styles.chipText, extendDays === d && styles.chipTextActive]}>{d}d</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput
              style={[styles.modalInput, { marginTop: 8 }]}
              placeholder="Or enter custom days"
              placeholderTextColor="#555"
              value={extendDays}
              onChangeText={setExtendDays}
              keyboardType="numeric"
            />

            <Text style={styles.formLabel}>Notes (optional)</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Reason for extension"
              placeholderTextColor="#555"
              value={notes}
              onChangeText={setNotes}
            />

            <View style={styles.modalButtons}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setExtendModal(false)}>
                <Text style={{ color: '#fff' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalConfirm} onPress={handleExtend} disabled={extending}>
                {extending ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={{ color: '#fff', fontWeight: '700' }}>📅 Extend</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ══════ EFRIS CONFIG MODAL ══════ */}

      {/* ══════ DEVICE SESSIONS MODAL ══════ */}
      <Modal visible={sessionsModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>📱 Active Devices</Text>
            <Text style={styles.modalSubtitle}>{sessionsBiz?.name}</Text>

            {loadingSessions ? (
              <ActivityIndicator color="#e94560" style={{ marginVertical: 20 }} />
            ) : sessionsList.length === 0 ? (
              <Text style={{ color: '#888', textAlign: 'center', marginVertical: 20 }}>No active sessions</Text>
            ) : (
              <FlatList
                data={sessionsList}
                keyExtractor={(s) => s.id}
                style={{ maxHeight: 300 }}
                renderItem={({ item: s }) => {
                  const ago = Math.round((Date.now() - new Date(s.last_active_at).getTime()) / 60000);
                  const agoLabel = ago < 1 ? 'Just now' : ago < 60 ? `${ago}m ago` : `${Math.round(ago / 60)}h ago`;
                  return (
                    <View style={{ backgroundColor: '#0f3460', borderRadius: 10, padding: 12, marginBottom: 8 }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'transparent' }}>
                        <View style={{ flex: 1, backgroundColor: 'transparent' }}>
                          <Text style={{ color: '#fff', fontWeight: '600', fontSize: 13 }}>
                            <FontAwesome name={s.platform === 'ios' ? 'apple' : s.platform === 'android' ? 'android' : 'globe'} size={13} color="#aaa" />
                            {'  '}{s.device_name}
                          </Text>
                          <Text style={{ color: '#aaa', fontSize: 11, marginTop: 2 }}>
                            {s.user_name} · {agoLabel}
                          </Text>
                        </View>
                        <TouchableOpacity
                          onPress={() => {
                            Alert.alert('Terminate Session', `Remove ${s.device_name}?`, [
                              { text: 'Cancel', style: 'cancel' },
                              {
                                text: 'Remove',
                                style: 'destructive',
                                onPress: async () => {
                                  await supabase.rpc('admin_remove_device_session', {
                                    p_session_id: s.id,
                                    p_business_id: sessionsBiz!.id,
                                  });
                                  setSessionsList(prev => prev.filter(x => x.id !== s.id));
                                },
                              },
                            ]);
                          }}
                          style={{ backgroundColor: '#8B1A1A', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6 }}
                        >
                          <Text style={{ color: '#fff', fontSize: 11, fontWeight: '600' }}>Remove</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                }}
              />
            )}

            <TouchableOpacity
              style={[styles.modalCancel, { marginTop: 16 }]}
              onPress={() => setSessionsModal(false)}
            >
              <Text style={{ color: '#fff', fontWeight: '600' }}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      <Modal visible={efrisModal} transparent animationType="slide">
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <View style={styles.modalOverlay}>
          <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 20 }}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>🇺🇬 EFRIS Configuration</Text>
            <Text style={styles.modalSubtitle}>{selectedBiz?.name}</Text>

            {/* EFRIS toggle */}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, backgroundColor: 'transparent' }}>
              <View style={{ flex: 1, backgroundColor: 'transparent' }}>
                <Text style={{ color: '#fff', fontSize: 14, fontWeight: '600' }}>
                  {efrisEnabled ? '✅ EFRIS Enabled' : '⭕ EFRIS Disabled'}
                </Text>
                <Text style={{ color: '#888', fontSize: 11, marginTop: 2 }}>
                  {efrisEnabled ? 'Receipts are URA-compliant' : 'Internal use only — not URA compliant'}
                </Text>
              </View>
              <Switch
                value={efrisEnabled}
                onValueChange={setEfrisEnabled}
                trackColor={{ false: '#333', true: '#4CAF50' }}
                thumbColor={efrisEnabled ? '#fff' : '#666'}
              />
            </View>

            {efrisEnabled && (
              <>
                {/* API Key */}
                <Text style={styles.formLabel}>EFRIS API Key</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="Organization API key"
                  placeholderTextColor="#555"
                  value={efrisApiKey}
                  onChangeText={setEfrisApiKey}
                  secureTextEntry
                />

                {/* API URL */}
                <Text style={styles.formLabel}>API URL (optional)</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="Leave blank for default middleware URL"
                  placeholderTextColor="#555"
                  value={efrisApiUrl}
                  onChangeText={setEfrisApiUrl}
                  autoCapitalize="none"
                  keyboardType="url"
                />

                {/* Environment toggle */}
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, backgroundColor: 'transparent' }}>
                  <View style={{ flex: 1, backgroundColor: 'transparent' }}>
                    <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600' }}>Environment</Text>
                    <Text style={{ color: '#888', fontSize: 11, marginTop: 2 }}>
                      {efrisTestMode ? 'Test / Sandbox — No real URA submissions' : '🟢 PRODUCTION — Live URA submissions'}
                    </Text>
                  </View>
                  <Switch
                    value={efrisTestMode}
                    onValueChange={setEfrisTestMode}
                    trackColor={{ false: '#e94560', true: '#4CAF50' }}
                    thumbColor="#fff"
                  />
                </View>

                {/* Test Connection */}
                <TouchableOpacity
                  style={{ backgroundColor: '#1a1a2e', borderWidth: 1, borderColor: '#7C3AED', borderRadius: 10, padding: 12, alignItems: 'center', marginBottom: 12 }}
                  onPress={handleTestEfris}
                  disabled={testingEfris}
                >
                  {testingEfris ? <ActivityIndicator color="#7C3AED" size="small" /> : <Text style={{ color: '#7C3AED', fontWeight: '700', fontSize: 14 }}>Test Connection</Text>}
                </TouchableOpacity>
              </>
            )}

            <View style={styles.modalButtons}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setEfrisModal(false)}>
                <Text style={{ color: '#fff' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalConfirm} onPress={handleSaveEfris} disabled={savingEfris}>
                {savingEfris ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={{ color: '#fff', fontWeight: '700' }}>💾 Save EFRIS Config</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
          </ScrollView>
        </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'transparent', padding: 40 },
  scroll: { flex: 1, padding: 16 },

  // Tab bar
  tabBar: { flexDirection: 'row', backgroundColor: '#16213e', borderBottomWidth: 1, borderBottomColor: '#0f3460' },
  tabBtn: { flex: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, paddingVertical: 14, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabBtnActive: { borderBottomColor: '#e94560' },
  tabLabel: { color: '#888', fontSize: 13, fontWeight: '600' },
  tabLabelActive: { color: '#e94560' },

  // Dashboard
  sectionTitle: { color: '#fff', fontSize: 16, fontWeight: '700', marginBottom: 12 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statCard: { width: '47%', borderRadius: 12, padding: 16, alignItems: 'center' },
  statNumber: { color: '#fff', fontSize: 28, fontWeight: '800' },
  statLabel: { color: '#ccc', fontSize: 11, marginTop: 4, textAlign: 'center' },
  revenueRow: { flexDirection: 'row', gap: 10, marginBottom: 24 },
  revenueCard: { flex: 1, backgroundColor: '#16213e', borderRadius: 12, padding: 16, alignItems: 'center' },
  revenueAmount: { color: '#4CAF50', fontSize: 18, fontWeight: '800' },
  revenueLabel: { color: '#aaa', fontSize: 12, marginTop: 4 },

  // Search
  searchInput: { backgroundColor: '#16213e', color: '#fff', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, margin: 12, fontSize: 14, borderWidth: 1, borderColor: '#0f3460' },

  // Business card
  bizCard: { backgroundColor: '#16213e', borderRadius: 12, padding: 14, marginHorizontal: 12, marginBottom: 10, borderWidth: 1, borderColor: '#0f3460' },
  bizHeader: { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: 'transparent' },
  bizName: { color: '#fff', fontSize: 15, fontWeight: '700' },
  bizSub: { color: '#aaa', fontSize: 12, marginTop: 2 },
  bizActions: { flexDirection: 'row', gap: 8, marginTop: 10, backgroundColor: 'transparent' },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  actionBtnText: { color: '#fff', fontSize: 11, fontWeight: '600' },

  // Payment card
  payCard: { backgroundColor: '#16213e', borderRadius: 12, padding: 14, marginHorizontal: 12, marginBottom: 8, borderWidth: 1, borderColor: '#0f3460' },

  // Chip selector
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12, backgroundColor: 'transparent' },
  chip: { backgroundColor: '#1a1a2e', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: '#0f3460' },
  chipActive: { backgroundColor: '#e94560', borderColor: '#e94560' },
  chipText: { color: '#aaa', fontSize: 12, fontWeight: '600' },
  chipTextActive: { color: '#fff' },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', padding: 20 },
  modalCard: { backgroundColor: '#16213e', borderRadius: 16, padding: 20, maxHeight: '85%' },
  modalTitle: { color: '#fff', fontSize: 18, fontWeight: '800', textAlign: 'center' },
  modalSubtitle: { color: '#e94560', fontSize: 14, fontWeight: '600', textAlign: 'center', marginBottom: 16 },
  formLabel: { color: '#aaa', fontSize: 12, fontWeight: '600', marginBottom: 6 },
  modalInput: { backgroundColor: '#1a1a2e', color: '#fff', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, borderWidth: 1, borderColor: '#0f3460', marginBottom: 12 },
  modalButtons: { flexDirection: 'row', gap: 10, marginTop: 16, backgroundColor: 'transparent' },
  modalCancel: { flex: 1, backgroundColor: '#333', borderRadius: 10, padding: 14, alignItems: 'center' },
  modalConfirm: { flex: 1, backgroundColor: '#2d6a4f', borderRadius: 10, padding: 14, alignItems: 'center' },
});
