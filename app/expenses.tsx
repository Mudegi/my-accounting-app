import React, { useState, useCallback, useEffect } from 'react';
import {
  StyleSheet,
  TouchableOpacity,
  FlatList,
  TextInput,
  Alert,
  ActivityIndicator,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Text, View } from '@/components/Themed';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useFocusEffect, useRouter } from 'expo-router';
import { postExpenseEntry, PAYMENT_METHODS } from '@/lib/accounting';
import { loadCurrencies, convertCurrency, getCurrency, type Currency } from '@/lib/currency';

type Expense = {
  id: string;
  category: string;
  description: string | null;
  amount: number;
  base_total?: number;
  date: string;
  branch_name?: string;
};

const EXPENSE_CATEGORIES = [
  'Rent', 'Electricity', 'Water', 'Internet', 'Communication', 'Transport',
  'Salaries', 'Supplies', 'Maintenance', 'Marketing', 'Insurance', 'Bank Charges', 'Taxes', 'Other',
];

export default function ExpensesScreen() {
  const { business, currentBranch, branches, profile, fmt, currency } = useAuth();
  const router = useRouter();
  const isAdmin = profile?.role === 'admin';
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [category, setCategory] = useState('Rent');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [saving, setSaving] = useState(false);
  // Admin: filter by branch or show all
  const [filterBranchId, setFilterBranchId] = useState<string | null>(null);
  const [expPayMethod, setExpPayMethod] = useState('cash');

  // Multi-currency support
  const [expenseCurrency, setExpenseCurrency] = useState(business?.default_currency || 'UGX');
  const [exchangeRate, setExchangeRate] = useState(1);
  const [availableCurrencies, setAvailableCurrencies] = useState<Currency[]>([]);
  const [isConverting, setIsConverting] = useState(false);

  const totalThisMonth = expenses.reduce((sum, e) => sum + Number(e.amount), 0);

  const load = useCallback(async () => {
    if (!business || !currentBranch) return;
    const firstDay = new Date();
    firstDay.setDate(1);

    let query = supabase
      .from('expenses')
      .select('*, branches(name)')
      .gte('date', firstDay.toISOString().split('T')[0])
      .order('date', { ascending: false });

    if (isAdmin) {
      // Admin: show all branches or filter
      query = query.eq('business_id', business.id);
      if (filterBranchId) {
        query = query.eq('branch_id', filterBranchId);
      }
    } else {
      // Non-admin: own branch only
      query = query.eq('branch_id', currentBranch.id);
    }

    const { data } = await query;
    if (data) setExpenses(data.map((e: any) => ({
      ...e,
      branch_name: e.branches?.name || null,
    })));
  }, [business, currentBranch, isAdmin, filterBranchId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  useEffect(() => {
    loadCurrencies().then(setAvailableCurrencies);
  }, []);

  useEffect(() => {
    if (business?.default_currency) {
      setExpenseCurrency(business.default_currency);
    }
  }, [business?.default_currency]);

  useEffect(() => {
    const updateRate = async () => {
      if (!business) return;
      if (expenseCurrency === business.default_currency) {
        setExchangeRate(1);
        return;
      }
      setIsConverting(true);
      try {
        const { rate } = await convertCurrency(business.id, 1, business.default_currency, expenseCurrency);
        setExchangeRate(rate);
      } catch (e) {
        console.error('Rate update error:', e);
      } finally {
        setIsConverting(false);
      }
    };
    updateRate();
  }, [expenseCurrency, business?.default_currency]);

  const handleAdd = async () => {
    if (!amount || isNaN(Number(amount))) { Alert.alert('Error', 'Enter a valid amount'); return; }
    if (!business || !currentBranch || !profile) return;
    setSaving(true);
    const { data: inserted, error } = await supabase.from('expenses').insert({
      business_id: business.id,
      branch_id: currentBranch.id,
      recorded_by: profile.id,
      category,
      description: description.trim() || null,
      amount: parseFloat(amount),
      currency: expenseCurrency,
      exchange_rate: 1 / exchangeRate,
      base_total: Math.round(parseFloat(amount) / exchangeRate),
    }).select().single();
    if (error) Alert.alert('Error', error.message);
    else {
      // Auto-post accounting entry
      postExpenseEntry({
        businessId: business.id,
        branchId: currentBranch.id,
        expenseId: inserted.id,
        amount: parseFloat(amount),
        category,
        description: description.trim() || category,
        paymentMethod: expPayMethod,
        userId: profile.id,
        currencyCode: expenseCurrency,
        exchangeRate: 1 / exchangeRate, // rate back to base currency
      });
      setAmount(''); setDescription(''); setShowForm(false); setExpPayMethod('cash'); load();
    }
    setSaving(false);
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
    <View style={styles.container}>
      {/* Header with link to Reports */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, backgroundColor: 'transparent' }}>
        <Text style={{ color: '#fff', fontSize: 18, fontWeight: 'bold' }}>Expenses</Text>
        <TouchableOpacity 
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#0f3460', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12 }}
          onPress={() => router.push('/reports')}
        >
          <FontAwesome name="line-chart" size={14} color="#e94560" />
          <Text style={{ color: '#aaa', fontSize: 13, fontWeight: '600' }}>Reports</Text>
        </TouchableOpacity>
      </View>
      {/* Monthly Total */}
      <View style={styles.totalCard}>
        <Text style={styles.totalLabel}>
          {isAdmin
            ? filterBranchId
              ? `${branches.find(b => b.id === filterBranchId)?.name || 'Branch'} Expenses`
              : 'All Branches Expenses'
            : "This Month's Expenses"}
        </Text>
        <Text style={styles.totalValue}>{fmt(totalThisMonth)}</Text>
      </View>

      {/* Admin: Branch Filter */}
      {isAdmin && branches.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10, maxHeight: 40 }}>
          <View style={styles.filterRow}>
            <TouchableOpacity
              style={[styles.filterChip, !filterBranchId && styles.filterChipActive]}
              onPress={() => setFilterBranchId(null)}
            >
              <Text style={[styles.filterChipText, !filterBranchId && styles.filterChipTextActive]}>All</Text>
            </TouchableOpacity>
            {branches.map(b => (
              <TouchableOpacity
                key={b.id}
                style={[styles.filterChip, filterBranchId === b.id && styles.filterChipActive]}
                onPress={() => setFilterBranchId(b.id)}
              >
                <Text style={[styles.filterChipText, filterBranchId === b.id && styles.filterChipTextActive]}>{b.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
      )}

      {/* Add Form */}
      {showForm && (
        <View style={styles.formCard}>
          <Text style={styles.formTitle}>Record Expense</Text>
          <Text style={styles.label}>Category</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
            <View style={styles.chipRow}>
              {EXPENSE_CATEGORIES.map((cat) => (
                <TouchableOpacity
                  key={cat}
                  style={[styles.chip, category === cat && styles.chipActive]}
                  onPress={() => setCategory(cat)}
                >
                  <Text style={[styles.chipText, category === cat && styles.chipTextActive]}>{cat}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
          <TextInput style={styles.input} placeholder={`Amount (${getCurrency(expenseCurrency).symbol}) *`} placeholderTextColor="#555" value={amount} onChangeText={setAmount} keyboardType="numeric" />
          
          {/* Currency Selection */}
          <Text style={styles.label}>Expense Currency</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
            <View style={styles.chipRow}>
              {availableCurrencies.map((c) => (
                <TouchableOpacity
                  key={c.code}
                  style={[styles.chip, expenseCurrency === c.code && styles.chipActive]}
                  onPress={() => setExpenseCurrency(c.code)}
                >
                  <Text style={[styles.chipText, expenseCurrency === c.code && styles.chipTextActive]}>{c.code}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>

          {expenseCurrency !== business?.default_currency && (
            <View style={{ marginBottom: 12, padding: 10, backgroundColor: '#0f3460', borderRadius: 8 }}>
              <Text style={{ color: '#aaa', fontSize: 12 }}>Equivalent to:</Text>
              <Text style={{ color: '#4CAF50', fontSize: 16, fontWeight: 'bold' }}>
                {fmt(Math.round(parseFloat(amount || '0') / exchangeRate))}
              </Text>
              <Text style={{ color: '#666', fontSize: 10, marginTop: 2 }}>Rate: 1 {business?.default_currency} = {exchangeRate.toFixed(4)} {expenseCurrency}</Text>
            </View>
          )}

          <TextInput style={styles.input} placeholder="Description (optional)" placeholderTextColor="#555" value={description} onChangeText={setDescription} />

          {/* Payment Method */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, backgroundColor: 'transparent' }}>
            <Text style={[styles.label, { marginBottom: 0 }]}>Payment Method</Text>
            {expPayMethod === 'credit' && (
              <Text style={{ color: '#FF9800', fontSize: 11, fontWeight: 'bold' }}>Will record as Payable Debt</Text>
            )}
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
            <View style={styles.chipRow}>
              {PAYMENT_METHODS.map(pm => (
                <TouchableOpacity
                  key={pm.value}
                  style={[styles.chip, expPayMethod === pm.value && styles.chipActive]}
                  onPress={() => setExpPayMethod(pm.value)}
                >
                  <Text style={[styles.chipText, expPayMethod === pm.value && styles.chipTextActive]}>{pm.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>

          <Text style={styles.branchHint}>Recording for: {currentBranch?.name}</Text>
          <View style={styles.formButtons}>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowForm(false)}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.saveBtn} onPress={handleAdd} disabled={saving}>
              {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.saveText}>Save</Text>}
            </TouchableOpacity>
          </View>
        </View>
      )}

      {!showForm && (
        <TouchableOpacity style={styles.addButton} onPress={() => setShowForm(true)}>
          <FontAwesome name="plus" size={16} color="#fff" />
          <Text style={styles.addButtonText}>Record Expense</Text>
        </TouchableOpacity>
      )}

      <FlatList
        data={expenses}
        keyExtractor={(e) => e.id}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.cardLeft}>
              <Text style={styles.cardCategory}>{item.category}</Text>
              {item.description && <Text style={styles.cardDesc}>{item.description}</Text>}
              <Text style={styles.cardDate}>
                {item.date}
                {isAdmin && item.branch_name ? ` · ${item.branch_name}` : ''}
              </Text>
            </View>
            <Text style={styles.cardAmount}>{fmt(Number(item.base_total || item.amount))}</Text>
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <FontAwesome name="money" size={48} color="#333" />
            <Text style={styles.emptyText}>No expenses this month</Text>
          </View>
        }
      />
    </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e', padding: 16 },
  totalCard: { backgroundColor: '#16213e', borderRadius: 14, padding: 16, marginBottom: 14, alignItems: 'center' },
  totalLabel: { color: '#aaa', fontSize: 13 },
  totalValue: { color: '#e94560', fontSize: 26, fontWeight: 'bold', marginTop: 4 },
  filterRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 2 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 18, backgroundColor: '#16213e', borderWidth: 1, borderColor: '#0f3460' },
  filterChipActive: { backgroundColor: '#e94560', borderColor: '#e94560' },
  filterChipText: { color: '#aaa', fontSize: 13 },
  filterChipTextActive: { color: '#fff', fontWeight: 'bold' },
  formCard: { backgroundColor: '#16213e', borderRadius: 16, padding: 16, marginBottom: 14 },
  formTitle: { color: '#fff', fontSize: 18, fontWeight: 'bold', marginBottom: 12 },
  label: { color: '#aaa', fontSize: 13, marginBottom: 6 },
  chipRow: { flexDirection: 'row', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 18, backgroundColor: '#0f3460', borderWidth: 1, borderColor: '#0f3460' },
  chipActive: { backgroundColor: '#e94560', borderColor: '#e94560' },
  chipText: { color: '#aaa', fontSize: 13 },
  chipTextActive: { color: '#fff', fontWeight: 'bold' },
  input: { backgroundColor: '#0f3460', borderRadius: 10, padding: 14, color: '#fff', fontSize: 15, marginBottom: 10 },
  branchHint: { color: '#555', fontSize: 12, marginBottom: 10 },
  formButtons: { flexDirection: 'row', gap: 10 },
  cancelBtn: { flex: 1, padding: 14, borderRadius: 10, backgroundColor: '#333', alignItems: 'center' },
  cancelText: { color: '#aaa', fontWeight: 'bold' },
  saveBtn: { flex: 1, padding: 14, borderRadius: 10, backgroundColor: '#e94560', alignItems: 'center' },
  saveText: { color: '#fff', fontWeight: 'bold' },
  addButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#e94560', borderRadius: 12, padding: 14, marginBottom: 14, gap: 8 },
  addButtonText: { color: '#fff', fontWeight: 'bold', fontSize: 15 },
  card: { backgroundColor: '#16213e', borderRadius: 12, padding: 14, marginBottom: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardLeft: { backgroundColor: 'transparent', flex: 1 },
  cardCategory: { color: '#fff', fontSize: 15, fontWeight: 'bold' },
  cardDesc: { color: '#aaa', fontSize: 13, marginTop: 2 },
  cardDate: { color: '#555', fontSize: 12, marginTop: 4 },
  cardAmount: { color: '#e94560', fontSize: 16, fontWeight: 'bold' },
  empty: { alignItems: 'center', paddingTop: 40 },
  emptyText: { color: '#555', fontSize: 16, marginTop: 12 },
});
