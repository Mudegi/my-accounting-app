import React, { useState, useCallback } from 'react';
import {
  StyleSheet,
  TouchableOpacity,
  FlatList,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Text, View } from '@/components/Themed';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useFocusEffect, useRouter } from 'expo-router';

type PurchaseRow = {
  id: string;
  supplier_name: string | null;
  supplier_tin: string | null;
  total_amount: number;
  created_at: string;
  efris_submitted: boolean;
  seller_name: string;
  branch_name: string;
  item_count: number;
};

const PERIODS = [
  { label: 'Today', days: 0 },
  { label: '7 Days', days: 7 },
  { label: 'Month', days: 30 },
  { label: '3 Mo', days: 90 },
  { label: 'All', days: -1 },
] as const;

export default function PurchaseHistoryScreen() {
  const { business, profile, branches, fmt } = useAuth();
  const router = useRouter();
  const isAdmin = profile?.role === 'admin';

  const [purchases, setPurchases] = useState<PurchaseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<number>(7);
  const [branchFilter, setBranchFilter] = useState<string>('all');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    if (!business) return;
    setLoading(true);
    try {
      let query = supabase
        .from('purchases')
        .select(`
          id, supplier_name, supplier_tin, total_amount, created_at, efris_submitted,
          created_by, branch_id,
          purchase_items(id)
        `)
        .eq('business_id', business.id)
        .order('created_at', { ascending: false })
        .limit(200);

      // Date filter
      if (period >= 0) {
        const since = new Date();
        if (period === 0) {
          since.setHours(0, 0, 0, 0);
        } else {
          since.setDate(since.getDate() - period);
        }
        query = query.gte('created_at', since.toISOString());
      }

      // Branch filter
      if (branchFilter !== 'all') {
        query = query.eq('branch_id', branchFilter);
      }

      const { data, error } = await query;
      if (error) throw error;

      // Fetch creator and branch names separately (FK points to auth.users, not profiles)
      const creatorIds = [...new Set((data || []).map((p: any) => p.created_by).filter(Boolean))];
      const branchIds = [...new Set((data || []).map((p: any) => p.branch_id).filter(Boolean))];

      const creatorMap: Record<string, string> = {};
      const branchMap: Record<string, string> = {};

      if (creatorIds.length > 0) {
        const { data: creators } = await supabase
          .from('profiles')
          .select('id, full_name')
          .in('id', creatorIds);
        creators?.forEach((c: any) => { creatorMap[c.id] = c.full_name; });
      }

      if (branchIds.length > 0) {
        const { data: branchesData } = await supabase
          .from('branches')
          .select('id, name')
          .in('id', branchIds);
        branchesData?.forEach((b: any) => { branchMap[b.id] = b.name; });
      }

      const mapped: PurchaseRow[] = (data || []).map((p: any) => ({
        id: p.id,
        supplier_name: p.supplier_name || null,
        supplier_tin: p.supplier_tin || null,
        total_amount: Number(p.total_amount),
        created_at: p.created_at,
        efris_submitted: p.efris_submitted || false,
        seller_name: creatorMap[p.created_by] || '?',
        branch_name: branchMap[p.branch_id] || '?',
        item_count: p.purchase_items?.length || 0,
      }));

      setPurchases(mapped);
    } catch (e) {
      console.error('Error loading purchases:', e);
    } finally {
      setLoading(false);
    }
  }, [business, period, branchFilter]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const efrisEnabled = business?.is_efris_enabled ?? false;

  // Search filter
  const filtered = search.trim()
    ? purchases.filter(p => {
        const q = search.toLowerCase();
        return (
          (p.supplier_name || '').toLowerCase().includes(q) ||
          (p.supplier_tin || '').toLowerCase().includes(q) ||
          p.seller_name.toLowerCase().includes(q) ||
          p.id.toLowerCase().includes(q)
        );
      })
    : purchases;

  // Summary
  const totalSpent = filtered.reduce((s, p) => s + p.total_amount, 0);

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const formatTime = (d: string) =>
    new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
    <View style={styles.container}>
      {/* Period Pills */}
      <View style={styles.pills}>
        {PERIODS.map((p) => (
          <TouchableOpacity
            key={p.label}
            style={[styles.pill, period === p.days && styles.pillActive]}
            onPress={() => setPeriod(p.days)}
          >
            <Text style={[styles.pillText, period === p.days && styles.pillTextActive]}>{p.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Branch filter (admin only) */}
      {isAdmin && branches.length > 1 && (
        <View style={styles.pills}>
          <TouchableOpacity
            style={[styles.pill, branchFilter === 'all' && styles.pillActive]}
            onPress={() => setBranchFilter('all')}
          >
            <Text style={[styles.pillText, branchFilter === 'all' && styles.pillTextActive]}>All Branches</Text>
          </TouchableOpacity>
          {branches.map((b) => (
            <TouchableOpacity
              key={b.id}
              style={[styles.pill, branchFilter === b.id && styles.pillActive]}
              onPress={() => setBranchFilter(b.id)}
            >
              <Text style={[styles.pillText, branchFilter === b.id && styles.pillTextActive]}>{b.name}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Search */}
      <TextInput
        style={styles.searchInput}
        placeholder="Search supplier, staff, ID..."
        placeholderTextColor="#555"
        value={search}
        onChangeText={setSearch}
      />

      {/* Summary */}
      <View style={styles.summaryRow}>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Total Spent</Text>
          <Text style={styles.summaryValue}>{fmt(totalSpent)}</Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Purchases</Text>
          <Text style={styles.summaryValue}>{filtered.length}</Text>
        </View>
      </View>

      {loading ? (
        <ActivityIndicator color="#e94560" size="large" style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(p) => p.id}
          contentContainerStyle={{ paddingBottom: 32 }}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.card}
              onPress={() => router.push({ pathname: '/purchase-detail', params: { purchaseId: item.id } } as any)}
            >
              <View style={styles.cardTop}>
                <View style={{ flex: 1, backgroundColor: 'transparent' }}>
                  <Text style={styles.cardSupplier}>{item.supplier_name || 'Unknown Supplier'}</Text>
                  <Text style={styles.cardDate}>
                    {formatDate(item.created_at)} · {formatTime(item.created_at)}
                  </Text>
                </View>
                <Text style={styles.cardAmount}>{fmt(item.total_amount)}</Text>
              </View>
              <View style={styles.cardBottom}>
                <Text style={styles.cardMeta}>
                  {item.item_count} item{item.item_count !== 1 ? 's' : ''} · By {item.seller_name}
                </Text>
                {isAdmin && <Text style={styles.cardBranch}>📍 {item.branch_name}</Text>}
                {efrisEnabled && (
                  <View style={[styles.efrisBadge, item.efris_submitted ? styles.efrisOk : styles.efrisWarn]}>
                    <Text style={styles.efrisBadgeText}>{item.efris_submitted ? '✅ EFRIS' : '⚠️ Not submitted'}</Text>
                  </View>
                )}
              </View>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <FontAwesome name="shopping-basket" size={48} color="#333" />
              <Text style={styles.emptyText}>No purchases found</Text>
            </View>
          }
        />
      )}
    </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e', padding: 16 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12, backgroundColor: 'transparent' },
  pill: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 18, backgroundColor: '#16213e' },
  pillActive: { backgroundColor: '#e94560' },
  pillText: { color: '#aaa', fontSize: 13 },
  pillTextActive: { color: '#fff', fontWeight: 'bold' },
  searchInput: { backgroundColor: '#16213e', borderRadius: 10, padding: 12, color: '#fff', fontSize: 14, marginBottom: 12 },
  summaryRow: { flexDirection: 'row', gap: 12, marginBottom: 14, backgroundColor: 'transparent' },
  summaryCard: { flex: 1, backgroundColor: '#16213e', borderRadius: 12, padding: 14, alignItems: 'center' },
  summaryLabel: { color: '#aaa', fontSize: 12, marginBottom: 4 },
  summaryValue: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  card: { backgroundColor: '#16213e', borderRadius: 14, padding: 14, marginBottom: 10 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', backgroundColor: 'transparent' },
  cardSupplier: { color: '#fff', fontSize: 15, fontWeight: 'bold' },
  cardDate: { color: '#888', fontSize: 12, marginTop: 2 },
  cardAmount: { color: '#e94560', fontSize: 16, fontWeight: 'bold' },
  cardBottom: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 8, backgroundColor: 'transparent' },
  cardMeta: { color: '#777', fontSize: 12 },
  cardBranch: { color: '#777', fontSize: 12 },
  efrisBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  efrisOk: { backgroundColor: '#4CAF5020' },
  efrisWarn: { backgroundColor: '#FF980020' },
  efrisBadgeText: { fontSize: 11, color: '#ccc' },
  empty: { alignItems: 'center', paddingTop: 40 },
  emptyText: { color: '#555', fontSize: 16, marginTop: 12 },
});
