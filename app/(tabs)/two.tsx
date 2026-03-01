import React, { useState, useCallback } from 'react';
import {
  StyleSheet,
  TouchableOpacity,
  FlatList,
  RefreshControl,
  Alert,
} from 'react-native';
import { Text, View } from '@/components/Themed';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useFocusEffect, useRouter } from 'expo-router';

type DashboardData = {
  todaySales: number;
  todayTransactions: number;
  lowStockCount: number;
  totalProducts: number;
};

type RecentSale = {
  id: string;
  total_amount: number;
  created_at: string;
  status: string;
  branch_name?: string;
};

type BranchSummary = {
  branch_id: string;
  branch_name: string;
  revenue: number;
  cost: number;
  profit: number;
  transactions: number;
  expenses: number;
  netProfit: number;
};

type Period = 'today' | 'week' | 'month' | '3months' | '6months';

export default function DashboardScreen() {
  const { business, currentBranch, branches, profile, fmt } = useAuth();
  const router = useRouter();
  const isAdmin = profile?.role === 'admin';
  const [period, setPeriod] = useState<Period>('today');
  const [dashboard, setDashboard] = useState<DashboardData>({
    todaySales: 0,
    todayTransactions: 0,
    lowStockCount: 0,
    totalProducts: 0,
  });
  const [branchSummaries, setBranchSummaries] = useState<BranchSummary[]>([]);
  const [businessTotal, setBusinessTotal] = useState({ revenue: 0, cost: 0, profit: 0, expenses: 0, netProfit: 0, transactions: 0 });
  const [recentSales, setRecentSales] = useState<RecentSale[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const getDateFrom = (p: Period) => {
    const now = new Date();
    switch (p) {
      case 'today': return now.toISOString().split('T')[0] + 'T00:00:00';
      case 'week': { const d = new Date(now); d.setDate(d.getDate() - 7); return d.toISOString(); }
      case 'month': { const d = new Date(now); d.setDate(1); return d.toISOString().split('T')[0] + 'T00:00:00'; }
      case '3months': { const d = new Date(now); d.setMonth(d.getMonth() - 3); return d.toISOString(); }
      case '6months': { const d = new Date(now); d.setMonth(d.getMonth() - 6); return d.toISOString(); }
    }
  };

  const loadDashboard = useCallback(async () => {
    if (!business || !currentBranch) return;

    const from = getDateFrom(period);

    if (isAdmin) {
      // ── Admin: cross-branch overview ──
      const { data: salesData } = await supabase
        .from('sales')
        .select('branch_id, total_amount, sale_items(quantity, cost_price)')
        .eq('business_id', business.id)
        .eq('status', 'completed')
        .gte('created_at', from);

      // Expenses for the period
      const { data: expData } = await supabase
        .from('expenses')
        .select('branch_id, amount')
        .eq('business_id', business.id)
        .gte('date', from.split('T')[0]);

      // Build per-branch summaries
      const branchMap: Record<string, BranchSummary> = {};
      branches.forEach(b => {
        branchMap[b.id] = { branch_id: b.id, branch_name: b.name, revenue: 0, cost: 0, profit: 0, transactions: 0, expenses: 0, netProfit: 0 };
      });

      let totalRev = 0, totalCost = 0, totalTx = 0;
      salesData?.forEach((sale: any) => {
        const b = branchMap[sale.branch_id];
        if (b) {
          b.revenue += Number(sale.total_amount);
          b.transactions += 1;
          sale.sale_items?.forEach((item: any) => {
            b.cost += Number(item.cost_price || 0) * Number(item.quantity);
          });
        }
        totalRev += Number(sale.total_amount);
        totalTx += 1;
        sale.sale_items?.forEach((item: any) => {
          totalCost += Number(item.cost_price || 0) * Number(item.quantity);
        });
      });

      let totalExp = 0;
      expData?.forEach((e: any) => {
        const b = branchMap[e.branch_id];
        if (b) b.expenses += Number(e.amount);
        totalExp += Number(e.amount);
      });

      // Compute profits
      Object.values(branchMap).forEach(b => {
        b.profit = b.revenue - b.cost;
        b.netProfit = b.profit - b.expenses;
      });

      const activeBranches = Object.values(branchMap).filter(b => b.transactions > 0 || b.expenses > 0);
      setBranchSummaries(activeBranches);
      setBusinessTotal({
        revenue: totalRev,
        cost: totalCost,
        profit: totalRev - totalCost,
        expenses: totalExp,
        netProfit: totalRev - totalCost - totalExp,
        transactions: totalTx,
      });

      // Low stock across all branches
      const { count: lowStockCount } = await supabase
        .from('inventory')
        .select('*, branches!inner(business_id)', { count: 'exact', head: true })
        .eq('branches.business_id', business.id)
        .lt('quantity', 5);

      // Total products
      const { count: totalProducts } = await supabase
        .from('products')
        .select('*', { count: 'exact', head: true })
        .eq('business_id', business.id);

      setDashboard({
        todaySales: totalRev,
        todayTransactions: totalTx,
        lowStockCount: lowStockCount || 0,
        totalProducts: totalProducts || 0,
      });

      // Recent sales across all branches
      const { data: recent } = await supabase
        .from('sales')
        .select('id, total_amount, created_at, status, branches(name)')
        .eq('business_id', business.id)
        .order('created_at', { ascending: false })
        .limit(15);
      setRecentSales((recent || []).map((s: any) => ({
        id: s.id, total_amount: s.total_amount, created_at: s.created_at, status: s.status, branch_name: s.branches?.name,
      })));

    } else {
      // ── Non-admin: single branch ──
      const { data: salesData } = await supabase
        .from('sales')
        .select('total_amount')
        .eq('branch_id', currentBranch.id)
        .gte('created_at', from)
        .eq('status', 'completed');

      const todaySales = salesData?.reduce((sum, s) => sum + Number(s.total_amount), 0) || 0;
      const todayTransactions = salesData?.length || 0;

      const { count: lowStockCount } = await supabase
        .from('inventory')
        .select('*', { count: 'exact', head: true })
        .eq('branch_id', currentBranch.id)
        .lt('quantity', 5);

      const { count: totalProducts } = await supabase
        .from('products')
        .select('*', { count: 'exact', head: true })
        .eq('business_id', business.id);

      setDashboard({ todaySales, todayTransactions, lowStockCount: lowStockCount || 0, totalProducts: totalProducts || 0 });
      setBranchSummaries([]);
      setBusinessTotal({ revenue: 0, cost: 0, profit: 0, expenses: 0, netProfit: 0, transactions: 0 });

      const { data: recent } = await supabase
        .from('sales')
        .select('id, total_amount, created_at, status')
        .eq('branch_id', currentBranch.id)
        .order('created_at', { ascending: false })
        .limit(10);
      setRecentSales(recent || []);
    }
  }, [business, currentBranch, branches, period, isAdmin]);

  useFocusEffect(useCallback(() => {
    loadDashboard();
  }, [loadDashboard]));

  const onRefresh = async () => {
    setRefreshing(true);
    await loadDashboard();
    setRefreshing(false);
  };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const periodLabel = (p: Period) => {
    switch (p) {
      case 'today': return 'Today';
      case 'week': return '7 Days';
      case 'month': return 'Month';
      case '3months': return '3 Mo';
      case '6months': return '6 Mo';
    }
  };

  return (
    <View style={styles.container}>
      <FlatList
        data={recentSales}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#e94560" />}
        ListHeaderComponent={
          <>
            {/* Welcome */}
            <View style={styles.welcome}>
              <Text style={styles.welcomeText}>
                👋 Hello, {profile?.full_name || 'User'}
              </Text>
              <Text style={styles.branchLabel}>
                {isAdmin ? `🏢 ${business?.name} · All Branches` : `📍 ${currentBranch?.name}`}
              </Text>
            </View>

            {/* Period Selector (admin or all) */}
            {isAdmin && (
              <View style={styles.periodRow}>
                {(['today', 'week', 'month', '3months', '6months'] as Period[]).map((p) => (
                  <TouchableOpacity
                    key={p}
                    style={[styles.periodBtn, period === p && styles.periodBtnActive]}
                    onPress={() => setPeriod(p)}
                  >
                    <Text style={[styles.periodText, period === p && styles.periodTextActive]}>
                      {periodLabel(p)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* Stats Cards */}
            <View style={styles.statsRow}>
              <View style={[styles.statCard, { backgroundColor: '#0f3460' }]}>
                <Text style={styles.statValue}>{fmt(dashboard.todaySales)}</Text>
                <Text style={styles.statLabel}>{isAdmin ? 'Total Revenue' : "Today's Sales"}</Text>
              </View>
              <View style={[styles.statCard, { backgroundColor: '#533483' }]}>
                <Text style={styles.statValue}>{dashboard.todayTransactions}</Text>
                <Text style={styles.statLabel}>Transactions</Text>
              </View>
            </View>

            {/* Admin-only: Profit & Expenses row */}
            {isAdmin && (
              <View style={styles.statsRow}>
                <View style={[styles.statCard, { backgroundColor: businessTotal.netProfit >= 0 ? '#2d6a4f' : '#8B1A1A' }]}>
                  <Text style={styles.statValue}>{fmt(businessTotal.netProfit)}</Text>
                  <Text style={styles.statLabel}>Net Profit</Text>
                </View>
                <View style={[styles.statCard, { backgroundColor: '#8B1A1A' }]}>
                  <Text style={styles.statValue}>{fmt(businessTotal.expenses)}</Text>
                  <Text style={styles.statLabel}>Expenses</Text>
                </View>
              </View>
            )}

            <View style={styles.statsRow}>
              <View style={[styles.statCard, { backgroundColor: dashboard.lowStockCount > 0 ? '#e94560' : '#2d6a4f' }]}>
                <Text style={styles.statValue}>{dashboard.lowStockCount}</Text>
                <Text style={styles.statLabel}>Low Stock Items</Text>
              </View>
              <View style={[styles.statCard, { backgroundColor: '#16213e' }]}>
                <Text style={styles.statValue}>{dashboard.totalProducts}</Text>
                <Text style={styles.statLabel}>Total Products</Text>
              </View>
            </View>

            {/* Admin: Per-Branch Profit Breakdown */}
            {isAdmin && branchSummaries.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>📊 Branch Performance</Text>
                {branchSummaries.map((b) => (
                  <View key={b.branch_id} style={styles.branchCard}>
                    <View style={styles.branchHeader}>
                      <Text style={styles.branchName}>{b.branch_name}</Text>
                      <Text style={styles.branchTxCount}>{b.transactions} sales</Text>
                    </View>
                    <View style={styles.branchStatsRow}>
                      <View style={styles.branchStat}>
                        <Text style={styles.branchStatVal}>{fmt(b.revenue)}</Text>
                        <Text style={styles.branchStatLabel}>Revenue</Text>
                      </View>
                      <View style={styles.branchStat}>
                        <Text style={[styles.branchStatVal, { color: b.profit >= 0 ? '#4CAF50' : '#e94560' }]}>
                          {fmt(b.profit)}
                        </Text>
                        <Text style={styles.branchStatLabel}>Gross Profit</Text>
                      </View>
                    </View>
                    <View style={styles.branchStatsRow}>
                      <View style={styles.branchStat}>
                        <Text style={[styles.branchStatVal, { color: '#e94560' }]}>
                          {fmt(b.expenses)}
                        </Text>
                        <Text style={styles.branchStatLabel}>Expenses</Text>
                      </View>
                      <View style={styles.branchStat}>
                        <Text style={[styles.branchStatVal, { color: b.netProfit >= 0 ? '#4CAF50' : '#e94560' }]}>
                          {fmt(b.netProfit)}
                        </Text>
                        <Text style={styles.branchStatLabel}>Net Profit</Text>
                      </View>
                    </View>
                  </View>
                ))}
              </>
            )}

            {/* Quick Actions */}
            <Text style={styles.sectionTitle}>Quick Actions</Text>
            <View style={styles.actionsGrid}>
              <TouchableOpacity style={styles.actionCard} onPress={() => router.push('/purchases' as any)}>
                <FontAwesome name="shopping-basket" size={22} color="#4CAF50" />
                <Text style={styles.actionLabel}>Purchases</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.actionCard} onPress={() => router.push('/expenses' as any)}>
                <FontAwesome name="money" size={22} color="#e94560" />
                <Text style={styles.actionLabel}>Expenses</Text>
              </TouchableOpacity>
              {isAdmin && (
                <TouchableOpacity style={styles.actionCard} onPress={() => router.push('/reports' as any)}>
                  <FontAwesome name="line-chart" size={22} color="#FF9800" />
                  <Text style={styles.actionLabel}>Reports</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.actionCard} onPress={() => router.push('/tax-center' as any)}>
                <FontAwesome name="university" size={22} color="#FF5722" />
                <Text style={styles.actionLabel}>Tax Center</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.actionCard} onPress={() => router.push('/suppliers' as any)}>
                <FontAwesome name="truck" size={22} color="#2196F3" />
                <Text style={styles.actionLabel}>Suppliers</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.actionCard} onPress={() => router.push('/customers' as any)}>
                <FontAwesome name="users" size={22} color="#FF9800" />
                <Text style={styles.actionLabel}>Customers</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.actionCard} onPress={() => router.push('/sales' as any)}>
                <FontAwesome name="history" size={22} color="#7C3AED" />
                <Text style={styles.actionLabel}>Sales History</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.actionCard} onPress={() => router.push('/purchase-history' as any)}>
                <FontAwesome name="archive" size={22} color="#2196F3" />
                <Text style={styles.actionLabel}>Purchase History</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.actionCard} onPress={() => router.push('/debts' as any)}>
                <FontAwesome name="credit-card" size={22} color="#e94560" />
                <Text style={styles.actionLabel}>Debts</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.actionCard} onPress={() => router.push('/low-stock' as any)}>
                <FontAwesome name="exclamation-triangle" size={22} color="#FF9800" />
                <Text style={styles.actionLabel}>Low Stock</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.actionCard} onPress={() => router.push('/cash-register' as any)}>
                <FontAwesome name="calculator" size={22} color="#4CAF50" />
                <Text style={styles.actionLabel}>Cash Register</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.actionCard} onPress={() => router.push('/export' as any)}>
                <FontAwesome name="download" size={22} color="#2196F3" />
                <Text style={styles.actionLabel}>Export Data</Text>
              </TouchableOpacity>
              {isAdmin && (
                <TouchableOpacity style={styles.actionCard} onPress={() => router.push('/sales-targets' as any)}>
                  <FontAwesome name="bullseye" size={22} color="#FF5722" />
                  <Text style={styles.actionLabel}>Targets</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.actionCard} onPress={() => router.push('/loyalty' as any)}>
                <FontAwesome name="star" size={22} color="#FFD700" />
                <Text style={styles.actionLabel}>Loyalty</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.actionCard} onPress={() => router.push('/help' as any)}>
                <FontAwesome name="book" size={22} color="#4CAF50" />
                <Text style={styles.actionLabel}>Help Guide</Text>
              </TouchableOpacity>
            </View>

            {/* Recent Sales Header */}
            <Text style={styles.sectionTitle}>📋 Recent Sales</Text>
          </>
        }
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.saleRow} onPress={() => router.push({ pathname: '/sale-detail', params: { saleId: item.id } } as any)}>
            <View style={styles.saleInfo}>
              <Text style={styles.saleAmount}>{fmt(Number(item.total_amount))}</Text>
              <Text style={styles.saleTime}>
                {formatTime(item.created_at)}
                {isAdmin && item.branch_name ? ` · ${item.branch_name}` : ''}
              </Text>
            </View>
            <View style={[styles.statusBadge, item.status === 'completed' ? styles.badgeCompleted : styles.badgeVoided]}>
              <Text style={styles.statusText}>{item.status}</Text>
            </View>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <FontAwesome name="inbox" size={48} color="#333" />
            <Text style={styles.emptyText}>No sales yet{period === 'today' ? ' today' : ''}</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  welcome: { padding: 20, paddingBottom: 8, backgroundColor: 'transparent' },
  welcomeText: { fontSize: 22, fontWeight: 'bold', color: '#fff' },
  branchLabel: { fontSize: 14, color: '#aaa', marginTop: 4 },
  periodRow: { flexDirection: 'row', marginHorizontal: 16, marginBottom: 12, gap: 6, backgroundColor: 'transparent' },
  periodBtn: { flex: 1, paddingVertical: 8, borderRadius: 10, backgroundColor: '#16213e', alignItems: 'center', borderWidth: 1, borderColor: '#0f3460' },
  periodBtnActive: { backgroundColor: '#e94560', borderColor: '#e94560' },
  periodText: { color: '#aaa', fontWeight: 'bold', fontSize: 12 },
  periodTextActive: { color: '#fff' },
  statsRow: { flexDirection: 'row', paddingHorizontal: 16, gap: 12, marginBottom: 12, backgroundColor: 'transparent' },
  statCard: { flex: 1, borderRadius: 16, padding: 16, alignItems: 'center' },
  statValue: { fontSize: 20, fontWeight: 'bold', color: '#fff' },
  statLabel: { fontSize: 12, color: '#ccc', marginTop: 4 },
  sectionTitle: { fontSize: 18, fontWeight: 'bold', color: '#fff', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 },
  branchCard: { backgroundColor: '#16213e', marginHorizontal: 16, marginBottom: 10, borderRadius: 14, padding: 16 },
  branchHeader: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: 'transparent', marginBottom: 10 },
  branchName: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  branchTxCount: { color: '#aaa', fontSize: 13 },
  branchStatsRow: { flexDirection: 'row', backgroundColor: 'transparent', marginBottom: 4 },
  branchStat: { flex: 1, backgroundColor: 'transparent' },
  branchStatVal: { color: '#4CAF50', fontSize: 14, fontWeight: 'bold' },
  branchStatLabel: { color: '#aaa', fontSize: 11, marginTop: 2 },
  actionsGrid: {
    flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, gap: 10,
    marginBottom: 4, backgroundColor: 'transparent',
  },
  actionCard: {
    width: '47%', backgroundColor: '#16213e', borderRadius: 14, padding: 16,
    alignItems: 'center', borderWidth: 1, borderColor: '#0f3460',
  },
  actionLabel: { fontSize: 13, color: '#ccc', marginTop: 8, fontWeight: '600' },
  saleRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#16213e', marginHorizontal: 16, marginBottom: 8,
    borderRadius: 12, padding: 14,
  },
  saleInfo: { backgroundColor: 'transparent', flex: 1 },
  saleAmount: { fontSize: 16, fontWeight: 'bold', color: '#fff' },
  saleTime: { fontSize: 12, color: '#aaa', marginTop: 2 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  badgeCompleted: { backgroundColor: '#2d6a4f' },
  badgeVoided: { backgroundColor: '#e94560' },
  statusText: { fontSize: 12, color: '#fff', fontWeight: 'bold', textTransform: 'capitalize' },
  emptyState: { alignItems: 'center', paddingTop: 40, backgroundColor: 'transparent' },
  emptyText: { color: '#555', fontSize: 16, marginTop: 12 },
});
