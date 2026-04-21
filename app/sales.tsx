import React, { useState, useCallback } from 'react';
import {
  StyleSheet,
  TouchableOpacity,
  FlatList,
  RefreshControl,
  TextInput,
  Modal,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Text, View } from '@/components/Themed';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useFocusEffect, useRouter } from 'expo-router';

type SaleRow = {
  id: string;
  total_amount: number;
  subtotal: number;
  tax_amount: number;
  discount_amount: number;
  payment_method: string;
  status: string;
  is_fiscalized: boolean;
  created_at: string;
  seller_name: string;
  branch_name: string;
  customer_name: string | null;
  item_count: number;
  efris_status: string;
  efris_error: string | null;
};

type Period = 'today' | 'week' | 'month' | '3months' | 'all';

const PAYMENT_LABELS: Record<string, string> = {
  cash: 'Cash', mobile_money: 'MoMo', card: 'Card', credit: 'Credit',
};

export default function SalesScreen() {
  const { business, currentBranch, branches, profile, fmt } = useAuth();
  const router = useRouter();
  const isAdmin = profile?.role === 'admin';
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [period, setPeriod] = useState<Period>('today');
  const [searchQuery, setSearchQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [selectedBranch, setSelectedBranch] = useState<string>('all');
  const [selectedSeller, setSelectedSeller] = useState<string>('all');
  const [sellers, setSellers] = useState<{ id: string; name: string }[]>([]);
  
  // Product selection states
  const [selectedProduct, setSelectedProduct] = useState<{ id: string; name: string } | null>(null);
  const [showProductModal, setShowProductModal] = useState(false);
  const [productSearchQuery, setProductSearchQuery] = useState('');
  const [productSearchResults, setProductSearchResults] = useState<any[]>([]);
  const [searchingProducts, setSearchingProducts] = useState(false);
  const [productStats, setProductStats] = useState<{
    name: string;
    soldQty: number;
    revenue: number;
    cogs: number;
    profit: number;
    purchasedQty: number;
    purchasedAmount: number;
    currentStock: number;
  } | null>(null);

  // Reset seller when branch changes
  React.useEffect(() => { setSelectedSeller('all'); }, [selectedBranch]);

  // Load sellers for filter
  useFocusEffect(useCallback(() => {
    if (!business) return;
    (async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name')
        .eq('business_id', business.id)
        .order('full_name');
      setSellers((data || []).map((p: any) => ({ id: p.id, name: p.full_name || 'Unknown' })));
    })();
  }, [business]));

  const getDateFrom = (p: Period): string | null => {
    const now = new Date();
    switch (p) {
      case 'today': return now.toISOString().split('T')[0] + 'T00:00:00';
      case 'week': { const d = new Date(now); d.setDate(d.getDate() - 7); return d.toISOString(); }
      case 'month': { const d = new Date(now); d.setDate(1); return d.toISOString().split('T')[0] + 'T00:00:00'; }
      case '3months': { const d = new Date(now); d.setMonth(d.getMonth() - 3); return d.toISOString(); }
      case 'all': return null;
    }
  };

  const load = useCallback(async () => {
    if (!business) return;
    const from = getDateFrom(period);

    let productSaleIds: string[] | null = null;

    // Product filter: find matching sale IDs and compute stats
    if (selectedProduct) {
      let itemQuery = supabase
        .from('sale_items')
        .select('sale_id, quantity, line_total, cost_price, sales!inner(business_id, created_at, branch_id, seller_id)')
        .eq('product_id', selectedProduct.id)
        .eq('sales.business_id', business.id);

      if (from) itemQuery = itemQuery.gte('sales.created_at', from);
      if (isAdmin && selectedBranch !== 'all') itemQuery = itemQuery.eq('sales.branch_id', selectedBranch);
      else if (!isAdmin && currentBranch) itemQuery = itemQuery.eq('sales.branch_id', currentBranch.id);
      if (selectedSeller !== 'all') itemQuery = itemQuery.eq('sales.seller_id', selectedSeller);

      const { data: matchItems } = await itemQuery.limit(1000);

      const totalQty = (matchItems || []).reduce((s: number, i: any) => s + i.quantity, 0);
      const totalRev = (matchItems || []).reduce((s: number, i: any) => s + Number(i.line_total), 0);
      const totalCogs = (matchItems || []).reduce((s: number, i: any) => s + (Number(i.cost_price || 0) * i.quantity), 0);
      const totalProfit = totalRev - totalCogs;
      productSaleIds = [...new Set((matchItems || []).map((i: any) => i.sale_id))];

      // Fetch Purchases
      let purchaseQuery = supabase
        .from('purchase_items')
        .select('quantity, line_total, purchases!inner(business_id, branch_id)')
        .eq('product_id', selectedProduct.id)
        .eq('purchases.business_id', business.id);
      
      if (isAdmin && selectedBranch !== 'all') purchaseQuery = purchaseQuery.eq('purchases.branch_id', selectedBranch);
      else if (!isAdmin && currentBranch) purchaseQuery = purchaseQuery.eq('purchases.branch_id', currentBranch.id);

      const { data: purchaseItems } = await purchaseQuery;
      const totalPurchasedQty = (purchaseItems || []).reduce((sum, i) => sum + i.quantity, 0);
      const totalPurchasedAmount = (purchaseItems || []).reduce((sum, i) => sum + Number(i.line_total), 0);

      // Fetch Current Inventory
      let invQuery = supabase
        .from('inventory')
        .select('quantity')
        .eq('product_id', selectedProduct.id);
      
      if (isAdmin && selectedBranch !== 'all') invQuery = invQuery.eq('branch_id', selectedBranch);
      else if (!isAdmin && currentBranch) invQuery = invQuery.eq('branch_id', currentBranch.id);

      const { data: invData } = await invQuery;
      const currentStock = (invData || []).reduce((sum, i) => sum + i.quantity, 0);

      setProductStats({
        name: selectedProduct.name,
        soldQty: totalQty,
        revenue: totalRev,
        cogs: totalCogs,
        profit: totalProfit,
        purchasedQty: totalPurchasedQty,
        purchasedAmount: totalPurchasedAmount,
        currentStock,
      });

      if (!matchItems || matchItems.length === 0) {
        setSales([]);
        return;
      }
    } else {
      setProductStats(null);
    }

    let query = supabase
      .from('sales')
      .select(`
        id, total_amount, subtotal, tax_amount, discount_amount,
        payment_method, status, is_fiscalized, created_at,
        customer_name, seller_id, branch_id, efris_status, efris_error,
        sale_items(id)
      `)
      .eq('business_id', business.id)
      .order('created_at', { ascending: false })
      .limit(100);

    // Date filter
    if (from) {
      query = query.gte('created_at', from);
    }

    // Branch scope
    if (isAdmin && selectedBranch !== 'all') {
      query = query.eq('branch_id', selectedBranch);
    } else if (!isAdmin && currentBranch) {
      query = query.eq('branch_id', currentBranch.id);
    }

    // Seller filter
    if (selectedSeller !== 'all') {
      query = query.eq('seller_id', selectedSeller);
    }

    // Product filter: restrict to matching sales
    if (productSaleIds) {
      query = query.in('id', productSaleIds);
    }

    const { data } = await query;

    if (data) {
      // Collect unique seller and branch IDs to fetch names
      const sellerIds = [...new Set(data.map((s: any) => s.seller_id).filter(Boolean))];
      const branchIds = [...new Set(data.map((s: any) => s.branch_id).filter(Boolean))];

      const sellerMap: Record<string, string> = {};
      const branchMap: Record<string, string> = {};

      if (sellerIds.length > 0) {
        const { data: sellers } = await supabase
          .from('profiles')
          .select('id, full_name')
          .in('id', sellerIds);
        sellers?.forEach((p: any) => { sellerMap[p.id] = p.full_name; });
      }

      if (branchIds.length > 0) {
        const { data: branchesData } = await supabase
          .from('branches')
          .select('id, name')
          .in('id', branchIds);
        branchesData?.forEach((b: any) => { branchMap[b.id] = b.name; });
      }

      setSales(data.map((s: any) => ({
        id: s.id,
        total_amount: Number(s.total_amount),
        subtotal: Number(s.subtotal || 0),
        tax_amount: Number(s.tax_amount || 0),
        discount_amount: Number(s.discount_amount || 0),
        payment_method: s.payment_method || 'cash',
        status: s.status,
        is_fiscalized: s.is_fiscalized || false,
        created_at: s.created_at,
        seller_name: sellerMap[s.seller_id] || '?',
        branch_name: branchMap[s.branch_id] || '?',
        customer_name: s.customer_name || null,
        item_count: s.sale_items?.length || 0,
        efris_status: s.efris_status || 'not_required',
        efris_error: s.efris_error || null,
      })));
    }
  }, [business, currentBranch, period, selectedBranch, selectedSeller, isAdmin, selectedProduct]);

  const searchProducts = async (query: string) => {
    if (!business || !query.trim()) {
      setProductSearchResults([]);
      return;
    }
    setSearchingProducts(true);
    const { data } = await supabase
      .from('inventory')
      .select('id, name, selling_price, stock_quantity')
      .eq('business_id', business.id)
      .ilike('name', `%${query}%`)
      .limit(20);
    setProductSearchResults(data || []);
    setSearchingProducts(false);
  };

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const totalRevenue = sales
    .filter(s => s.status === 'completed')
    .reduce((sum, s) => sum + s.total_amount, 0);
  const totalTransactions = sales.filter(s => s.status === 'completed').length;

  const filteredSales = searchQuery.trim()
    ? sales.filter(s =>
        s.customer_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.seller_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.id.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : sales;

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    const today = new Date();
    const isToday = d.toDateString() === today.toDateString();
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (isToday) return `Today ${time}`;
    return `${d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} ${time}`;
  };

  const periodLabels: Record<Period, string> = {
    today: 'Today', week: '7 Days', month: 'Month', '3months': '3 Mo', all: 'All',
  };

  return (
    <View style={styles.container}>
      <FlatList
        data={filteredSales}
        keyExtractor={(s) => s.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#e94560" />}
        ListHeaderComponent={
          <>
            {/* Summary */}
            <View style={styles.summaryRow}>
              <View style={[styles.summaryCard, { backgroundColor: '#0f3460' }]}>
                <Text style={styles.summaryValue}>{fmt(totalRevenue)}</Text>
                <Text style={styles.summaryLabel}>Revenue</Text>
              </View>
              <View style={[styles.summaryCard, { backgroundColor: '#533483' }]}>
                <Text style={styles.summaryValue}>{totalTransactions}</Text>
                <Text style={styles.summaryLabel}>Sales</Text>
              </View>
            </View>

            {/* Period Filter */}
            <View style={styles.periodRow}>
              {(['today', 'week', 'month', '3months', 'all'] as Period[]).map((p) => (
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

            {/* Branch filter (admin only) */}
            {isAdmin && branches.length > 1 && (
              <View style={styles.branchFilter}>
                <TouchableOpacity
                  style={[styles.branchChip, selectedBranch === 'all' && styles.branchChipActive]}
                  onPress={() => setSelectedBranch('all')}
                >
                  <Text style={[styles.branchChipText, selectedBranch === 'all' && styles.branchChipTextActive]}>All Branches</Text>
                </TouchableOpacity>
                {branches.map(b => (
                  <TouchableOpacity
                    key={b.id}
                    style={[styles.branchChip, selectedBranch === b.id && styles.branchChipActive]}
                    onPress={() => setSelectedBranch(b.id)}
                  >
                    <Text style={[styles.branchChipText, selectedBranch === b.id && styles.branchChipTextActive]}>{b.name}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* Seller filter (admin only) */}
            {isAdmin && sellers.length > 1 && (
              <View style={styles.branchFilter}>
                <TouchableOpacity
                  style={[styles.branchChip, selectedSeller === 'all' && styles.sellerChipActive]}
                  onPress={() => setSelectedSeller('all')}
                >
                  <Text style={[styles.branchChipText, selectedSeller === 'all' && styles.branchChipTextActive]}>All Sellers</Text>
                </TouchableOpacity>
                {sellers.map(s => (
                  <TouchableOpacity
                    key={s.id}
                    style={[styles.branchChip, selectedSeller === s.id && styles.sellerChipActive]}
                    onPress={() => setSelectedSeller(s.id)}
                  >
                    <Text style={[styles.branchChipText, selectedSeller === s.id && styles.branchChipTextActive]}>{s.name}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* Search */}
            <View style={styles.searchContainer}>
              <FontAwesome name="search" size={14} color="#555" style={{ marginRight: 8 }} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search by customer, seller, or ID..."
                placeholderTextColor="#555"
                value={searchQuery}
                onChangeText={setSearchQuery}
              />
              {searchQuery ? (
                <TouchableOpacity onPress={() => setSearchQuery('')}>
                  <FontAwesome name="times-circle" size={16} color="#555" />
                </TouchableOpacity>
              ) : null}
            </View>

            {/* Product filter */}
            <TouchableOpacity
              style={styles.searchContainer}
              onPress={() => setShowProductModal(true)}
            >
              <FontAwesome name="cube" size={14} color="#555" style={{ marginRight: 8 }} />
              <Text style={[styles.searchInput, !selectedProduct && { color: '#555' }]} numberOfLines={1}>
                {selectedProduct ? selectedProduct.name : 'Select product to filter sales...'}
              </Text>
              {selectedProduct ? (
                <TouchableOpacity onPress={() => setSelectedProduct(null)}>
                  <FontAwesome name="times-circle" size={16} color="#e94560" />
                </TouchableOpacity>
              ) : (
                <FontAwesome name="chevron-right" size={12} color="#555" />
              )}
            </TouchableOpacity>

            {/* Product Performance Dashboard */}
            {productStats && (
              <View style={styles.dashboardContainer}>
                <View style={styles.dashboardHeader}>
                  <Text style={styles.dashboardTitle}>📦 {productStats.name}</Text>
                  <View style={[styles.stockBadge, { backgroundColor: productStats.currentStock > 0 ? '#2d6a4f' : '#e94560' }]}>
                    <Text style={styles.stockBadgeText}>Stock: {productStats.currentStock}</Text>
                  </View>
                </View>

                <View style={styles.dashboardGrid}>
                  <View style={styles.dashboardItem}>
                    <Text style={styles.dashboardLabel}>Sold Qty</Text>
                    <Text style={styles.dashboardValue}>{productStats.soldQty}</Text>
                  </View>
                  <View style={styles.dashboardItem}>
                    <Text style={[styles.dashboardLabel, { color: '#4ade80' }]}>Revenue</Text>
                    <Text style={[styles.dashboardValue, { color: '#4ade80' }]}>{fmt(productStats.revenue)}</Text>
                  </View>
                  
                  <View style={styles.dashboardItem}>
                    <Text style={styles.dashboardLabel}>Purchased</Text>
                    <Text style={styles.dashboardValue}>{productStats.purchasedQty}</Text>
                  </View>
                  <View style={styles.dashboardItem}>
                    <Text style={[styles.dashboardLabel, { color: '#60a5fa' }]}>Cost</Text>
                    <Text style={[styles.dashboardValue, { color: '#60a5fa' }]}>{fmt(productStats.purchasedAmount)}</Text>
                  </View>

                  <View style={[styles.dashboardItem, { borderBottomWidth: 0 }]}>
                    <Text style={styles.dashboardLabel}>Profit</Text>
                    <Text style={[styles.dashboardValue, { color: productStats.profit >= 0 ? '#4ade80' : '#f00' }]}>
                      {fmt(productStats.profit)}
                    </Text>
                  </View>
                  <View style={[styles.dashboardItem, { borderBottomWidth: 0 }]}>
                    <Text style={styles.dashboardLabel}>Margin</Text>
                    <Text style={[styles.dashboardValue, { color: '#aaa' }]}>
                      {productStats.revenue > 0 ? ((productStats.profit / productStats.revenue) * 100).toFixed(1) : '0'}%
                    </Text>
                  </View>
                </View>
              </View>
            )}
          </>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.saleCard}
            onPress={() => router.push({ pathname: '/sale-detail', params: { saleId: item.id } } as any)}
            activeOpacity={0.7}
          >
            <View style={styles.saleCardTop}>
              <View style={styles.saleCardLeft}>
                <Text style={styles.saleAmount}>{fmt(item.total_amount)}</Text>
                <Text style={styles.saleDate}>{formatDate(item.created_at)}</Text>
              </View>
              <View style={styles.saleCardRight}>
                <View style={[
                  styles.statusBadge,
                  item.status === 'completed' ? styles.badgeCompleted : styles.badgeVoided,
                ]}>
                  <Text style={styles.statusText}>{item.status}</Text>
                </View>
                {item.efris_status === 'submitted' && (
                  <Text style={styles.efrisBadge}>✅ EFRIS</Text>
                )}
                {item.efris_status === 'failed' && (
                  <Text style={[styles.efrisBadge, { color: '#e94560' }]}>❌ EFRIS Failed</Text>
                )}
                {item.efris_status === 'not_required' && (
                  <Text style={[styles.efrisBadge, { color: '#888' }]}>🛡️ Internal Only</Text>
                )}
              </View>
            </View>

            {/* Manual Fiscalize Button if enabled */}
            {(item.efris_status !== 'submitted' && business?.is_efris_enabled) && (
              <TouchableOpacity
                style={styles.fiscalizeRowBtn}
                onPress={() => router.push({ pathname: '/fiscalize-sale' as any, params: { saleId: item.id } })}
              >
                <FontAwesome name="paper-plane-o" size={12} color="#e94560" />
                <Text style={styles.fiscalizeRowText}>Modify & Submit to EFRIS</Text>
              </TouchableOpacity>
            )}

            <View style={styles.saleCardMeta}>
              <Text style={styles.metaText}>
                {item.item_count} item{item.item_count !== 1 ? 's' : ''} · {PAYMENT_LABELS[item.payment_method] || item.payment_method}
              </Text>
              <Text style={styles.metaText}>
                👤 {item.seller_name}
                {isAdmin ? ` · 📍 ${item.branch_name}` : ''}
              </Text>
              {item.customer_name && (
                <Text style={styles.metaText}>🧾 {item.customer_name}</Text>
              )}
            </View>

            {(item.discount_amount > 0 || item.tax_amount > 0) && (
              <View style={styles.saleCardExtras}>
                {item.discount_amount > 0 && (
                  <Text style={styles.extraBadge}>-{fmt(item.discount_amount)} disc.</Text>
                )}
                {item.tax_amount > 0 && (
                  <Text style={styles.taxBadge}>Tax: {fmt(item.tax_amount)}</Text>
                )}
              </View>
            )}

            <View style={styles.viewDetailHint}>
              <Text style={styles.viewDetailText}>Tap to view details →</Text>
            </View>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <FontAwesome name="inbox" size={48} color="#333" />
            <Text style={styles.emptyText}>
              {searchQuery ? 'No matching sales' : 'No sales for this period'}
            </Text>
          </View>
        }
      />

      {/* Product Selection Modal */}
      <Modal visible={showProductModal} animationType="slide" transparent>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Filter by Product</Text>
                <TouchableOpacity onPress={() => setShowProductModal(false)}>
                  <FontAwesome name="times" size={24} color="#fff" />
                </TouchableOpacity>
              </View>
              
              <View style={styles.modalSearchContainer}>
                <FontAwesome name="search" size={16} color="#666" />
                <TextInput
                  style={styles.modalSearchInput}
                  placeholder="Search products..."
                  placeholderTextColor="#666"
                  value={productSearchQuery}
                  onChangeText={(t) => { setProductSearchQuery(t); searchProducts(t); }}
                  autoFocus
                />
              </View>

              <FlatList
                data={productSearchResults}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.productItem}
                    onPress={() => {
                      setSelectedProduct({ id: item.id, name: item.name });
                      setShowProductModal(false);
                      setProductSearchQuery('');
                      setProductSearchResults([]);
                    }}
                  >
                    <View style={{ flex: 1, backgroundColor: 'transparent' }}>
                      <Text style={{ color: '#fff', fontSize: 16, fontWeight: 'bold' }}>{item.name}</Text>
                      <Text style={{ color: '#aaa', fontSize: 12 }}>{fmt(item.selling_price)} • Stock: {item.stock_quantity}</Text>
                    </View>
                    <FontAwesome name="chevron-right" size={14} color="#333" />
                  </TouchableOpacity>
                )}
                ListEmptyComponent={
                  <View style={{ alignItems: 'center', paddingVertical: 40, backgroundColor: 'transparent' }}>
                    {searchingProducts ? (
                      <ActivityIndicator color="#e94560" />
                    ) : (
                      <Text style={{ color: '#555' }}>
                        {productSearchQuery ? 'No products found' : 'Type to search products'}
                      </Text>
                    )}
                  </View>
                }
              />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  summaryRow: { flexDirection: 'row', paddingHorizontal: 16, paddingTop: 16, gap: 12, backgroundColor: 'transparent' },
  summaryCard: { flex: 1, borderRadius: 14, padding: 14, alignItems: 'center' },
  summaryValue: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  summaryLabel: { color: '#ccc', fontSize: 12, marginTop: 4 },
  periodRow: { flexDirection: 'row', margin: 16, marginBottom: 8, gap: 6, backgroundColor: 'transparent' },
  periodBtn: { flex: 1, paddingVertical: 8, borderRadius: 10, backgroundColor: '#16213e', alignItems: 'center', borderWidth: 1, borderColor: '#0f3460' },
  periodBtnActive: { backgroundColor: '#e94560', borderColor: '#e94560' },
  periodText: { color: '#aaa', fontWeight: 'bold', fontSize: 12 },
  periodTextActive: { color: '#fff' },
  branchFilter: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, gap: 6, marginBottom: 8, backgroundColor: 'transparent' },
  branchChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: '#16213e', borderWidth: 1, borderColor: '#0f3460' },
  branchChipActive: { backgroundColor: '#e94560', borderColor: '#e94560' },
  branchChipText: { color: '#aaa', fontSize: 12, fontWeight: '600' },
  branchChipTextActive: { color: '#fff' },
  searchContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#16213e', marginHorizontal: 16, marginBottom: 12, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 },
  searchInput: { flex: 1, color: '#fff', fontSize: 14 },
  saleCard: { backgroundColor: '#16213e', marginHorizontal: 16, marginBottom: 10, borderRadius: 14, padding: 14 },
  saleCardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', backgroundColor: 'transparent' },
  saleCardLeft: { backgroundColor: 'transparent', flex: 1 },
  saleCardRight: { alignItems: 'flex-end', backgroundColor: 'transparent' },
  saleAmount: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  saleDate: { color: '#aaa', fontSize: 12, marginTop: 2 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeCompleted: { backgroundColor: '#2d6a4f' },
  badgeVoided: { backgroundColor: '#e94560' },
  statusText: { color: '#fff', fontSize: 11, fontWeight: 'bold', textTransform: 'capitalize' },
  efrisBadge: { fontSize: 11, marginTop: 4, fontWeight: 'bold' },
  fiscalizeRowBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#0f3460' },
  fiscalizeRowText: { color: '#e94560', fontSize: 12, fontWeight: 'bold' },
  saleCardMeta: { marginTop: 8, backgroundColor: 'transparent' },
  metaText: { color: '#888', fontSize: 12, marginTop: 2 },
  saleCardExtras: { flexDirection: 'row', gap: 8, marginTop: 6, backgroundColor: 'transparent' },
  extraBadge: { color: '#FF9800', fontSize: 11, backgroundColor: '#FF980018', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  taxBadge: { color: '#7C3AED', fontSize: 11, backgroundColor: '#7C3AED18', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  viewDetailHint: { marginTop: 8, borderTopWidth: 1, borderTopColor: '#0f3460', paddingTop: 8, backgroundColor: 'transparent' },
  viewDetailText: { color: '#555', fontSize: 12, textAlign: 'right' },
  empty: { alignItems: 'center', paddingTop: 60 },
  emptyText: { color: '#555', fontSize: 16, marginTop: 12 },
  sellerChipActive: { backgroundColor: '#7C3AED', borderColor: '#7C3AED' },
  productBanner: { marginHorizontal: 16, marginBottom: 10, padding: 12, backgroundColor: '#1a3a2e', borderRadius: 10, borderWidth: 1, borderColor: '#2d6a4f' },
  productBannerTitle: { color: '#4ade80', fontWeight: 'bold', fontSize: 14 },
  productBannerStat: { color: '#a7f3d0', fontSize: 13 },
  // Dashboard Styles
  dashboardContainer: { marginHorizontal: 16, marginBottom: 12, backgroundColor: '#16213e', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#0f3460' },
  dashboardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, backgroundColor: 'transparent' },
  dashboardTitle: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  stockBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  stockBadgeText: { color: '#fff', fontSize: 11, fontWeight: 'bold' },
  dashboardGrid: { flexDirection: 'row', flexWrap: 'wrap', backgroundColor: 'transparent' },
  dashboardItem: { width: '50%', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#0f3460' },
  dashboardLabel: { color: '#888', fontSize: 11, marginBottom: 2 },
  dashboardValue: { color: '#fff', fontSize: 14, fontWeight: 'bold' },
  // Modal styles
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#1a1a2e', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: '80%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, backgroundColor: 'transparent' },
  modalTitle: { fontSize: 20, fontWeight: 'bold', color: '#fff' },
  modalSearchContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#16213e', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 16 },
  modalSearchInput: { flex: 1, color: '#fff', fontSize: 16, marginLeft: 10 },
  productItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#0f3460', backgroundColor: 'transparent' },
});
