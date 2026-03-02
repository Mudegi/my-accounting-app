import React, { useState, useCallback } from 'react';
import {
  StyleSheet,
  TouchableOpacity,
  FlatList,
  TextInput,
  Alert,
  Modal,
  ActivityIndicator,
  RefreshControl,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Text, View } from '@/components/Themed';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useFocusEffect } from 'expo-router';

type LowStockItem = {
  inventory_id: string;
  product_id: string;
  product_name: string;
  barcode: string | null;
  quantity: number;
  reorder_level: number;
  selling_price: number;
  avg_cost_price: number;
  branch_id: string;
  branch_name: string;
};

export default function LowStockScreen() {
  const { business, currentBranch, branches, profile, fmt } = useAuth();
  const isAdmin = profile?.role === 'admin';

  const [items, setItems] = useState<LowStockItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<'critical' | 'low' | 'all'>('all');

  // Edit reorder level
  const [editingItem, setEditingItem] = useState<LowStockItem | null>(null);
  const [newReorderLevel, setNewReorderLevel] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!business) return;

    try {
      let query = supabase
        .from('inventory')
        .select(`
          id,
          product_id,
          quantity,
          reorder_level,
          selling_price,
          avg_cost_price,
          branch_id,
          products(name, barcode),
          branches(name)
        `)
        .eq('branches.business_id', business.id);

      // For non-admin, only show current branch
      if (!isAdmin && currentBranch) {
        query = query.eq('branch_id', currentBranch.id);
      }

      const { data, error } = await query;
      if (error) throw error;

      if (data) {
        const lowItems: LowStockItem[] = data
          .filter((inv: any) => {
            const reorderLevel = inv.reorder_level || 5;
            return inv.quantity <= reorderLevel;
          })
          .map((inv: any) => ({
            inventory_id: inv.id,
            product_id: inv.product_id,
            product_name: inv.products?.name || 'Unknown',
            barcode: inv.products?.barcode || null,
            quantity: inv.quantity,
            reorder_level: inv.reorder_level || 5,
            selling_price: inv.selling_price || 0,
            avg_cost_price: inv.avg_cost_price || 0,
            branch_id: inv.branch_id,
            branch_name: inv.branches?.name || 'Unknown',
          }))
          .sort((a: LowStockItem, b: LowStockItem) => a.quantity - b.quantity);

        setItems(lowItems);
      }
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setLoading(false);
    }
  }, [business, currentBranch, isAdmin]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const updateReorderLevel = async () => {
    if (!editingItem) return;
    const level = parseInt(newReorderLevel);
    if (isNaN(level) || level < 0) {
      Alert.alert('Error', 'Enter a valid number');
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase
        .from('inventory')
        .update({ reorder_level: level })
        .eq('id', editingItem.inventory_id);

      if (error) throw error;

      Alert.alert('Updated', `Reorder level set to ${level}`);
      setEditingItem(null);
      load();
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setSaving(false);
    }
  };

  const filtered = items.filter(item => {
    // Filter by severity
    if (filter === 'critical' && item.quantity > 0) return false;
    if (filter === 'low' && item.quantity === 0) return false;

    // Search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        item.product_name.toLowerCase().includes(q) ||
        (item.barcode && item.barcode.includes(q)) ||
        item.branch_name.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const outOfStock = items.filter(i => i.quantity === 0).length;
  const lowStock = items.filter(i => i.quantity > 0).length;

  const getSeverity = (item: LowStockItem): 'critical' | 'warning' | 'caution' => {
    if (item.quantity === 0) return 'critical';
    if (item.quantity <= item.reorder_level / 2) return 'warning';
    return 'caution';
  };

  const severityColor = {
    critical: '#e94560',
    warning: '#FF9800',
    caution: '#FFD700',
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
      {/* Summary */}
      <View style={styles.summaryCard}>
        <View style={styles.summaryRow}>
          <View style={styles.summaryItem}>
            <Text style={[styles.summaryValue, { color: '#e94560' }]}>{outOfStock}</Text>
            <Text style={styles.summaryLabel}>Out of Stock</Text>
          </View>
          <View style={styles.summaryItem}>
            <Text style={[styles.summaryValue, { color: '#FF9800' }]}>{lowStock}</Text>
            <Text style={styles.summaryLabel}>Low Stock</Text>
          </View>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryValue}>{items.length}</Text>
            <Text style={styles.summaryLabel}>Total Alerts</Text>
          </View>
        </View>
      </View>

      {/* Filter chips */}
      <View style={styles.filterRow}>
        {(['all', 'critical', 'low'] as const).map((f) => (
          <TouchableOpacity
            key={f}
            style={[styles.filterChip, filter === f && styles.filterChipActive]}
            onPress={() => setFilter(f)}
          >
            <Text style={[styles.filterChipText, filter === f && { color: '#fff' }]}>
              {f === 'all' ? 'All' : f === 'critical' ? '🔴 Out of Stock' : '🟡 Low Stock'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Search */}
      <View style={styles.searchRow}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search products..."
          placeholderTextColor="#666"
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
      </View>

      {/* List */}
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.inventory_id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#e94560" />}
        renderItem={({ item }) => {
          const severity = getSeverity(item);
          return (
            <TouchableOpacity
              style={[styles.card, { borderLeftWidth: 4, borderLeftColor: severityColor[severity] }]}
              onPress={() => {
                setEditingItem(item);
                setNewReorderLevel(item.reorder_level.toString());
              }}
            >
              <View style={styles.cardBody}>
                <View style={styles.cardInfo}>
                  <Text style={styles.cardName}>{item.product_name}</Text>
                  {item.barcode && <Text style={styles.cardSub}>📦 {item.barcode}</Text>}
                  {isAdmin && <Text style={styles.cardSub}>📍 {item.branch_name}</Text>}
                  <Text style={styles.cardSub}>Reorder at: {item.reorder_level} units</Text>
                </View>
                <View style={styles.cardRight}>
                  <Text style={[styles.stockCount, { color: severityColor[severity] }]}>
                    {item.quantity}
                  </Text>
                  <Text style={styles.stockLabel}>
                    {item.quantity === 0 ? 'OUT' : 'in stock'}
                  </Text>
                  <Text style={styles.priceLabel}>{fmt(item.selling_price)}</Text>
                </View>
              </View>
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <FontAwesome name="check-circle" size={48} color="#4CAF50" />
            <Text style={styles.emptyText}>All stocked up!</Text>
            <Text style={styles.emptyHint}>No items below reorder level</Text>
          </View>
        }
      />

      {/* Edit Reorder Level Modal */}
      <Modal visible={!!editingItem} animationType="slide" transparent>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Set Reorder Level</Text>
            <Text style={styles.payInfo}>{editingItem?.product_name}</Text>
            <Text style={styles.payInfo}>
              Current stock: {editingItem?.quantity} · Current level: {editingItem?.reorder_level}
            </Text>

            <Text style={styles.label}>New Reorder Level</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. 10"
              placeholderTextColor="#555"
              value={newReorderLevel}
              onChangeText={setNewReorderLevel}
              keyboardType="numeric"
            />
            <Text style={styles.hint}>
              You'll be alerted when stock drops to or below this number
            </Text>

            <TouchableOpacity
              style={[styles.saveBtn, saving && { opacity: 0.6 }]}
              onPress={updateReorderLevel}
              disabled={saving}
            >
              {saving ? <ActivityIndicator color="#fff" /> : (
                <Text style={styles.saveBtnText}>Update Level</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity style={styles.cancelBtn} onPress={() => setEditingItem(null)}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  summaryCard: {
    backgroundColor: '#16213e', margin: 16, marginBottom: 8, borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: '#0f3460',
  },
  summaryRow: {
    flexDirection: 'row', justifyContent: 'space-around', backgroundColor: 'transparent',
  },
  summaryItem: { alignItems: 'center', backgroundColor: 'transparent' },
  summaryValue: { fontSize: 24, fontWeight: 'bold', color: '#fff' },
  summaryLabel: { fontSize: 11, color: '#aaa', marginTop: 4 },
  filterRow: {
    flexDirection: 'row', paddingHorizontal: 16, gap: 8, marginBottom: 8,
    backgroundColor: 'transparent',
  },
  filterChip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16,
    backgroundColor: '#16213e', borderWidth: 1, borderColor: '#0f3460',
  },
  filterChipActive: { backgroundColor: '#e94560', borderColor: '#e94560' },
  filterChipText: { fontSize: 12, color: '#aaa' },
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
  stockCount: { fontSize: 28, fontWeight: 'bold' },
  stockLabel: { fontSize: 11, color: '#aaa' },
  priceLabel: { fontSize: 12, color: '#888', marginTop: 4 },
  emptyState: { alignItems: 'center', paddingTop: 60, backgroundColor: 'transparent' },
  emptyText: { color: '#4CAF50', fontSize: 18, marginTop: 12, fontWeight: 'bold' },
  emptyHint: { color: '#666', fontSize: 13, marginTop: 4 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalContent: {
    backgroundColor: '#1a1a2e', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 20, maxHeight: '80%',
  },
  modalTitle: { fontSize: 20, fontWeight: 'bold', color: '#fff', marginBottom: 8 },
  payInfo: { color: '#aaa', fontSize: 14, marginBottom: 4 },
  label: { fontSize: 13, color: '#aaa', marginBottom: 4, marginTop: 12 },
  input: {
    backgroundColor: '#16213e', borderRadius: 10, padding: 12, color: '#fff',
    fontSize: 15, borderWidth: 1, borderColor: '#0f3460',
  },
  hint: { color: '#666', fontSize: 12, marginTop: 4 },
  saveBtn: {
    backgroundColor: '#4CAF50', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 20,
  },
  saveBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  cancelBtn: { padding: 14, alignItems: 'center', marginTop: 8 },
  cancelBtnText: { color: '#aaa', fontSize: 15 },
});
