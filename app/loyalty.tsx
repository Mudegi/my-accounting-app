import React, { useState, useCallback } from 'react';
import {
  StyleSheet,
  TouchableOpacity,
  FlatList,
  TextInput,
  Alert,
  Modal,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { Text, View } from '@/components/Themed';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useFocusEffect } from 'expo-router';

type LoyaltyCustomer = {
  id: string;
  name: string;
  phone: string | null;
  loyalty_points: number;
  total_spent: number;
};

type LoyaltyTx = {
  id: string;
  points: number;
  type: 'earn' | 'redeem' | 'adjust';
  description: string | null;
  created_at: string;
};

export default function LoyaltyScreen() {
  const { business, profile, fmt } = useAuth();
  const isAdmin = profile?.role === 'admin';

  const [customers, setCustomers] = useState<LoyaltyCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Settings
  const [pointsPerAmount, setPointsPerAmount] = useState(1);
  const [amountUnit, setAmountUnit] = useState(1000);
  const [showSettings, setShowSettings] = useState(false);
  const [settingPoints, setSettingPoints] = useState('1');
  const [settingAmount, setSettingAmount] = useState('1000');

  // Customer detail
  const [selectedCustomer, setSelectedCustomer] = useState<LoyaltyCustomer | null>(null);
  const [transactions, setTransactions] = useState<LoyaltyTx[]>([]);
  const [loadingTx, setLoadingTx] = useState(false);

  // Adjust points modal
  const [showAdjust, setShowAdjust] = useState(false);
  const [adjustPoints, setAdjustPoints] = useState('');
  const [adjustType, setAdjustType] = useState<'earn' | 'redeem' | 'adjust'>('adjust');
  const [adjustNote, setAdjustNote] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!business) return;

    try {
      // Load loyalty settings
      const { data: bizData } = await supabase
        .from('businesses')
        .select('loyalty_points_per_amount, loyalty_amount_unit')
        .eq('id', business.id)
        .single();

      if (bizData) {
        setPointsPerAmount(bizData.loyalty_points_per_amount || 1);
        setAmountUnit(bizData.loyalty_amount_unit || 1000);
      }

      // Load customers with loyalty points
      const { data: custData } = await supabase
        .from('customers')
        .select('id, name, phone, loyalty_points')
        .eq('business_id', business.id)
        .order('loyalty_points', { ascending: false });

      if (custData) {
        // Also get total spent per customer
        const { data: salesData } = await supabase
          .from('sales')
          .select('customer_id, total_amount')
          .eq('business_id', business.id)
          .eq('status', 'completed')
          .not('customer_id', 'is', null);

        const spentMap: Record<string, number> = {};
        salesData?.forEach((s: any) => {
          if (s.customer_id) {
            spentMap[s.customer_id] = (spentMap[s.customer_id] || 0) + Number(s.total_amount);
          }
        });

        const enriched: LoyaltyCustomer[] = custData.map(c => ({
          id: c.id,
          name: c.name,
          phone: c.phone,
          loyalty_points: c.loyalty_points || 0,
          total_spent: spentMap[c.id] || 0,
        }));

        setCustomers(enriched);
      }
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setLoading(false);
    }
  }, [business]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  // Open customer loyalty detail
  const openCustomerDetail = async (customer: LoyaltyCustomer) => {
    setSelectedCustomer(customer);
    setLoadingTx(true);

    try {
      const { data } = await supabase
        .from('loyalty_transactions')
        .select('id, points, type, description, created_at')
        .eq('customer_id', customer.id)
        .order('created_at', { ascending: false })
        .limit(50);

      setTransactions(data || []);
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setLoadingTx(false);
    }
  };

  // Save settings
  const saveSettings = async () => {
    if (!business) return;
    const pts = parseInt(settingPoints) || 1;
    const amt = parseFloat(settingAmount) || 1000;

    try {
      const { error } = await supabase
        .from('businesses')
        .update({
          loyalty_points_per_amount: pts,
          loyalty_amount_unit: amt,
        })
        .eq('id', business.id);

      if (error) throw error;
      setPointsPerAmount(pts);
      setAmountUnit(amt);
      setShowSettings(false);
      Alert.alert('Saved', `Earn ${pts} point(s) per ${fmt(amt)} spent`);
    } catch (err: any) {
      Alert.alert('Error', err.message);
    }
  };

  // Manually adjust points
  const handleAdjustPoints = async () => {
    if (!selectedCustomer || !business || !profile) return;
    const pts = parseInt(adjustPoints);
    if (!pts || pts === 0) {
      Alert.alert('Error', 'Enter valid points');
      return;
    }

    const actualPoints = adjustType === 'redeem' ? -Math.abs(pts) : Math.abs(pts);

    if (adjustType === 'redeem' && Math.abs(actualPoints) > selectedCustomer.loyalty_points) {
      Alert.alert('Error', `Customer only has ${selectedCustomer.loyalty_points} points`);
      return;
    }

    setSaving(true);
    try {
      // Insert transaction
      const { error: txErr } = await supabase
        .from('loyalty_transactions')
        .insert({
          business_id: business.id,
          customer_id: selectedCustomer.id,
          points: actualPoints,
          type: adjustType,
          description: adjustNote.trim() || `Manual ${adjustType}`,
          created_by: profile.id,
        });

      if (txErr) throw txErr;

      // Update customer balance
      const newBalance = selectedCustomer.loyalty_points + actualPoints;
      const { error: custErr } = await supabase
        .from('customers')
        .update({ loyalty_points: Math.max(0, newBalance) })
        .eq('id', selectedCustomer.id);

      if (custErr) throw custErr;

      Alert.alert('Done', `${actualPoints > 0 ? '+' : ''}${actualPoints} points`);
      setShowAdjust(false);

      // Refresh
      const updated = { ...selectedCustomer, loyalty_points: Math.max(0, newBalance) };
      setSelectedCustomer(updated);
      await openCustomerDetail(updated);
      await load();
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setSaving(false);
    }
  };

  const formatDate = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
  const formatTime = (d: string) => new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

  const filtered = searchQuery.trim()
    ? customers.filter(c =>
        c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (c.phone && c.phone.includes(searchQuery))
      )
    : customers;

  const totalPoints = customers.reduce((s, c) => s + c.loyalty_points, 0);

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#e94560" style={{ marginTop: 60 }} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={{ backgroundColor: 'transparent', flex: 1 }}>
          <Text style={styles.heading}>⭐ Loyalty Points</Text>
          <Text style={styles.subheading}>
            Earn {pointsPerAmount} pt per {fmt(amountUnit)} spent
          </Text>
        </View>
        {isAdmin && (
          <TouchableOpacity
            style={styles.settingsBtn}
            onPress={() => {
              setSettingPoints(pointsPerAmount.toString());
              setSettingAmount(amountUnit.toString());
              setShowSettings(true);
            }}
          >
            <FontAwesome name="cog" size={18} color="#aaa" />
          </TouchableOpacity>
        )}
      </View>

      {/* Summary */}
      <View style={styles.summaryCard}>
        <View style={styles.summaryRow}>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryValue}>{totalPoints.toLocaleString()}</Text>
            <Text style={styles.summaryLabel}>Total Points</Text>
          </View>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryValue}>{customers.filter(c => c.loyalty_points > 0).length}</Text>
            <Text style={styles.summaryLabel}>Active Members</Text>
          </View>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryValue}>{customers.length}</Text>
            <Text style={styles.summaryLabel}>Customers</Text>
          </View>
        </View>
      </View>

      {/* Search */}
      <View style={styles.searchRow}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search customers..."
          placeholderTextColor="#666"
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
      </View>

      {/* List */}
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#e94560" />}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.card} onPress={() => openCustomerDetail(item)}>
            <View style={styles.cardBody}>
              <View style={styles.cardInfo}>
                <Text style={styles.cardName}>{item.name}</Text>
                {item.phone && <Text style={styles.cardSub}>📱 {item.phone}</Text>}
                <Text style={styles.cardSub}>Total spent: {fmt(item.total_spent)}</Text>
              </View>
              <View style={styles.cardRight}>
                <Text style={styles.pointsValue}>⭐ {item.loyalty_points}</Text>
                <Text style={styles.pointsLabel}>points</Text>
              </View>
            </View>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <FontAwesome name="star-o" size={48} color="#333" />
            <Text style={styles.emptyText}>No loyalty members yet</Text>
            <Text style={styles.emptyHint}>Points are earned automatically on sales linked to customers</Text>
          </View>
        }
      />

      {/* Customer Detail Modal */}
      <Modal visible={!!selectedCustomer} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{selectedCustomer?.name}</Text>
              <TouchableOpacity onPress={() => { setSelectedCustomer(null); setTransactions([]); }}>
                <FontAwesome name="times" size={22} color="#aaa" />
              </TouchableOpacity>
            </View>

            {selectedCustomer && (
              <View style={styles.detailSummary}>
                <View style={styles.detailItem}>
                  <Text style={[styles.detailVal, { color: '#FFD700' }]}>⭐ {selectedCustomer.loyalty_points}</Text>
                  <Text style={styles.detailLabel}>Points Balance</Text>
                </View>
                <View style={styles.detailItem}>
                  <Text style={styles.detailVal}>{fmt(selectedCustomer.total_spent)}</Text>
                  <Text style={styles.detailLabel}>Total Spent</Text>
                </View>
              </View>
            )}

            {/* Adjust Points Button */}
            <TouchableOpacity
              style={styles.adjustBtnRow}
              onPress={() => {
                setAdjustPoints('');
                setAdjustType('adjust');
                setAdjustNote('');
                setShowAdjust(true);
              }}
            >
              <FontAwesome name="pencil" size={14} color="#fff" />
              <Text style={styles.adjustBtnText}>Adjust Points</Text>
            </TouchableOpacity>

            {/* Transaction History */}
            <Text style={styles.sectionLabel}>Points History</Text>
            {loadingTx ? (
              <ActivityIndicator color="#e94560" style={{ marginTop: 20 }} />
            ) : (
              <FlatList
                data={transactions}
                keyExtractor={(item) => item.id}
                style={{ maxHeight: 300 }}
                renderItem={({ item }) => (
                  <View style={styles.txCard}>
                    <View style={{ backgroundColor: 'transparent', flex: 1 }}>
                      <Text style={styles.txDesc}>{item.description || item.type}</Text>
                      <Text style={styles.txDate}>{formatTime(item.created_at)}</Text>
                    </View>
                    <Text style={[styles.txPoints, { color: item.points >= 0 ? '#4CAF50' : '#e94560' }]}>
                      {item.points >= 0 ? '+' : ''}{item.points}
                    </Text>
                  </View>
                )}
                ListEmptyComponent={
                  <Text style={{ color: '#666', textAlign: 'center', marginTop: 16 }}>No point transactions yet</Text>
                }
              />
            )}
          </View>
        </View>
      </Modal>

      {/* Adjust Points Modal */}
      <Modal visible={showAdjust} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <ScrollView>
              <Text style={styles.modalTitle}>Adjust Points</Text>
              <Text style={styles.payInfo}>
                {selectedCustomer?.name} — Current: ⭐ {selectedCustomer?.loyalty_points}
              </Text>

              <Text style={styles.label}>Action</Text>
              <View style={styles.chipRow}>
                <TouchableOpacity
                  style={[styles.chip, adjustType === 'earn' && styles.chipEarn]}
                  onPress={() => setAdjustType('earn')}
                >
                  <Text style={[styles.chipText, adjustType === 'earn' && { color: '#fff' }]}>+ Add</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.chip, adjustType === 'redeem' && styles.chipRedeem]}
                  onPress={() => setAdjustType('redeem')}
                >
                  <Text style={[styles.chipText, adjustType === 'redeem' && { color: '#fff' }]}>- Redeem</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.chip, adjustType === 'adjust' && styles.chipActive]}
                  onPress={() => setAdjustType('adjust')}
                >
                  <Text style={[styles.chipText, adjustType === 'adjust' && { color: '#fff' }]}>Adjust</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.label}>Points</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. 50"
                placeholderTextColor="#555"
                value={adjustPoints}
                onChangeText={setAdjustPoints}
                keyboardType="numeric"
              />

              <Text style={styles.label}>Note</Text>
              <TextInput
                style={styles.input}
                placeholder="Reason for adjustment"
                placeholderTextColor="#555"
                value={adjustNote}
                onChangeText={setAdjustNote}
              />

              <TouchableOpacity
                style={[styles.saveBtn, saving && { opacity: 0.6 }]}
                onPress={handleAdjustPoints}
                disabled={saving}
              >
                {saving ? <ActivityIndicator color="#fff" /> : (
                  <Text style={styles.saveBtnText}>Confirm</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowAdjust(false)}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Settings Modal */}
      <Modal visible={showSettings} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <ScrollView>
              <Text style={styles.modalTitle}>Loyalty Settings</Text>

              <Text style={styles.label}>Points earned per unit</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. 1"
                placeholderTextColor="#555"
                value={settingPoints}
                onChangeText={setSettingPoints}
                keyboardType="numeric"
              />

              <Text style={styles.label}>Per amount spent (in currency)</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. 1000"
                placeholderTextColor="#555"
                value={settingAmount}
                onChangeText={setSettingAmount}
                keyboardType="numeric"
              />

              <Text style={styles.hint}>
                Example: Earn {settingPoints || '1'} point(s) for every {fmt(parseFloat(settingAmount) || 1000)} spent
              </Text>

              <TouchableOpacity style={styles.saveBtn} onPress={saveSettings}>
                <Text style={styles.saveBtnText}>Save Settings</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowSettings(false)}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 16, backgroundColor: 'transparent',
  },
  heading: { fontSize: 22, fontWeight: 'bold', color: '#fff' },
  subheading: { fontSize: 13, color: '#aaa', marginTop: 2 },
  settingsBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: '#16213e',
    alignItems: 'center', justifyContent: 'center',
  },
  summaryCard: {
    backgroundColor: '#16213e', marginHorizontal: 16, marginBottom: 8, borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: '#0f3460',
  },
  summaryRow: {
    flexDirection: 'row', justifyContent: 'space-around', backgroundColor: 'transparent',
  },
  summaryItem: { alignItems: 'center', backgroundColor: 'transparent' },
  summaryValue: { fontSize: 22, fontWeight: 'bold', color: '#FFD700' },
  summaryLabel: { fontSize: 11, color: '#aaa', marginTop: 4 },
  searchRow: { paddingHorizontal: 16, paddingBottom: 8, backgroundColor: 'transparent' },
  searchInput: {
    backgroundColor: '#16213e', borderRadius: 10, padding: 12,
    color: '#fff', fontSize: 15, borderWidth: 1, borderColor: '#0f3460',
  },
  card: {
    backgroundColor: '#16213e', marginHorizontal: 16, marginBottom: 8,
    borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#0f3460',
  },
  cardBody: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: 'transparent',
  },
  cardInfo: { flex: 1, backgroundColor: 'transparent' },
  cardRight: { alignItems: 'flex-end', backgroundColor: 'transparent' },
  cardName: { fontSize: 15, fontWeight: 'bold', color: '#fff' },
  cardSub: { fontSize: 12, color: '#aaa', marginTop: 2 },
  pointsValue: { fontSize: 20, fontWeight: 'bold', color: '#FFD700' },
  pointsLabel: { fontSize: 11, color: '#aaa' },
  emptyState: { alignItems: 'center', paddingTop: 60, backgroundColor: 'transparent' },
  emptyText: { color: '#555', fontSize: 16, marginTop: 12 },
  emptyHint: { color: '#444', fontSize: 13, marginTop: 4, textAlign: 'center', paddingHorizontal: 40 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalContent: {
    backgroundColor: '#1a1a2e', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 20, maxHeight: '90%',
  },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: 'transparent', marginBottom: 12,
  },
  modalTitle: { fontSize: 20, fontWeight: 'bold', color: '#fff' },
  detailSummary: {
    flexDirection: 'row', justifyContent: 'space-around',
    backgroundColor: '#16213e', borderRadius: 12, padding: 14, marginBottom: 12,
  },
  detailItem: { alignItems: 'center', backgroundColor: 'transparent' },
  detailVal: { fontSize: 18, fontWeight: 'bold', color: '#fff' },
  detailLabel: { fontSize: 11, color: '#aaa', marginTop: 2 },
  adjustBtnRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#533483', borderRadius: 10, padding: 10, marginBottom: 12,
  },
  adjustBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 14 },
  sectionLabel: { fontSize: 14, fontWeight: 'bold', color: '#ccc', marginBottom: 8 },
  txCard: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#16213e', borderRadius: 10, padding: 12, marginBottom: 6,
    borderWidth: 1, borderColor: '#0f3460',
  },
  txDesc: { color: '#fff', fontSize: 14 },
  txDate: { color: '#aaa', fontSize: 11, marginTop: 2 },
  txPoints: { fontSize: 16, fontWeight: 'bold' },
  payInfo: { color: '#aaa', fontSize: 14, marginBottom: 8 },
  label: { fontSize: 13, color: '#aaa', marginBottom: 4, marginTop: 12 },
  input: {
    backgroundColor: '#16213e', borderRadius: 10, padding: 12, color: '#fff',
    fontSize: 15, borderWidth: 1, borderColor: '#0f3460',
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4, backgroundColor: 'transparent' },
  chip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10,
    backgroundColor: '#16213e', borderWidth: 1, borderColor: '#0f3460',
  },
  chipActive: { backgroundColor: '#e94560', borderColor: '#e94560' },
  chipEarn: { backgroundColor: '#4CAF50', borderColor: '#4CAF50' },
  chipRedeem: { backgroundColor: '#e94560', borderColor: '#e94560' },
  chipText: { fontSize: 13, color: '#aaa' },
  hint: { color: '#666', fontSize: 12, marginTop: 8 },
  saveBtn: {
    backgroundColor: '#4CAF50', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 20,
  },
  saveBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  cancelBtn: { padding: 14, alignItems: 'center', marginTop: 8 },
  cancelBtnText: { color: '#aaa', fontSize: 15 },
});
