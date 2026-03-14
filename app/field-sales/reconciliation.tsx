import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { Text, View } from '@/components/Themed';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { getReconciliation, type ReconciliationRow } from '@/lib/field-sales';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useFocusEffect, Redirect } from 'expo-router';

type UserOption = { id: string; full_name: string };

export default function ReconciliationScreen() {
  const { business, profile, fmt } = useAuth();
  const isAdmin = profile?.role === 'admin' || profile?.role === 'branch_manager';

  if (profile && !isAdmin) return <Redirect href="/" />;

  const [users, setUsers] = useState<UserOption[]>([]);
  const [selectedUser, setSelectedUser] = useState('');
  const [rows, setRows] = useState<ReconciliationRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [period, setPeriod] = useState<'week' | 'month' | '3months' | 'all'>('month');

  // Load users
  useEffect(() => {
    if (!business) return;
    (async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name')
        .eq('business_id', business.id)
        .eq('is_active', true)
        .order('full_name');
      const allUsers = (data || []).map((u: any) => ({ id: u.id, full_name: u.full_name }));
      setUsers(allUsers);
      if (allUsers.length > 0) setSelectedUser(allUsers[0].id);
    })();
  }, [business]);

  const getDateFrom = (p: string): string | undefined => {
    const now = new Date();
    switch (p) {
      case 'week': { const d = new Date(now); d.setDate(d.getDate() - 7); return d.toISOString(); }
      case 'month': { const d = new Date(now); d.setDate(1); return d.toISOString().split('T')[0] + 'T00:00:00'; }
      case '3months': { const d = new Date(now); d.setMonth(d.getMonth() - 3); return d.toISOString(); }
      case 'all': return undefined;
    }
  };

  const loadData = useCallback(async () => {
    if (!business || !selectedUser) return;
    setLoading(true);
    const data = await getReconciliation({
      businessId: business.id,
      userId: selectedUser,
      dateFrom: getDateFrom(period),
    });
    setRows(data);
    setLoading(false);
  }, [business, selectedUser, period]);

  useEffect(() => { loadData(); }, [loadData]);

  const totalAssigned = rows.reduce((s, r) => s + r.qty_assigned, 0);
  const totalSold = rows.reduce((s, r) => s + r.qty_sold_approved, 0);
  const totalPending = rows.reduce((s, r) => s + r.qty_sold_pending, 0);
  const totalReturned = rows.reduce((s, r) => s + r.qty_returned, 0);
  const totalDiscrepancy = rows.reduce((s, r) => s + r.discrepancy, 0);

  const periodLabels: Record<string, string> = {
    week: '7 Days', month: 'Month', '3months': '3 Mo', all: 'All',
  };

  const selectedUserName = users.find(u => u.id === selectedUser)?.full_name || '?';

  return (
    <View style={styles.container}>
      {/* User Selector */}
      <Text style={styles.sectionLabel}>Select User</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12, maxHeight: 38 }}>
        {users.map(u => (
          <TouchableOpacity
            key={u.id}
            style={[styles.userChip, selectedUser === u.id && styles.userChipActive]}
            onPress={() => setSelectedUser(u.id)}
          >
            <Text style={[styles.userChipText, selectedUser === u.id && styles.userChipTextActive]}>
              {u.full_name}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Period Filter */}
      <View style={styles.periodRow}>
        {(['week', 'month', '3months', 'all'] as const).map(p => (
          <TouchableOpacity
            key={p}
            style={[styles.periodBtn, period === p && styles.periodBtnActive]}
            onPress={() => setPeriod(p)}
          >
            <Text style={[styles.periodText, period === p && styles.periodTextActive]}>
              {periodLabels[p]}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Summary Cards */}
      <View style={styles.summaryGrid}>
        <View style={[styles.summaryCard, { backgroundColor: '#0f3460' }]}>
          <Text style={styles.summaryValue}>{totalAssigned}</Text>
          <Text style={styles.summaryLabel}>Assigned</Text>
        </View>
        <View style={[styles.summaryCard, { backgroundColor: '#2d6a4f' }]}>
          <Text style={styles.summaryValue}>{totalSold}</Text>
          <Text style={styles.summaryLabel}>Sold ✓</Text>
        </View>
        <View style={[styles.summaryCard, { backgroundColor: '#533483' }]}>
          <Text style={styles.summaryValue}>{totalPending}</Text>
          <Text style={styles.summaryLabel}>Pending</Text>
        </View>
        <View style={[styles.summaryCard, { backgroundColor: '#16213e' }]}>
          <Text style={styles.summaryValue}>{totalReturned}</Text>
          <Text style={styles.summaryLabel}>Returned</Text>
        </View>
      </View>

      {/* Discrepancy Banner */}
      {totalDiscrepancy !== 0 && (
        <View style={[styles.discrepancyBanner, { borderColor: totalDiscrepancy > 0 ? '#FF9800' : '#e94560' }]}>
          <FontAwesome name="exclamation-triangle" size={16} color={totalDiscrepancy > 0 ? '#FF9800' : '#e94560'} />
          <Text style={{ color: totalDiscrepancy > 0 ? '#FF9800' : '#e94560', fontSize: 13, fontWeight: 'bold', marginLeft: 8 }}>
            {totalDiscrepancy > 0
              ? `${totalDiscrepancy} unaccounted items (not sold, not returned)`
              : `${Math.abs(totalDiscrepancy)} items over-reported`
            }
          </Text>
        </View>
      )}
      {totalDiscrepancy === 0 && rows.length > 0 && (
        <View style={[styles.discrepancyBanner, { borderColor: '#4CAF50', backgroundColor: '#4CAF5010' }]}>
          <FontAwesome name="check-circle" size={16} color="#4CAF50" />
          <Text style={{ color: '#4CAF50', fontSize: 13, fontWeight: 'bold', marginLeft: 8 }}>
            All stock accounted for ✓
          </Text>
        </View>
      )}

      {/* Product Breakdown */}
      <Text style={[styles.sectionLabel, { marginTop: 8 }]}>Product Breakdown — {selectedUserName}</Text>

      {loading ? (
        <ActivityIndicator color="#e94560" style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={r => r.product_id}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardProduct}>{item.product_name}</Text>
                {item.discrepancy !== 0 && (
                  <View style={[styles.discBadge, { backgroundColor: item.discrepancy > 0 ? '#FF980022' : '#e9456022', borderColor: item.discrepancy > 0 ? '#FF9800' : '#e94560' }]}>
                    <Text style={{ color: item.discrepancy > 0 ? '#FF9800' : '#e94560', fontSize: 11, fontWeight: 'bold' }}>
                      {item.discrepancy > 0 ? `+${item.discrepancy}` : item.discrepancy} gap
                    </Text>
                  </View>
                )}
              </View>

              <View style={styles.breakdownRow}>
                <View style={styles.breakdownCol}>
                  <Text style={styles.breakdownLabel}>Assigned</Text>
                  <Text style={styles.breakdownValue}>{item.qty_assigned}</Text>
                </View>
                <View style={styles.breakdownCol}>
                  <Text style={styles.breakdownLabel}>Sold ✓</Text>
                  <Text style={[styles.breakdownValue, { color: '#4CAF50' }]}>{item.qty_sold_approved}</Text>
                </View>
                <View style={styles.breakdownCol}>
                  <Text style={styles.breakdownLabel}>Pending</Text>
                  <Text style={[styles.breakdownValue, { color: '#FF9800' }]}>{item.qty_sold_pending}</Text>
                </View>
                <View style={styles.breakdownCol}>
                  <Text style={styles.breakdownLabel}>Returned</Text>
                  <Text style={[styles.breakdownValue, { color: '#2196F3' }]}>{item.qty_returned}</Text>
                </View>
              </View>
            </View>
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <FontAwesome name="pie-chart" size={48} color="#333" />
              <Text style={styles.emptyText}>No data for this period</Text>
              <Text style={styles.emptyHint}>Select a different user or date range</Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e', padding: 16 },
  sectionLabel: { color: '#888', fontSize: 12, fontWeight: 'bold', letterSpacing: 1, marginBottom: 8 },
  userChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, backgroundColor: '#16213e', borderWidth: 1, borderColor: '#0f3460', marginRight: 8 },
  userChipActive: { backgroundColor: '#e94560', borderColor: '#e94560' },
  userChipText: { color: '#aaa', fontSize: 13, fontWeight: '600' },
  userChipTextActive: { color: '#fff' },
  periodRow: { flexDirection: 'row', gap: 6, marginBottom: 14, backgroundColor: 'transparent' },
  periodBtn: { flex: 1, paddingVertical: 8, borderRadius: 10, backgroundColor: '#16213e', alignItems: 'center', borderWidth: 1, borderColor: '#0f3460' },
  periodBtnActive: { backgroundColor: '#533483', borderColor: '#533483' },
  periodText: { color: '#aaa', fontWeight: 'bold', fontSize: 12 },
  periodTextActive: { color: '#fff' },
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12, backgroundColor: 'transparent' },
  summaryCard: { flex: 1, minWidth: '22%', borderRadius: 12, padding: 12, alignItems: 'center' },
  summaryValue: { color: '#fff', fontSize: 20, fontWeight: 'bold' },
  summaryLabel: { color: '#ccc', fontSize: 10, marginTop: 4 },
  discrepancyBanner: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FF980010', borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 12 },
  card: { backgroundColor: '#16213e', borderRadius: 14, padding: 14, marginBottom: 10 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'transparent' },
  cardProduct: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  discBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1 },
  breakdownRow: { flexDirection: 'row', marginTop: 10, gap: 6, backgroundColor: 'transparent' },
  breakdownCol: { flex: 1, backgroundColor: '#0f3460', borderRadius: 8, padding: 8, alignItems: 'center' },
  breakdownLabel: { color: '#888', fontSize: 10 },
  breakdownValue: { color: '#fff', fontSize: 16, fontWeight: 'bold', marginTop: 2 },
  empty: { alignItems: 'center', paddingTop: 60 },
  emptyText: { color: '#555', fontSize: 16, marginTop: 12 },
  emptyHint: { color: '#444', fontSize: 13, marginTop: 4 },
});
