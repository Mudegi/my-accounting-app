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
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Text, View } from '@/components/Themed';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useFocusEffect, useRouter } from 'expo-router';
import { postSaleEntry, PAYMENT_METHODS, ACC, PAYMENT_ACCOUNT_MAP } from '@/lib/accounting';

type DebtCustomer = {
  id: string;
  name: string;
  phone: string | null;
  totalDebt: number;
  totalPaid: number;
  balance: number;
  salesCount: number;
};

type CreditSale = {
  id: string;
  total_amount: number;
  created_at: string;
  paid: number;
  balance: number;
  status: string;
};

type DebtPayment = {
  id: string;
  amount: number;
  payment_method: string;
  note: string | null;
  created_at: string;
};

export default function DebtsScreen() {
  const { business, currentBranch, profile, fmt } = useAuth();
  const router = useRouter();
  const isAdmin = profile?.role === 'admin';

  const [customers, setCustomers] = useState<DebtCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Detail modal state
  const [selectedCustomer, setSelectedCustomer] = useState<DebtCustomer | null>(null);
  const [creditSales, setCreditSales] = useState<CreditSale[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Payment modal state
  const [showPayment, setShowPayment] = useState(false);
  const [payingSale, setPayingSale] = useState<CreditSale | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState('cash');
  const [payNote, setPayNote] = useState('');
  const [saving, setSaving] = useState(false);

  // Payment history modal
  const [showHistory, setShowHistory] = useState(false);
  const [historyPayments, setHistoryPayments] = useState<DebtPayment[]>([]);
  const [historySaleId, setHistorySaleId] = useState<string>('');

  const loadDebts = useCallback(async () => {
    if (!business) return;

    try {
      // Get all credit sales with customer info
      let query = supabase
        .from('sales')
        .select('id, total_amount, customer_id, created_at, status')
        .eq('business_id', business.id)
        .eq('payment_method', 'credit')
        .eq('status', 'completed')
        .not('customer_id', 'is', null);

      if (!isAdmin && currentBranch) {
        query = query.eq('branch_id', currentBranch.id);
      }

      const { data: creditSalesData } = await query;

      if (!creditSalesData || creditSalesData.length === 0) {
        setCustomers([]);
        setLoading(false);
        return;
      }

      // Get all debt payments
      const saleIds = creditSalesData.map(s => s.id);
      const { data: paymentsData } = await supabase
        .from('debt_payments')
        .select('sale_id, amount')
        .in('sale_id', saleIds);

      // Get customer details
      const customerIds = [...new Set(creditSalesData.map(s => s.customer_id!))];
      const { data: customersData } = await supabase
        .from('customers')
        .select('id, name, phone')
        .in('id', customerIds);

      const customerMap: Record<string, { name: string; phone: string | null }> = {};
      customersData?.forEach(c => { customerMap[c.id] = { name: c.name, phone: c.phone }; });

      // Aggregate payments per sale
      const paymentsBySale: Record<string, number> = {};
      paymentsData?.forEach(p => {
        paymentsBySale[p.sale_id] = (paymentsBySale[p.sale_id] || 0) + Number(p.amount);
      });

      // Aggregate per customer
      const custMap: Record<string, DebtCustomer> = {};
      creditSalesData.forEach(sale => {
        const custId = sale.customer_id!;
        if (!custMap[custId]) {
          const info = customerMap[custId] || { name: 'Unknown', phone: null };
          custMap[custId] = {
            id: custId,
            name: info.name,
            phone: info.phone,
            totalDebt: 0,
            totalPaid: 0,
            balance: 0,
            salesCount: 0,
          };
        }
        const paid = paymentsBySale[sale.id] || 0;
        custMap[custId].totalDebt += Number(sale.total_amount);
        custMap[custId].totalPaid += paid;
        custMap[custId].salesCount += 1;
      });

      // Compute balances
      Object.values(custMap).forEach(c => {
        c.balance = c.totalDebt - c.totalPaid;
      });

      // Sort by balance descending (most owing first), filter out fully paid
      const sorted = Object.values(custMap)
        .filter(c => c.balance > 0)
        .sort((a, b) => b.balance - a.balance);

      setCustomers(sorted);
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setLoading(false);
    }
  }, [business, currentBranch, isAdmin]);

  useFocusEffect(useCallback(() => { loadDebts(); }, [loadDebts]));

  const onRefresh = async () => {
    setRefreshing(true);
    await loadDebts();
    setRefreshing(false);
  };

  // Open customer detail
  const openCustomerDetail = async (customer: DebtCustomer) => {
    setSelectedCustomer(customer);
    setLoadingDetail(true);

    try {
      let query = supabase
        .from('sales')
        .select('id, total_amount, created_at, status')
        .eq('business_id', business!.id)
        .eq('payment_method', 'credit')
        .eq('status', 'completed')
        .eq('customer_id', customer.id)
        .order('created_at', { ascending: false });

      if (!isAdmin && currentBranch) {
        query = query.eq('branch_id', currentBranch.id);
      }

      const { data: sales } = await query;

      if (sales) {
        const saleIds = sales.map(s => s.id);
        const { data: payments } = await supabase
          .from('debt_payments')
          .select('sale_id, amount')
          .in('sale_id', saleIds);

        const paymentsBySale: Record<string, number> = {};
        payments?.forEach(p => {
          paymentsBySale[p.sale_id] = (paymentsBySale[p.sale_id] || 0) + Number(p.amount);
        });

        const enriched: CreditSale[] = sales.map(s => {
          const paid = paymentsBySale[s.id] || 0;
          return {
            id: s.id,
            total_amount: Number(s.total_amount),
            created_at: s.created_at,
            paid,
            balance: Number(s.total_amount) - paid,
            status: s.status,
          };
        });

        setCreditSales(enriched);
      }
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setLoadingDetail(false);
    }
  };

  // Record a payment
  const openPaymentModal = (sale: CreditSale) => {
    setPayingSale(sale);
    setPayAmount(sale.balance.toString());
    setPayMethod('cash');
    setPayNote('');
    setShowPayment(true);
  };

  const handleRecordPayment = async () => {
    if (!payingSale || !business || !profile) return;
    const amount = parseFloat(payAmount);
    if (!amount || amount <= 0) {
      Alert.alert('Error', 'Enter a valid payment amount');
      return;
    }
    if (amount > payingSale.balance) {
      Alert.alert('Error', `Amount exceeds outstanding balance of ${fmt(payingSale.balance)}`);
      return;
    }

    setSaving(true);
    try {
      // Insert debt payment record
      const { error } = await supabase
        .from('debt_payments')
        .insert({
          business_id: business.id,
          sale_id: payingSale.id,
          customer_id: selectedCustomer!.id,
          amount,
          payment_method: payMethod,
          note: payNote.trim() || null,
          received_by: profile.id,
        });

      if (error) throw error;

      // Post accounting entry: DR Cash/MoMo/Bank, CR Accounts Receivable
      const payAcct = PAYMENT_ACCOUNT_MAP[payMethod] || ACC.CASH;
      // We use a manual journal entry approach
      const { data: accounts } = await supabase
        .from('accounts')
        .select('id, code')
        .eq('business_id', business.id)
        .in('code', [payAcct, ACC.ACCOUNTS_RECEIVABLE]);

      if (accounts && accounts.length === 2) {
        const accMap: Record<string, string> = {};
        accounts.forEach((a: any) => { accMap[a.code] = a.id; });

        const { data: entry } = await supabase
          .from('journal_entries')
          .insert({
            business_id: business.id,
            branch_id: currentBranch?.id || null,
            reference_type: 'debt_payment',
            reference_id: payingSale.id,
            description: `Debt payment from ${selectedCustomer!.name}`,
            is_auto: true,
            created_by: profile.id,
          })
          .select()
          .single();

        if (entry) {
          await supabase.from('journal_entry_lines').insert([
            {
              journal_entry_id: entry.id,
              account_id: accMap[payAcct],
              debit: amount,
              credit: 0,
              description: `Payment received (${payMethod})`,
            },
            {
              journal_entry_id: entry.id,
              account_id: accMap[ACC.ACCOUNTS_RECEIVABLE],
              debit: 0,
              credit: amount,
              description: `Receivable cleared - ${selectedCustomer!.name}`,
            },
          ]);
        }
      }

      Alert.alert('Success', `Payment of ${fmt(amount)} recorded`);
      setShowPayment(false);

      // Refresh
      if (selectedCustomer) {
        await openCustomerDetail(selectedCustomer);
      }
      await loadDebts();
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setSaving(false);
    }
  };

  // View payment history for a sale
  const viewPaymentHistory = async (saleId: string) => {
    setHistorySaleId(saleId);
    const { data } = await supabase
      .from('debt_payments')
      .select('id, amount, payment_method, note, created_at')
      .eq('sale_id', saleId)
      .order('created_at', { ascending: false });

    setHistoryPayments(data || []);
    setShowHistory(true);
  };

  const totalOutstanding = customers.reduce((sum, c) => sum + c.balance, 0);

  const filtered = searchQuery.trim()
    ? customers.filter(c =>
        c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (c.phone && c.phone.includes(searchQuery))
      )
    : customers;

  const formatDate = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const formatTime = (d: string) => new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

  const payMethodLabel = (m: string) => {
    const found = PAYMENT_METHODS.find(p => p.value === m);
    return found ? found.label : m;
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#e94560" style={{ marginTop: 60 }} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Summary Card */}
      <View style={styles.summaryCard}>
        <View style={styles.summaryRow}>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryValue}>{fmt(totalOutstanding)}</Text>
            <Text style={styles.summaryLabel}>Total Outstanding</Text>
          </View>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryValue}>{customers.length}</Text>
            <Text style={styles.summaryLabel}>Debtors</Text>
          </View>
        </View>
      </View>

      {/* Search */}
      <View style={styles.searchRow}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search debtors..."
          placeholderTextColor="#666"
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
      </View>

      {/* Debtor List */}
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#e94560" />}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.card} onPress={() => openCustomerDetail(item)}>
            <View style={styles.cardHeader}>
              <View style={styles.cardInfo}>
                <Text style={styles.cardName}>{item.name}</Text>
                {item.phone ? <Text style={styles.cardSub}>📱 {item.phone}</Text> : null}
                <Text style={styles.cardSub}>
                  {item.salesCount} credit sale{item.salesCount !== 1 ? 's' : ''}
                </Text>
              </View>
              <View style={styles.cardRight}>
                <Text style={styles.debtAmount}>{fmt(item.balance)}</Text>
                <Text style={styles.debtLabel}>owes</Text>
              </View>
            </View>
            {item.totalPaid > 0 && (
              <View style={styles.progressBar}>
                <View style={[styles.progressFill, { width: `${Math.min(100, (item.totalPaid / item.totalDebt) * 100)}%` }]} />
              </View>
            )}
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <FontAwesome name="check-circle" size={48} color="#4CAF50" />
            <Text style={styles.emptyText}>No outstanding debts!</Text>
            <Text style={styles.emptyHint}>Credit sales will appear here</Text>
          </View>
        }
      />

      {/* Customer Detail Modal */}
      <Modal visible={!!selectedCustomer} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{selectedCustomer?.name}</Text>
              <TouchableOpacity onPress={() => { setSelectedCustomer(null); setCreditSales([]); }}>
                <FontAwesome name="times" size={22} color="#aaa" />
              </TouchableOpacity>
            </View>

            {selectedCustomer && (
              <View style={styles.detailSummary}>
                <View style={styles.detailSummaryItem}>
                  <Text style={styles.detailSummaryVal}>{fmt(selectedCustomer.totalDebt)}</Text>
                  <Text style={styles.detailSummaryLabel}>Total Debt</Text>
                </View>
                <View style={styles.detailSummaryItem}>
                  <Text style={[styles.detailSummaryVal, { color: '#4CAF50' }]}>{fmt(selectedCustomer.totalPaid)}</Text>
                  <Text style={styles.detailSummaryLabel}>Total Paid</Text>
                </View>
                <View style={styles.detailSummaryItem}>
                  <Text style={[styles.detailSummaryVal, { color: '#e94560' }]}>{fmt(selectedCustomer.balance)}</Text>
                  <Text style={styles.detailSummaryLabel}>Balance</Text>
                </View>
              </View>
            )}

            {loadingDetail ? (
              <ActivityIndicator size="large" color="#e94560" style={{ marginTop: 20 }} />
            ) : (
              <FlatList
                data={creditSales}
                keyExtractor={(item) => item.id}
                style={{ maxHeight: 400 }}
                renderItem={({ item }) => (
                  <View style={styles.saleCard}>
                    <View style={styles.saleCardHeader}>
                      <View style={{ backgroundColor: 'transparent', flex: 1 }}>
                        <Text style={styles.saleCardDate}>{formatDate(item.created_at)}</Text>
                        <Text style={styles.saleCardAmount}>Sale: {fmt(item.total_amount)}</Text>
                        <Text style={[styles.saleCardPaid, { color: item.balance > 0 ? '#e94560' : '#4CAF50' }]}>
                          Paid: {fmt(item.paid)} · Balance: {fmt(item.balance)}
                        </Text>
                      </View>
                      <View style={{ backgroundColor: 'transparent', gap: 6 }}>
                        {item.balance > 0 && (
                          <TouchableOpacity style={styles.payBtn} onPress={() => openPaymentModal(item)}>
                            <FontAwesome name="money" size={14} color="#fff" />
                            <Text style={styles.payBtnText}>Pay</Text>
                          </TouchableOpacity>
                        )}
                        <TouchableOpacity style={styles.historyBtn} onPress={() => viewPaymentHistory(item.id)}>
                          <FontAwesome name="history" size={12} color="#aaa" />
                        </TouchableOpacity>
                      </View>
                    </View>
                    {item.paid > 0 && (
                      <View style={styles.progressBar}>
                        <View style={[styles.progressFill, { width: `${Math.min(100, (item.paid / item.total_amount) * 100)}%` }]} />
                      </View>
                    )}
                  </View>
                )}
                ListEmptyComponent={
                  <Text style={{ color: '#666', textAlign: 'center', marginTop: 20 }}>No credit sales found</Text>
                }
              />
            )}
          </View>
        </View>
      </Modal>

      {/* Record Payment Modal */}
      <Modal visible={showPayment} animationType="slide" transparent>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <ScrollView>
              <Text style={styles.modalTitle}>Record Payment</Text>
              {payingSale && (
                <Text style={styles.payInfo}>
                  Sale balance: {fmt(payingSale.balance)}
                </Text>
              )}

              <Text style={styles.label}>Amount *</Text>
              <TextInput
                style={styles.input}
                placeholder="Payment amount"
                placeholderTextColor="#555"
                value={payAmount}
                onChangeText={setPayAmount}
                keyboardType="numeric"
              />

              <Text style={styles.label}>Payment Method</Text>
              <View style={styles.chipRow}>
                {PAYMENT_METHODS.filter(m => m.value !== 'credit').map((m) => (
                  <TouchableOpacity
                    key={m.value}
                    style={[styles.chip, payMethod === m.value && styles.chipActive]}
                    onPress={() => setPayMethod(m.value)}
                  >
                    <Text style={[styles.chipText, payMethod === m.value && { color: '#fff' }]}>
                      {m.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.label}>Note (optional)</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. Partial payment"
                placeholderTextColor="#555"
                value={payNote}
                onChangeText={setPayNote}
              />

              <TouchableOpacity
                style={[styles.saveBtn, saving && { opacity: 0.6 }]}
                onPress={handleRecordPayment}
                disabled={saving}
              >
                {saving ? <ActivityIndicator color="#fff" /> : (
                  <Text style={styles.saveBtnText}>Record Payment</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowPayment(false)}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Payment History Modal */}
      <Modal visible={showHistory} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Payment History</Text>
              <TouchableOpacity onPress={() => setShowHistory(false)}>
                <FontAwesome name="times" size={22} color="#aaa" />
              </TouchableOpacity>
            </View>

            <FlatList
              data={historyPayments}
              keyExtractor={(item) => item.id}
              style={{ maxHeight: 400 }}
              renderItem={({ item }) => (
                <View style={styles.historyCard}>
                  <View style={{ backgroundColor: 'transparent', flex: 1 }}>
                    <Text style={{ color: '#4CAF50', fontSize: 16, fontWeight: 'bold' }}>{fmt(Number(item.amount))}</Text>
                    <Text style={{ color: '#aaa', fontSize: 12, marginTop: 2 }}>
                      {payMethodLabel(item.payment_method)} · {formatTime(item.created_at)}
                    </Text>
                    {item.note ? <Text style={{ color: '#888', fontSize: 12, marginTop: 2 }}>{item.note}</Text> : null}
                  </View>
                </View>
              )}
              ListEmptyComponent={
                <Text style={{ color: '#666', textAlign: 'center', marginTop: 20 }}>No payments recorded yet</Text>
              }
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  summaryCard: {
    backgroundColor: '#16213e', margin: 16, borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: '#0f3460',
  },
  summaryRow: {
    flexDirection: 'row', justifyContent: 'space-around', backgroundColor: 'transparent',
  },
  summaryItem: { alignItems: 'center', backgroundColor: 'transparent' },
  summaryValue: { fontSize: 22, fontWeight: 'bold', color: '#e94560' },
  summaryLabel: { fontSize: 12, color: '#aaa', marginTop: 4 },
  searchRow: {
    paddingHorizontal: 16, paddingBottom: 8, backgroundColor: 'transparent',
  },
  searchInput: {
    backgroundColor: '#16213e', borderRadius: 10, padding: 12,
    color: '#fff', fontSize: 15, borderWidth: 1, borderColor: '#0f3460',
  },
  card: {
    backgroundColor: '#16213e', marginHorizontal: 16, marginBottom: 10,
    borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#0f3460',
  },
  cardHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: 'transparent',
  },
  cardInfo: { flex: 1, backgroundColor: 'transparent' },
  cardRight: { alignItems: 'flex-end', backgroundColor: 'transparent' },
  cardName: { fontSize: 16, fontWeight: 'bold', color: '#fff' },
  cardSub: { fontSize: 13, color: '#aaa', marginTop: 2 },
  debtAmount: { fontSize: 18, fontWeight: 'bold', color: '#e94560' },
  debtLabel: { fontSize: 12, color: '#aaa' },
  progressBar: {
    height: 4, backgroundColor: '#0f3460', borderRadius: 2, marginTop: 10, overflow: 'hidden',
  },
  progressFill: {
    height: '100%', backgroundColor: '#4CAF50', borderRadius: 2,
  },
  emptyState: { alignItems: 'center', paddingTop: 60, backgroundColor: 'transparent' },
  emptyText: { color: '#4CAF50', fontSize: 18, marginTop: 12, fontWeight: 'bold' },
  emptyHint: { color: '#666', fontSize: 13, marginTop: 4 },
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
    backgroundColor: '#16213e', borderRadius: 12, padding: 12, marginBottom: 12,
  },
  detailSummaryItem: { alignItems: 'center', backgroundColor: 'transparent' },
  detailSummaryVal: { fontSize: 16, fontWeight: 'bold', color: '#fff' },
  detailSummaryLabel: { fontSize: 11, color: '#aaa', marginTop: 2 },
  saleCard: {
    backgroundColor: '#16213e', borderRadius: 10, padding: 12, marginBottom: 8,
    borderWidth: 1, borderColor: '#0f3460',
  },
  saleCardHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: 'transparent',
  },
  saleCardDate: { fontSize: 12, color: '#aaa' },
  saleCardAmount: { fontSize: 15, fontWeight: 'bold', color: '#fff', marginTop: 2 },
  saleCardPaid: { fontSize: 13, marginTop: 2 },
  payBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#4CAF50', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6,
  },
  payBtnText: { color: '#fff', fontSize: 13, fontWeight: 'bold' },
  historyBtn: {
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#0f3460', borderRadius: 8, padding: 6,
  },
  historyCard: {
    backgroundColor: '#16213e', borderRadius: 10, padding: 12, marginBottom: 8,
    borderWidth: 1, borderColor: '#0f3460',
  },
  payInfo: { color: '#aaa', fontSize: 14, marginBottom: 12 },
  label: { fontSize: 13, color: '#aaa', marginBottom: 4, marginTop: 10 },
  input: {
    backgroundColor: '#16213e', borderRadius: 10, padding: 12, color: '#fff',
    fontSize: 15, borderWidth: 1, borderColor: '#0f3460',
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4, backgroundColor: 'transparent' },
  chip: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8,
    backgroundColor: '#16213e', borderWidth: 1, borderColor: '#0f3460',
  },
  chipActive: { backgroundColor: '#e94560', borderColor: '#e94560' },
  chipText: { fontSize: 13, color: '#aaa' },
  saveBtn: {
    backgroundColor: '#4CAF50', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 20,
  },
  saveBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  cancelBtn: { padding: 14, alignItems: 'center', marginTop: 8 },
  cancelBtnText: { color: '#aaa', fontSize: 15 },
});
