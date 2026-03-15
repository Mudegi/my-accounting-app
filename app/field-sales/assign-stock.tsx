import React, { useState, useCallback, useEffect } from 'react';
import {
  StyleSheet,
  TouchableOpacity,
  FlatList,
  TextInput,
  Alert,
  ActivityIndicator,
  ScrollView,
  Modal,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Text, View } from '@/components/Themed';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { assignStock, getAssignments, type FieldStockAssignment } from '@/lib/field-sales';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useFocusEffect, Redirect } from 'expo-router';

type User = { id: string; full_name: string; branch_name: string | null };
type Product = { id: string; name: string; quantity: number };

export default function AssignStockScreen() {
  const { business, branches, currentBranch, profile, fmt } = useAuth();
  const isAdmin = profile?.role === 'admin' || profile?.role === 'branch_manager';

  if (profile && !isAdmin) return <Redirect href="/" />;

  const [assignments, setAssignments] = useState<FieldStockAssignment[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Form state
  const [users, setUsers] = useState<User[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedUser, setSelectedUser] = useState('');
  const [selectedBranch, setSelectedBranch] = useState(currentBranch?.id || '');
  const [selectedProduct, setSelectedProduct] = useState('');
  const [qty, setQty] = useState('');
  const [notes, setNotes] = useState('');
  const [filterUser, setFilterUser] = useState('all');
  const [productSearch, setProductSearch] = useState('');

  const load = useCallback(async () => {
    if (!business) return;
    setLoading(true);
    const result = await getAssignments({
      businessId: business.id,
      userId: filterUser !== 'all' ? filterUser : undefined,
    });
    setAssignments(result.data);
    setLoading(false);
  }, [business, filterUser]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Load users for assignment
  useEffect(() => {
    if (!business) return;
    (async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name, branches(name)')
        .eq('business_id', business.id)
        .eq('is_active', true)
        .order('full_name');
      setUsers((data || []).map((u: any) => ({
        id: u.id,
        full_name: u.full_name,
        branch_name: u.branches?.name || null,
      })));
    })();
  }, [business]);

  // Load products when branch changes
  useEffect(() => {
    if (!selectedBranch) { setProducts([]); return; }
    (async () => {
      const { data } = await supabase
        .from('inventory')
        .select('product_id, quantity, products(name)')
        .eq('branch_id', selectedBranch)
        .gt('quantity', 0);
      setProducts((data || []).map((r: any) => ({
        id: r.product_id,
        name: r.products?.name || '?',
        quantity: r.quantity,
      })));
    })();
  }, [selectedBranch]);

  const handleAssign = async () => {
    if (!selectedUser) { Alert.alert('Error', 'Select a user'); return; }
    if (!selectedProduct) { Alert.alert('Error', 'Select a product'); return; }
    const qtyNum = parseInt(qty);
    if (!qtyNum || qtyNum < 1) { Alert.alert('Error', 'Enter a valid quantity'); return; }
    if (!business || !profile) return;

    setSaving(true);
    const result = await assignStock({
      businessId: business.id,
      branchId: selectedBranch,
      userId: selectedUser,
      productId: selectedProduct,
      qtyAssigned: qtyNum,
      assignedBy: profile.id,
      notes: notes.trim() || undefined,
    });
    setSaving(false);

    if (result.error) {
      Alert.alert('Error', result.error);
    } else {
      const userName = users.find(u => u.id === selectedUser)?.full_name || 'user';
      const prodName = products.find(p => p.id === selectedProduct)?.name || 'product';
      Alert.alert('Stock Assigned', `${qtyNum} × ${prodName} assigned to ${userName}.`);
      setShowForm(false);
      setSelectedUser(''); setSelectedProduct(''); setQty(''); setNotes(''); setProductSearch('');
      load();
    }
  };

  const statusColor = (s: string) => {
    if (s === 'active') return '#FF9800';
    if (s === 'partially_returned') return '#2196F3';
    if (s === 'returned') return '#4CAF50';
    return '#e94560';
  };

  const formatDate = (d: string) => {
    const date = new Date(d);
    return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
    <View style={styles.container}>
      {/* Assign Button */}
      <TouchableOpacity style={styles.addButton} onPress={() => setShowForm(true)}>
        <FontAwesome name="plus-circle" size={18} color="#fff" />
        <Text style={styles.addButtonText}>Assign Stock to User</Text>
      </TouchableOpacity>

      {/* User Filter */}
      {users.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12, maxHeight: 36 }}>
          <TouchableOpacity
            style={[styles.chip, filterUser === 'all' && styles.chipActive]}
            onPress={() => setFilterUser('all')}
          >
            <Text style={[styles.chipText, filterUser === 'all' && styles.chipTextActive]}>All Users</Text>
          </TouchableOpacity>
          {users.map(u => (
            <TouchableOpacity
              key={u.id}
              style={[styles.chip, filterUser === u.id && styles.chipActive]}
              onPress={() => setFilterUser(u.id)}
            >
              <Text style={[styles.chipText, filterUser === u.id && styles.chipTextActive]}>{u.full_name}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* Assignments List */}
      {loading ? (
        <ActivityIndicator color="#e94560" style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={assignments}
          keyExtractor={(a) => a.id}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.cardTop}>
                <View style={{ flex: 1, backgroundColor: 'transparent' }}>
                  <Text style={styles.cardProduct}>{item.product_name}</Text>
                  <Text style={styles.cardMeta}>
                    👤 {item.assigned_by_name} → {users.find(u => u.id === item.user_id)?.full_name || '?'}
                  </Text>
                  <Text style={styles.cardMeta}>📍 {item.branch_name} · {formatDate(item.assigned_at)}</Text>
                </View>
                <View style={[styles.statusBadge, { backgroundColor: statusColor(item.status) + '22', borderColor: statusColor(item.status) }]}>
                  <Text style={[styles.statusText, { color: statusColor(item.status) }]}>
                    {item.status.replace('_', ' ')}
                  </Text>
                </View>
              </View>

              <View style={styles.qtyRow}>
                <View style={styles.qtyBox}>
                  <Text style={styles.qtyLabel}>Assigned</Text>
                  <Text style={styles.qtyValue}>{item.qty_assigned}</Text>
                </View>
                <View style={styles.qtyBox}>
                  <Text style={styles.qtyLabel}>Returned</Text>
                  <Text style={[styles.qtyValue, { color: '#4CAF50' }]}>{item.qty_returned}</Text>
                </View>
                <View style={styles.qtyBox}>
                  <Text style={styles.qtyLabel}>Balance</Text>
                  <Text style={[styles.qtyValue, { color: '#FF9800' }]}>
                    {item.qty_assigned - item.qty_returned}
                  </Text>
                </View>
              </View>
              {item.notes && <Text style={styles.cardNote}>📝 {item.notes}</Text>}
            </View>
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <FontAwesome name="cubes" size={48} color="#333" />
              <Text style={styles.emptyText}>No stock assignments yet</Text>
              <Text style={styles.emptyHint}>Tap "Assign Stock to User" to get started</Text>
            </View>
          }
        />
      )}

      {/* Assignment Form Modal */}
      <Modal visible={showForm} animationType="slide" transparent>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <ScrollView>
              <Text style={styles.formTitle}>Assign Stock to Field User</Text>

              <Text style={styles.label}>Select User *</Text>
              <View style={styles.chipRow}>
                {users.map(u => (
                  <TouchableOpacity
                    key={u.id}
                    style={[styles.formChip, selectedUser === u.id && styles.formChipActive]}
                    onPress={() => setSelectedUser(u.id)}
                  >
                    <Text style={[styles.formChipText, selectedUser === u.id && { color: '#fff' }]}>
                      {u.full_name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.label}>From Branch *</Text>
              <View style={styles.chipRow}>
                {branches.map(b => (
                  <TouchableOpacity
                    key={b.id}
                    style={[styles.formChip, selectedBranch === b.id && styles.formChipActive]}
                    onPress={() => { setSelectedBranch(b.id); setSelectedProduct(''); }}
                  >
                    <Text style={[styles.formChipText, selectedBranch === b.id && { color: '#fff' }]}>{b.name}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.label}>Product *</Text>
              {selectedProduct ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'transparent' }}>
                  <View style={[styles.formChip, styles.formChipActive, { flexDirection: 'row', alignItems: 'center', gap: 8 }]}>
                    <Text style={{ color: '#fff', fontSize: 14, fontWeight: 'bold' }}>
                      {products.find(p => p.id === selectedProduct)?.name} ({products.find(p => p.id === selectedProduct)?.quantity})
                    </Text>
                  </View>
                  <TouchableOpacity onPress={() => { setSelectedProduct(''); setProductSearch(''); }}>
                    <FontAwesome name="times-circle" size={22} color="#e94560" />
                  </TouchableOpacity>
                </View>
              ) : (
                <>
                  <View style={styles.searchBox}>
                    <FontAwesome name="search" size={14} color="#555" />
                    <TextInput
                      style={styles.searchInput}
                      placeholder={selectedBranch ? 'Search product by name...' : 'Select a branch first'}
                      placeholderTextColor="#555"
                      value={productSearch}
                      onChangeText={setProductSearch}
                      editable={!!selectedBranch}
                    />
                    {productSearch.length > 0 && (
                      <TouchableOpacity onPress={() => setProductSearch('')}>
                        <FontAwesome name="times" size={14} color="#555" />
                      </TouchableOpacity>
                    )}
                  </View>
                  {products.length === 0 && selectedBranch ? (
                    <Text style={{ color: '#555', fontSize: 13, marginTop: 6 }}>No products with stock in this branch</Text>
                  ) : (
                    <View style={styles.productList}>
                      {products
                        .filter(p => !productSearch.trim() || p.name.toLowerCase().includes(productSearch.toLowerCase()))
                        .slice(0, 8)
                        .map(p => (
                          <TouchableOpacity
                            key={p.id}
                            style={styles.productItem}
                            onPress={() => { setSelectedProduct(p.id); setProductSearch(''); }}
                          >
                            <Text style={styles.productItemName}>{p.name}</Text>
                            <View style={styles.productQtyBadge}>
                              <Text style={styles.productQtyText}>{p.quantity} in stock</Text>
                            </View>
                          </TouchableOpacity>
                        ))
                      }
                      {products.filter(p => !productSearch.trim() || p.name.toLowerCase().includes(productSearch.toLowerCase())).length === 0 && productSearch.trim() && (
                        <Text style={{ color: '#555', fontSize: 13, paddingVertical: 8 }}>No products matching "{productSearch}"</Text>
                      )}
                      {products.filter(p => !productSearch.trim() || p.name.toLowerCase().includes(productSearch.toLowerCase())).length > 8 && (
                        <Text style={{ color: '#666', fontSize: 12, paddingVertical: 4 }}>Type to search... {products.length} products total</Text>
                      )}
                    </View>
                  )}
                </>
              )}

              <Text style={styles.label}>Quantity *</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. 50"
                placeholderTextColor="#555"
                value={qty}
                onChangeText={setQty}
                keyboardType="numeric"
              />

              <Text style={styles.label}>Notes (optional)</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. For Kampala market area"
                placeholderTextColor="#555"
                value={notes}
                onChangeText={setNotes}
              />

              <TouchableOpacity
                style={[styles.saveBtn, saving && { opacity: 0.6 }]}
                onPress={handleAssign}
                disabled={saving}
              >
                {saving ? <ActivityIndicator color="#fff" /> : (
                  <Text style={styles.saveBtnText}>Assign Stock</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowForm(false)}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e', padding: 16 },
  addButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#e94560', borderRadius: 12, padding: 14, marginBottom: 14, gap: 8 },
  addButtonText: { color: '#fff', fontWeight: 'bold', fontSize: 15 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 18, backgroundColor: '#16213e', borderWidth: 1, borderColor: '#0f3460', marginRight: 8 },
  chipActive: { backgroundColor: '#e94560', borderColor: '#e94560' },
  chipText: { color: '#aaa', fontSize: 12, fontWeight: '600' },
  chipTextActive: { color: '#fff' },
  card: { backgroundColor: '#16213e', borderRadius: 14, padding: 14, marginBottom: 10 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', backgroundColor: 'transparent' },
  cardProduct: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  cardMeta: { color: '#888', fontSize: 12, marginTop: 3 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, borderWidth: 1 },
  statusText: { fontSize: 11, fontWeight: 'bold', textTransform: 'capitalize' },
  qtyRow: { flexDirection: 'row', marginTop: 10, gap: 8, backgroundColor: 'transparent' },
  qtyBox: { flex: 1, backgroundColor: '#0f3460', borderRadius: 10, padding: 10, alignItems: 'center' },
  qtyLabel: { color: '#888', fontSize: 11 },
  qtyValue: { color: '#fff', fontSize: 18, fontWeight: 'bold', marginTop: 2 },
  cardNote: { color: '#aaa', fontSize: 12, marginTop: 8, fontStyle: 'italic' },
  empty: { alignItems: 'center', paddingTop: 60 },
  emptyText: { color: '#555', fontSize: 16, marginTop: 12 },
  emptyHint: { color: '#444', fontSize: 13, marginTop: 4 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#1a1a2e', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: '90%' },
  formTitle: { fontSize: 20, fontWeight: 'bold', color: '#fff', marginBottom: 16 },
  label: { fontSize: 13, color: '#aaa', marginBottom: 6, marginTop: 12 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, backgroundColor: 'transparent' },
  formChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: '#16213e', borderWidth: 1, borderColor: '#0f3460' },
  formChipActive: { backgroundColor: '#e94560', borderColor: '#e94560' },
  formChipText: { fontSize: 13, color: '#aaa' },
  input: { backgroundColor: '#16213e', borderRadius: 10, padding: 12, color: '#fff', fontSize: 15, borderWidth: 1, borderColor: '#0f3460', marginTop: 4 },
  saveBtn: { backgroundColor: '#4CAF50', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 20 },
  saveBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  cancelBtn: { padding: 14, alignItems: 'center', marginTop: 8 },
  cancelBtnText: { color: '#aaa', fontSize: 15 },
  searchBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#16213e', borderRadius: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: '#0f3460', gap: 8, marginTop: 4 },
  searchInput: { flex: 1, color: '#fff', fontSize: 15, paddingVertical: 12 },
  productList: { marginTop: 6, maxHeight: 240, backgroundColor: 'transparent' },
  productItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#16213e', borderRadius: 10, padding: 12, marginBottom: 6, borderWidth: 1, borderColor: '#0f3460' },
  productItemName: { color: '#fff', fontSize: 14, fontWeight: '600', flex: 1 },
  productQtyBadge: { backgroundColor: '#0f3460', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, marginLeft: 8 },
  productQtyText: { color: '#aaa', fontSize: 11, fontWeight: '600' },
});
