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

type CashSession = {
  id: string;
  opening_balance: number;
  closing_balance: number | null;
  expected_balance: number | null;
  difference: number | null;
  cash_sales: number;
  mobile_sales: number;
  card_sales: number;
  credit_sales: number;
  total_sales: number;
  transaction_count: number;
  expenses_total: number;
  note: string | null;
  status: 'open' | 'closed';
  opened_at: string;
  closed_at: string | null;
  branch_name?: string;
};

export default function CashRegisterScreen() {
  const { business, currentBranch, profile, fmt, branches } = useAuth();
  const isAdmin = profile?.role === 'admin';

  const [activeSession, setActiveSession] = useState<CashSession | null>(null);
  const [pastSessions, setPastSessions] = useState<CashSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Open register modal
  const [showOpen, setShowOpen] = useState(false);
  const [openingBalance, setOpeningBalance] = useState('0');

  // Close register modal
  const [showClose, setShowClose] = useState(false);
  const [closingBalance, setClosingBalance] = useState('');
  const [closeNote, setCloseNote] = useState('');
  const [saving, setSaving] = useState(false);

  // Detail modal
  const [detailSession, setDetailSession] = useState<CashSession | null>(null);

  const loadSessions = useCallback(async () => {
    if (!business || !currentBranch) return;

    try {
      // Check for open session on this branch
      const { data: openSession } = await supabase
        .from('cash_register_sessions')
        .select('*')
        .eq('branch_id', currentBranch.id)
        .eq('status', 'open')
        .order('opened_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (openSession) {
        // Calculate live totals from sales made since session opened
        const { data: salesData } = await supabase
          .from('sales')
          .select('total_amount, payment_method')
          .eq('branch_id', currentBranch.id)
          .eq('status', 'completed')
          .gte('created_at', openSession.opened_at);

        const { data: expData } = await supabase
          .from('expenses')
          .select('amount')
          .eq('branch_id', currentBranch.id)
          .gte('date', openSession.opened_at.split('T')[0]);

        let cashSales = 0, mobileSales = 0, cardSales = 0, creditSales = 0, totalSales = 0;
        let txCount = 0;

        salesData?.forEach((s: any) => {
          const amt = Number(s.total_amount);
          totalSales += amt;
          txCount++;
          switch (s.payment_method) {
            case 'cash': cashSales += amt; break;
            case 'mobile_money': mobileSales += amt; break;
            case 'card': case 'bank': cardSales += amt; break;
            case 'credit': creditSales += amt; break;
          }
        });

        const expensesTotal = expData?.reduce((s: number, e: any) => s + Number(e.amount), 0) || 0;

        const enriched: CashSession = {
          ...openSession,
          cash_sales: cashSales,
          mobile_sales: mobileSales,
          card_sales: cardSales,
          credit_sales: creditSales,
          total_sales: totalSales,
          transaction_count: txCount,
          expenses_total: expensesTotal,
          expected_balance: Number(openSession.opening_balance) + cashSales - expensesTotal,
        };

        setActiveSession(enriched);
      } else {
        setActiveSession(null);
      }

      // Past sessions for this branch
      const { data: past } = await supabase
        .from('cash_register_sessions')
        .select('*')
        .eq('branch_id', currentBranch.id)
        .eq('status', 'closed')
        .order('closed_at', { ascending: false })
        .limit(30);

      setPastSessions(past || []);
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setLoading(false);
    }
  }, [business, currentBranch]);

  useFocusEffect(useCallback(() => { loadSessions(); }, [loadSessions]));

  const onRefresh = async () => {
    setRefreshing(true);
    await loadSessions();
    setRefreshing(false);
  };

  // Open register
  const handleOpenRegister = async () => {
    if (!business || !currentBranch || !profile) return;
    const balance = parseFloat(openingBalance) || 0;
    if (balance < 0) {
      Alert.alert('Error', 'Opening balance cannot be negative');
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase
        .from('cash_register_sessions')
        .insert({
          business_id: business.id,
          branch_id: currentBranch.id,
          opened_by: profile.id,
          opening_balance: balance,
          status: 'open',
        });

      if (error) throw error;
      setShowOpen(false);
      setOpeningBalance('0');
      await loadSessions();
      Alert.alert('Register Opened', `Opening balance: ${fmt(balance)}`);
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setSaving(false);
    }
  };

  // Close register
  const handleCloseRegister = async () => {
    if (!activeSession || !profile) return;
    const closing = parseFloat(closingBalance);
    if (isNaN(closing) || closing < 0) {
      Alert.alert('Error', 'Enter the actual cash in your register');
      return;
    }

    const expected = activeSession.expected_balance || 0;
    const diff = closing - expected;

    setSaving(true);
    try {
      const { error } = await supabase
        .from('cash_register_sessions')
        .update({
          closing_balance: closing,
          expected_balance: expected,
          difference: diff,
          cash_sales: activeSession.cash_sales,
          mobile_sales: activeSession.mobile_sales,
          card_sales: activeSession.card_sales,
          credit_sales: activeSession.credit_sales,
          total_sales: activeSession.total_sales,
          transaction_count: activeSession.transaction_count,
          expenses_total: activeSession.expenses_total,
          note: closeNote.trim() || null,
          status: 'closed',
          closed_at: new Date().toISOString(),
          closed_by: profile.id,
        })
        .eq('id', activeSession.id);

      if (error) throw error;

      setShowClose(false);
      setClosingBalance('');
      setCloseNote('');
      await loadSessions();

      const msg = diff === 0
        ? 'Register balanced perfectly!'
        : diff > 0
        ? `Register has ${fmt(diff)} EXTRA`
        : `Register is SHORT by ${fmt(Math.abs(diff))}`;

      Alert.alert('Register Closed', msg);
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setSaving(false);
    }
  };

  const formatDate = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const formatTime = (d: string) => new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#e94560" style={{ marginTop: 60 }} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={pastSessions}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#e94560" />}
        ListHeaderComponent={
          <>
            {/* Active Session Card */}
            {activeSession ? (
              <View style={styles.activeCard}>
                <View style={styles.activeHeader}>
                  <View style={{ backgroundColor: 'transparent' }}>
                    <Text style={styles.activeTitle}>🟢 Register Open</Text>
                    <Text style={styles.activeSub}>
                      Opened at {formatTime(activeSession.opened_at)}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={styles.closeBtn}
                    onPress={() => {
                      setClosingBalance('');
                      setCloseNote('');
                      setShowClose(true);
                    }}
                  >
                    <FontAwesome name="lock" size={14} color="#fff" />
                    <Text style={styles.closeBtnText}>Close</Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.activeStats}>
                  <View style={styles.activeStat}>
                    <Text style={styles.activeStatVal}>{fmt(activeSession.opening_balance)}</Text>
                    <Text style={styles.activeStatLabel}>Opening</Text>
                  </View>
                  <View style={styles.activeStat}>
                    <Text style={[styles.activeStatVal, { color: '#4CAF50' }]}>
                      {fmt(activeSession.cash_sales)}
                    </Text>
                    <Text style={styles.activeStatLabel}>Cash Sales</Text>
                  </View>
                  <View style={styles.activeStat}>
                    <Text style={[styles.activeStatVal, { color: '#e94560' }]}>
                      {fmt(activeSession.expenses_total)}
                    </Text>
                    <Text style={styles.activeStatLabel}>Expenses</Text>
                  </View>
                </View>

                <View style={styles.activeStats}>
                  <View style={styles.activeStat}>
                    <Text style={styles.activeStatVal}>{fmt(activeSession.mobile_sales)}</Text>
                    <Text style={styles.activeStatLabel}>Mobile $</Text>
                  </View>
                  <View style={styles.activeStat}>
                    <Text style={styles.activeStatVal}>{fmt(activeSession.card_sales)}</Text>
                    <Text style={styles.activeStatLabel}>Card/Bank</Text>
                  </View>
                  <View style={styles.activeStat}>
                    <Text style={styles.activeStatVal}>{fmt(activeSession.credit_sales)}</Text>
                    <Text style={styles.activeStatLabel}>Credit</Text>
                  </View>
                </View>

                <View style={styles.expectedRow}>
                  <Text style={styles.expectedLabel}>Expected Cash in Drawer:</Text>
                  <Text style={styles.expectedVal}>{fmt(activeSession.expected_balance || 0)}</Text>
                </View>
                <View style={styles.expectedRow}>
                  <Text style={styles.expectedLabel}>Total Revenue:</Text>
                  <Text style={[styles.expectedVal, { color: '#4CAF50' }]}>
                    {fmt(activeSession.total_sales)} ({activeSession.transaction_count} sales)
                  </Text>
                </View>
              </View>
            ) : (
              <View style={styles.noSession}>
                <FontAwesome name="calculator" size={48} color="#333" />
                <Text style={styles.noSessionTitle}>Register Not Open</Text>
                <Text style={styles.noSessionHint}>
                  Open the cash register to start tracking today's cash flow
                </Text>
                <TouchableOpacity
                  style={styles.openBtn}
                  onPress={() => {
                    setOpeningBalance('0');
                    setShowOpen(true);
                  }}
                >
                  <FontAwesome name="unlock" size={16} color="#fff" />
                  <Text style={styles.openBtnText}>Open Register</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Past Sessions Header */}
            {pastSessions.length > 0 && (
              <Text style={styles.sectionTitle}>📋 Past Sessions</Text>
            )}
          </>
        }
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.card} onPress={() => setDetailSession(item)}>
            <View style={styles.cardHeader}>
              <View style={{ backgroundColor: 'transparent', flex: 1 }}>
                <Text style={styles.cardDate}>{formatDate(item.opened_at)}</Text>
                <Text style={styles.cardSub}>
                  {formatTime(item.opened_at)} → {item.closed_at ? formatTime(item.closed_at) : '--'}
                </Text>
              </View>
              <View style={{ backgroundColor: 'transparent', alignItems: 'flex-end' }}>
                <Text style={styles.cardRevenue}>{fmt(Number(item.total_sales))}</Text>
                <Text style={styles.cardTx}>{item.transaction_count} sales</Text>
                {item.difference !== null && (
                  <View style={[
                    styles.diffBadge,
                    { backgroundColor: item.difference === 0 ? '#2d6a4f' : item.difference > 0 ? '#FF9800' : '#e94560' },
                  ]}>
                    <Text style={styles.diffText}>
                      {item.difference === 0 ? '✓ Balanced' : item.difference > 0 ? `+${fmt(item.difference)}` : fmt(item.difference)}
                    </Text>
                  </View>
                )}
              </View>
            </View>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          !activeSession ? null : (
            <View style={styles.emptyPast}>
              <Text style={{ color: '#555', textAlign: 'center' }}>No past sessions yet</Text>
            </View>
          )
        }
      />

      {/* Open Register Modal */}
      <Modal visible={showOpen} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Open Cash Register</Text>
            <Text style={styles.payInfo}>Count the cash in your register drawer</Text>

            <Text style={styles.label}>Opening Cash Balance</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. 50000"
              placeholderTextColor="#555"
              value={openingBalance}
              onChangeText={setOpeningBalance}
              keyboardType="numeric"
            />

            <TouchableOpacity
              style={[styles.saveBtn, saving && { opacity: 0.6 }]}
              onPress={handleOpenRegister}
              disabled={saving}
            >
              {saving ? <ActivityIndicator color="#fff" /> : (
                <Text style={styles.saveBtnText}>Open Register</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowOpen(false)}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Close Register Modal */}
      <Modal visible={showClose} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <ScrollView>
              <Text style={styles.modalTitle}>Close Cash Register</Text>

              {activeSession && (
                <View style={styles.closeSummary}>
                  <View style={styles.closeRow}>
                    <Text style={styles.closeLabel}>Opening Balance</Text>
                    <Text style={styles.closeVal}>{fmt(activeSession.opening_balance)}</Text>
                  </View>
                  <View style={styles.closeRow}>
                    <Text style={styles.closeLabel}>+ Cash Sales</Text>
                    <Text style={[styles.closeVal, { color: '#4CAF50' }]}>{fmt(activeSession.cash_sales)}</Text>
                  </View>
                  <View style={styles.closeRow}>
                    <Text style={styles.closeLabel}>- Expenses</Text>
                    <Text style={[styles.closeVal, { color: '#e94560' }]}>{fmt(activeSession.expenses_total)}</Text>
                  </View>
                  <View style={[styles.closeRow, { borderTopWidth: 1, borderTopColor: '#0f3460', paddingTop: 8 }]}>
                    <Text style={[styles.closeLabel, { fontWeight: 'bold', color: '#fff' }]}>Expected Cash</Text>
                    <Text style={[styles.closeVal, { fontWeight: 'bold', fontSize: 18 }]}>
                      {fmt(activeSession.expected_balance || 0)}
                    </Text>
                  </View>
                </View>
              )}

              <Text style={styles.label}>Actual Cash in Drawer *</Text>
              <TextInput
                style={styles.input}
                placeholder="Count your cash and enter the amount"
                placeholderTextColor="#555"
                value={closingBalance}
                onChangeText={setClosingBalance}
                keyboardType="numeric"
              />

              {closingBalance && activeSession?.expected_balance != null && (
                <View style={styles.diffPreview}>
                  {(() => {
                    const diff = (parseFloat(closingBalance) || 0) - (activeSession.expected_balance || 0);
                    return (
                      <Text style={[
                        styles.diffPreviewText,
                        { color: diff === 0 ? '#4CAF50' : diff > 0 ? '#FF9800' : '#e94560' },
                      ]}>
                        {diff === 0 ? '✓ Balanced!' : diff > 0 ? `+${fmt(diff)} over` : `${fmt(diff)} short`}
                      </Text>
                    );
                  })()}
                </View>
              )}

              <Text style={styles.label}>Note (optional)</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. Gave change from petty cash"
                placeholderTextColor="#555"
                value={closeNote}
                onChangeText={setCloseNote}
                multiline
              />

              <TouchableOpacity
                style={[styles.saveBtn, { backgroundColor: '#e94560' }, saving && { opacity: 0.6 }]}
                onPress={handleCloseRegister}
                disabled={saving}
              >
                {saving ? <ActivityIndicator color="#fff" /> : (
                  <Text style={styles.saveBtnText}>Close Register</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowClose(false)}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Session Detail Modal */}
      <Modal visible={!!detailSession} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <ScrollView>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Session Details</Text>
                <TouchableOpacity onPress={() => setDetailSession(null)}>
                  <FontAwesome name="times" size={22} color="#aaa" />
                </TouchableOpacity>
              </View>

              {detailSession && (
                <>
                  <Text style={styles.detailDate}>{formatDate(detailSession.opened_at)}</Text>
                  <Text style={styles.payInfo}>
                    {formatTime(detailSession.opened_at)} → {detailSession.closed_at ? formatTime(detailSession.closed_at) : '--'}
                  </Text>

                  <View style={styles.closeSummary}>
                    <View style={styles.closeRow}>
                      <Text style={styles.closeLabel}>Opening Balance</Text>
                      <Text style={styles.closeVal}>{fmt(Number(detailSession.opening_balance))}</Text>
                    </View>
                    <View style={styles.closeRow}>
                      <Text style={styles.closeLabel}>Cash Sales</Text>
                      <Text style={[styles.closeVal, { color: '#4CAF50' }]}>{fmt(Number(detailSession.cash_sales))}</Text>
                    </View>
                    <View style={styles.closeRow}>
                      <Text style={styles.closeLabel}>Mobile Money</Text>
                      <Text style={styles.closeVal}>{fmt(Number(detailSession.mobile_sales))}</Text>
                    </View>
                    <View style={styles.closeRow}>
                      <Text style={styles.closeLabel}>Card/Bank</Text>
                      <Text style={styles.closeVal}>{fmt(Number(detailSession.card_sales))}</Text>
                    </View>
                    <View style={styles.closeRow}>
                      <Text style={styles.closeLabel}>Credit Sales</Text>
                      <Text style={[styles.closeVal, { color: '#FF9800' }]}>{fmt(Number(detailSession.credit_sales))}</Text>
                    </View>
                    <View style={styles.closeRow}>
                      <Text style={styles.closeLabel}>Expenses</Text>
                      <Text style={[styles.closeVal, { color: '#e94560' }]}>{fmt(Number(detailSession.expenses_total))}</Text>
                    </View>
                    <View style={[styles.closeRow, { borderTopWidth: 1, borderTopColor: '#0f3460', paddingTop: 8 }]}>
                      <Text style={[styles.closeLabel, { fontWeight: 'bold', color: '#fff' }]}>Total Revenue</Text>
                      <Text style={[styles.closeVal, { fontWeight: 'bold' }]}>{fmt(Number(detailSession.total_sales))}</Text>
                    </View>
                    <View style={styles.closeRow}>
                      <Text style={styles.closeLabel}>Transactions</Text>
                      <Text style={styles.closeVal}>{detailSession.transaction_count}</Text>
                    </View>
                    <View style={styles.closeRow}>
                      <Text style={styles.closeLabel}>Expected Cash</Text>
                      <Text style={styles.closeVal}>{fmt(Number(detailSession.expected_balance || 0))}</Text>
                    </View>
                    <View style={styles.closeRow}>
                      <Text style={styles.closeLabel}>Actual Cash</Text>
                      <Text style={styles.closeVal}>{fmt(Number(detailSession.closing_balance || 0))}</Text>
                    </View>
                    <View style={[styles.closeRow, { borderTopWidth: 1, borderTopColor: '#0f3460', paddingTop: 8 }]}>
                      <Text style={[styles.closeLabel, { fontWeight: 'bold', color: '#fff' }]}>Variance</Text>
                      <Text style={[styles.closeVal, {
                        fontWeight: 'bold',
                        color: (detailSession.difference || 0) === 0 ? '#4CAF50'
                          : (detailSession.difference || 0) > 0 ? '#FF9800' : '#e94560',
                      }]}>
                        {(detailSession.difference || 0) === 0
                          ? '✓ Balanced'
                          : (detailSession.difference || 0) > 0
                          ? `+${fmt(detailSession.difference || 0)}`
                          : fmt(detailSession.difference || 0)}
                      </Text>
                    </View>
                  </View>

                  {detailSession.note && (
                    <View style={{ marginTop: 8 }}>
                      <Text style={styles.closeLabel}>Note:</Text>
                      <Text style={{ color: '#ccc', marginTop: 4 }}>{detailSession.note}</Text>
                    </View>
                  )}
                </>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  activeCard: {
    backgroundColor: '#16213e', margin: 16, borderRadius: 16, padding: 16,
    borderWidth: 2, borderColor: '#4CAF50',
  },
  activeHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: 'transparent', marginBottom: 12,
  },
  activeTitle: { fontSize: 18, fontWeight: 'bold', color: '#4CAF50' },
  activeSub: { fontSize: 12, color: '#aaa', marginTop: 2 },
  closeBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#e94560', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 8,
  },
  closeBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 14 },
  activeStats: {
    flexDirection: 'row', justifyContent: 'space-around',
    backgroundColor: 'transparent', marginBottom: 8,
  },
  activeStat: { alignItems: 'center', backgroundColor: 'transparent' },
  activeStatVal: { fontSize: 16, fontWeight: 'bold', color: '#fff' },
  activeStatLabel: { fontSize: 11, color: '#aaa', marginTop: 2 },
  expectedRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    backgroundColor: 'transparent', marginTop: 8, paddingTop: 8,
    borderTopWidth: 1, borderTopColor: '#0f3460',
  },
  expectedLabel: { color: '#aaa', fontSize: 14 },
  expectedVal: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  noSession: {
    alignItems: 'center', padding: 32, margin: 16,
    backgroundColor: '#16213e', borderRadius: 16, borderWidth: 1, borderColor: '#0f3460',
  },
  noSessionTitle: { fontSize: 18, fontWeight: 'bold', color: '#fff', marginTop: 16 },
  noSessionHint: { fontSize: 13, color: '#aaa', textAlign: 'center', marginTop: 8 },
  openBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#4CAF50', borderRadius: 12, paddingHorizontal: 24, paddingVertical: 14,
    marginTop: 20,
  },
  openBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  sectionTitle: { fontSize: 18, fontWeight: 'bold', color: '#fff', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 },
  card: {
    backgroundColor: '#16213e', marginHorizontal: 16, marginBottom: 8,
    borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#0f3460',
  },
  cardHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: 'transparent',
  },
  cardDate: { fontSize: 15, fontWeight: 'bold', color: '#fff' },
  cardSub: { fontSize: 12, color: '#aaa', marginTop: 2 },
  cardRevenue: { fontSize: 16, fontWeight: 'bold', color: '#4CAF50' },
  cardTx: { fontSize: 12, color: '#aaa', marginTop: 2 },
  diffBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, marginTop: 4 },
  diffText: { color: '#fff', fontSize: 11, fontWeight: 'bold' },
  emptyPast: { paddingTop: 20, backgroundColor: 'transparent' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalContent: {
    backgroundColor: '#1a1a2e', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 20, maxHeight: '90%',
  },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: 'transparent', marginBottom: 12,
  },
  modalTitle: { fontSize: 20, fontWeight: 'bold', color: '#fff', marginBottom: 8 },
  detailDate: { fontSize: 16, color: '#fff', fontWeight: 'bold' },
  payInfo: { color: '#aaa', fontSize: 14, marginBottom: 8 },
  closeSummary: {
    backgroundColor: '#16213e', borderRadius: 12, padding: 14,
    marginTop: 8, borderWidth: 1, borderColor: '#0f3460',
  },
  closeRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    backgroundColor: 'transparent', marginBottom: 6,
  },
  closeLabel: { color: '#aaa', fontSize: 14 },
  closeVal: { color: '#fff', fontSize: 14 },
  diffPreview: {
    backgroundColor: '#16213e', borderRadius: 10, padding: 12,
    alignItems: 'center', marginTop: 8,
  },
  diffPreviewText: { fontSize: 16, fontWeight: 'bold' },
  label: { fontSize: 13, color: '#aaa', marginBottom: 4, marginTop: 12 },
  input: {
    backgroundColor: '#16213e', borderRadius: 10, padding: 12, color: '#fff',
    fontSize: 15, borderWidth: 1, borderColor: '#0f3460',
  },
  saveBtn: {
    backgroundColor: '#4CAF50', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 20,
  },
  saveBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  cancelBtn: { padding: 14, alignItems: 'center', marginTop: 8 },
  cancelBtnText: { color: '#aaa', fontSize: 15 },
});
