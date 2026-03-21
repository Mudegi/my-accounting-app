import React, { useState, useCallback } from 'react';
import {
  StyleSheet,
  TouchableOpacity,
  FlatList,
  RefreshControl,
  TextInput,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { Text, View } from '@/components/Themed';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useFocusEffect, useRouter } from 'expo-router';
import MyStockScreen from '../field-sales/my-stock';
import { exportData, importData } from '@/lib/import-export';
import { fetchEfrisGoods, type EfrisConfig } from '@/lib/efris';

type InventoryItem = {
  id: string;
  product_id: string;
  name: string;
  barcode: string | null;
  image_url: string | null;
  quantity: number;
  selling_price: number;
  avg_cost_price: number;
  reorder_level: number;
  is_service: boolean;
};

export default function InventoryScreen() {
  const { business, currentBranch, fmt, profile } = useAuth();
  const router = useRouter();

  // Field-only salespeople see their assigned stock within the same tab
  if (profile && profile.sales_type === 'field') {
    return <MyStockScreen />;
  }

  const [items, setItems] = useState<InventoryItem[]>([]);
  const [filtered, setFiltered] = useState<InventoryItem[]>([]);
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [activeFilter, setActiveFilter] = useState<'all' | 'low' | 'out'>('all');
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);

  // EFRIS import state
  const efrisEnabled = business?.is_efris_enabled ?? false;
  const [efrisImporting, setEfrisImporting] = useState(false);

  const loadInventory = useCallback(async () => {
    if (!business || !currentBranch) return;

    const { data } = await supabase
      .from('inventory')
      .select(`
        id,
        quantity,
        selling_price,
        avg_cost_price,
        reorder_level,
        product_id,
        products(id, name, barcode, image_url, is_service)
      `)
      .eq('branch_id', currentBranch.id)
      .order('quantity', { ascending: true });

    if (data) {
      const mapped: InventoryItem[] = data.map((row: any) => ({
        id: row.id,
        product_id: row.product_id,
        name: row.products?.name || 'Unknown',
        barcode: row.products?.barcode || null,
        image_url: row.products?.image_url || null,
        quantity: row.quantity,
        selling_price: row.selling_price,
        avg_cost_price: row.avg_cost_price,
        reorder_level: row.reorder_level,
        is_service: row.products?.is_service ?? false,
      }));
      setItems(mapped);
      setFiltered(mapped);
      // Reset filter to 'all' on reload
      setActiveFilter('all');
    }
  }, [business, currentBranch]);

  useFocusEffect(
    useCallback(() => {
      loadInventory();
    }, [loadInventory])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await loadInventory();
    setRefreshing(false);
  };

  const handleSearch = (text: string) => {
    setSearch(text);
    applyFilter(activeFilter, text);
  };

  const applyFilter = (filter: 'all' | 'low' | 'out', query?: string) => {
    const q = query ?? search;
    let base = items;
    // Apply stock filter
    if (filter === 'out') base = base.filter((i) => !i.is_service && i.quantity === 0);
    else if (filter === 'low') base = base.filter((i) => !i.is_service && i.quantity > 0 && i.quantity <= i.reorder_level);
    // Apply search filter
    if (q) {
      const lower = q.toLowerCase();
      base = base.filter((i) =>
        i.name.toLowerCase().includes(lower) ||
        (i.barcode && i.barcode.includes(q))
      );
    }
    setFiltered(base);
  };

  const toggleFilter = (filter: 'all' | 'low' | 'out') => {
    const next = activeFilter === filter ? 'all' : filter;
    setActiveFilter(next);
    applyFilter(next);
  };

  const stockStatus = (item: InventoryItem) => {
    if (item.is_service) return { color: '#2196F3', label: 'Service' };
    if (item.quantity === 0) return { color: '#e94560', label: 'Out of Stock' };
    if (item.quantity <= item.reorder_level) return { color: '#FF9800', label: 'Low Stock' };
    return { color: '#4CAF50', label: 'In Stock' };
  };

  const lowStockCount = items.filter((i) => !i.is_service && i.quantity <= i.reorder_level).length;
  const outOfStockCount = items.filter((i) => !i.is_service && i.quantity === 0).length;

  const handleExport = async (format: 'csv' | 'xlsx') => {
    if (!business) return;
    setExporting(true);
    try {
      const headers = ['Name', 'Barcode', 'Quantity', 'Selling Price', 'Cost Price', 'Reorder Level'];
      const rows = items.map(i => [i.name, i.barcode || '', i.quantity, i.selling_price, i.avg_cost_price, i.reorder_level]);
      await exportData(business.name, 'Inventory', headers, rows, format);
    } catch (e: any) {
      Alert.alert('Export Error', e.message);
    } finally {
      setExporting(false);
    }
  };

  const handleEfrisImport = async () => {
    if (!business?.efris_api_key) {
      Alert.alert('EFRIS not configured', 'Add your EFRIS API key in Settings → EFRIS Configuration.');
      return;
    }
    if (!currentBranch) return;

    Alert.alert(
      'Import from EFRIS',
      'Fetch all your registered goods & services from EFRIS and add them to your inventory?\n\nAlready-existing items will be skipped.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Import',
          onPress: async () => {
            setEfrisImporting(true);
            try {
              const config: EfrisConfig = {
                apiKey: business.efris_api_key!,
                apiUrl: business.efris_api_url || '',
                testMode: business.efris_test_mode ?? true,
              };
              const result = await fetchEfrisGoods(config);
              if (!result.success) {
                Alert.alert('Error', result.error || 'Failed to fetch goods from EFRIS');
                return;
              }

              const activeGoods = result.goods.filter(g => g.status === 'active');
              if (activeGoods.length === 0) {
                Alert.alert('No Goods', 'No active goods found in your EFRIS account.');
                return;
              }

              let added = 0, skipped = 0;
              for (const g of activeGoods) {
                // Skip if already imported
                const { data: existing } = await supabase
                  .from('products')
                  .select('id')
                  .eq('business_id', business.id)
                  .eq('efris_item_code', g.item_code)
                  .maybeSingle();
                if (existing) { skipped++; continue; }

                // Derive tax_category_code
                let taxCat = '01';
                if (g.is_exempt) taxCat = '03';
                else if (g.is_zero_rate || g.tax_rate === '0') taxCat = '02';

                const { data: product, error: pErr } = await supabase.from('products').insert({
                  business_id: business.id,
                  name: g.item_name,
                  description: g.description || null,
                  unit: g.unit_of_measure || '101',
                  is_service: g.is_service,
                  commodity_code: g.commodity_category_code || null,
                  commodity_name: g.commodity_category_name || null,
                  efris_item_code: g.item_code,
                  efris_product_code: g.item_code,
                  efris_registered_at: new Date().toISOString(),
                  efris_unit_code: g.unit_of_measure || '101',
                  tax_category_code: taxCat,
                  has_excise_tax: g.has_excise_tax,
                  excise_duty_code: g.excise_duty_code || null,
                }).select().single();

                if (pErr || !product) { skipped++; continue; }

                await supabase.from('inventory').insert({
                  branch_id: currentBranch.id,
                  product_id: product.id,
                  quantity: parseInt(g.stock) || 0,
                  selling_price: parseFloat(g.unit_price) || 0,
                  avg_cost_price: 0,
                  reorder_level: 5,
                });
                added++;
              }

              Alert.alert(
                'Import Complete ✅',
                `${added} product${added !== 1 ? 's' : ''} imported from EFRIS.${skipped > 0 ? `\n${skipped} already existed and were skipped.` : ''}`,
              );
              loadInventory();
            } catch (e: any) {
              Alert.alert('Error', e.message);
            } finally {
              setEfrisImporting(false);
            }
          },
        },
      ]
    );
  };

  const handleImport = async () => {
    if (!business || !currentBranch) return;
    setImporting(true);
    try {
      const rows = await importData(['Name', 'Selling Price']);
      if (!rows) { setImporting(false); return; }
      let added = 0;
      for (const row of rows) {
        const pName = (row['Name'] || '').trim();
        const price = parseFloat(row['Selling Price'] || '0');
        if (!pName || !price) continue;
        const { data: product, error: pErr } = await supabase.from('products').insert({
          business_id: business.id,
          name: pName,
          barcode: (row['Barcode'] || '').trim() || null,
        }).select().single();
        if (pErr || !product) continue;
        await supabase.from('inventory').insert({
          branch_id: currentBranch.id,
          product_id: product.id,
          quantity: parseInt(row['Quantity'] || '0') || 0,
          selling_price: price,
          avg_cost_price: parseFloat(row['Cost Price'] || '0') || 0,
          reorder_level: parseInt(row['Reorder Level'] || '5') || 5,
        });
        added++;
      }
      Alert.alert('Import Complete', `${added} product(s) imported.`);
      loadInventory();
    } catch (e: any) {
      Alert.alert('Import Error', e.message);
    } finally {
      setImporting(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
    <View style={styles.container}>
      {/* Summary Bar */}
      <View style={styles.summaryBar}>
        <TouchableOpacity
          style={[styles.summaryItem, activeFilter === 'all' && styles.summaryItemActive]}
          onPress={() => toggleFilter('all')}
        >
          <Text style={styles.summaryValue}>{items.length}</Text>
          <Text style={styles.summaryLabel}>Products</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.summaryItem, { borderColor: '#FF9800' }, activeFilter === 'low' && { backgroundColor: '#FF980022' }]}
          onPress={() => toggleFilter('low')}
        >
          <Text style={[styles.summaryValue, { color: '#FF9800' }]}>{lowStockCount}</Text>
          <Text style={styles.summaryLabel}>Low Stock</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.summaryItem, { borderColor: '#e94560' }, activeFilter === 'out' && { backgroundColor: '#e9456022' }]}
          onPress={() => toggleFilter('out')}
        >
          <Text style={[styles.summaryValue, { color: '#e94560' }]}>{outOfStockCount}</Text>
          <Text style={styles.summaryLabel}>Out of Stock</Text>
        </TouchableOpacity>
      </View>

      {/* Search */}
      <View style={styles.searchContainer}>
        <FontAwesome name="search" size={16} color="#666" style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search by name or barcode..."
          placeholderTextColor="#666"
          value={search}
          onChangeText={handleSearch}
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => handleSearch('')}>
            <FontAwesome name="times-circle" size={16} color="#666" />
          </TouchableOpacity>
        )}
      </View>

      {/* Export / Import Bar */}
      <View style={styles.ioBar}>
        <TouchableOpacity style={styles.ioBtn} onPress={() => handleExport('csv')} disabled={exporting}>
          {exporting ? <ActivityIndicator size="small" color="#4CAF50" /> : <FontAwesome name="file-text-o" size={14} color="#4CAF50" />}
          <Text style={styles.ioBtnText}>CSV</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.ioBtn} onPress={() => handleExport('xlsx')} disabled={exporting}>
          <FontAwesome name="file-excel-o" size={14} color="#2196F3" />
          <Text style={styles.ioBtnText}>Excel</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.ioBtn} onPress={handleImport} disabled={importing}>
          {importing ? <ActivityIndicator size="small" color="#FF9800" /> : <FontAwesome name="upload" size={14} color="#FF9800" />}
          <Text style={styles.ioBtnText}>Import</Text>
        </TouchableOpacity>
        {efrisEnabled && (
          <TouchableOpacity style={[styles.ioBtn, { borderColor: '#7C3AED33' }]} onPress={handleEfrisImport} disabled={efrisImporting}>
            {efrisImporting ? <ActivityIndicator size="small" color="#7C3AED" /> : <FontAwesome name="cloud-download" size={14} color="#7C3AED" />}
            <Text style={[styles.ioBtnText, { color: '#7C3AED' }]}>EFRIS</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Product List */}
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#e94560" />}
        renderItem={({ item }) => {
          const status = stockStatus(item);
          return (
            <TouchableOpacity
              style={styles.productCard}
              onPress={() => router.push({ pathname: '/product/[id]', params: { id: item.product_id } })}
            >
              <View style={styles.productLeft}>
                {item.image_url ? (
                  <Image source={{ uri: item.image_url }} style={styles.productThumb} />
                ) : (
                  <View style={[styles.stockIndicator, { backgroundColor: status.color }]} />
                )}
                <View style={styles.productInfo}>
                  <Text style={styles.productName}>{item.name}</Text>
                  {item.barcode && (
                    <Text style={styles.productBarcode}>
                      <FontAwesome name="barcode" size={11} color="#666" /> {item.barcode}
                    </Text>
                  )}
                  <Text style={styles.productPrice}>
                    Sell: {fmt(item.selling_price)} | Cost: {fmt(item.avg_cost_price)}
                  </Text>
                </View>
              </View>
              <View style={styles.productRight}>
                {item.is_service ? (
                  <View style={[styles.qtyBadge, { backgroundColor: '#2196F322', borderColor: '#2196F3' }]}>
                    <FontAwesome name="wrench" size={14} color="#2196F3" />
                    <Text style={[styles.qtyLabel, { color: '#2196F3' }]}>Service</Text>
                  </View>
                ) : (
                  <View style={[styles.qtyBadge, { backgroundColor: status.color + '22', borderColor: status.color }]}>
                    <Text style={[styles.qtyText, { color: status.color }]}>{item.quantity}</Text>
                    <Text style={[styles.qtyLabel, { color: status.color }]}>units</Text>
                  </View>
                )}
              </View>
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <FontAwesome name="cube" size={48} color="#333" />
            <Text style={styles.emptyTitle}>No products yet</Text>
            <Text style={styles.emptySubtitle}>Tap + to add your first product</Text>
          </View>
        }
      />

      {/* Add Product FAB */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => router.push('/product/new')}
      >
        <FontAwesome name="plus" size={24} color="#fff" />
      </TouchableOpacity>
    </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  summaryBar: {
    flexDirection: 'row',
    backgroundColor: '#16213e',
    paddingVertical: 12,
    paddingHorizontal: 16,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#0f3460',
  },
  summaryItem: {
    flex: 1,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#4CAF50',
    borderRadius: 10,
    paddingVertical: 8,
    backgroundColor: 'transparent',
  },
  summaryValue: { fontSize: 20, fontWeight: 'bold', color: '#4CAF50' },
  summaryLabel: { fontSize: 11, color: '#aaa', marginTop: 2 },
  summaryItemActive: { backgroundColor: '#4CAF5022' },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#16213e',
    margin: 12,
    borderRadius: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#0f3460',
  },
  searchIcon: { marginRight: 8 },
  searchInput: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 15,
    color: '#fff',
  },
  ioBar: {
    flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 12, marginBottom: 8, gap: 10,
    backgroundColor: 'transparent',
  },
  ioBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#16213e',
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: '#0f3460',
  },
  ioBtnText: { color: '#aaa', fontSize: 12, fontWeight: '600' },
  productCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#16213e',
    marginHorizontal: 12,
    marginBottom: 8,
    borderRadius: 12,
    padding: 14,
  },
  productLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    backgroundColor: 'transparent',
  },
  stockIndicator: {
    width: 4,
    height: 48,
    borderRadius: 2,
    marginRight: 12,
  },
  productThumb: { width: 48, height: 48, borderRadius: 10, marginRight: 12 },
  productInfo: { flex: 1, backgroundColor: 'transparent' },
  productName: { fontSize: 16, fontWeight: 'bold', color: '#fff' },
  productBarcode: { fontSize: 12, color: '#666', marginTop: 2 },
  productPrice: { fontSize: 12, color: '#aaa', marginTop: 3 },
  productRight: { alignItems: 'center', backgroundColor: 'transparent' },
  qtyBadge: {
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
    minWidth: 56,
  },
  qtyText: { fontSize: 20, fontWeight: 'bold' },
  qtyLabel: { fontSize: 11, marginTop: -2 },
  emptyState: {
    alignItems: 'center',
    paddingTop: 80,
    backgroundColor: 'transparent',
  },
  emptyTitle: { color: '#555', fontSize: 18, fontWeight: 'bold', marginTop: 16 },
  emptySubtitle: { color: '#444', fontSize: 14, marginTop: 6 },
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#e94560',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 6,
  },
});
