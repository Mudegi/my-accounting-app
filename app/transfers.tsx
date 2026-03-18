import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  TouchableOpacity,
  FlatList,
  TextInput,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Modal,
} from 'react-native';
import { Text, View } from '@/components/Themed';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useFocusEffect } from 'expo-router';
import { postStockTransferEntry } from '@/lib/accounting';

type Transfer = {
  id: string;
  status: string;
  created_at: string;
  notes: string | null;
  from_branch_id: string;
  to_branch_id: string;
  from_branch: string;
  to_branch: string;
  items_count: number;
};

type Product = { id: string; name: string; quantity: number };
type CartItem = { product_id: string; product_name: string; quantity: number; max_qty: number };

export default function TransfersScreen() {
  const { business, branches, currentBranch, profile } = useAuth();
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [toBranchId, setToBranchId] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  // Multi-product cart
  const [cart, setCart] = useState<CartItem[]>([]);
  const [productSearch, setProductSearch] = useState('');

  const otherBranches = branches.filter((b) => b.id !== currentBranch?.id);

  const logTransferAudit = useCallback(async ({
    action,
    transferId,
    branchId,
    oldData,
    newData,
  }: {
    action: string;
    transferId?: string | null;
    branchId?: string | null;
    oldData?: any;
    newData?: any;
  }) => {
    if (!business || !profile) return;

    const { error } = await supabase.from('audit_log').insert({
      business_id: business.id,
      branch_id: branchId ?? currentBranch?.id ?? null,
      user_id: profile.id,
      action,
      table_name: 'stock_transfers',
      record_id: transferId ?? null,
      old_data: oldData ?? null,
      new_data: newData ?? null,
    });

    if (error) {
      console.warn('Transfer audit log failed:', error.message);
    }
  }, [business, currentBranch, profile]);

  const load = useCallback(async () => {
    if (!business || !currentBranch) return;
    const { data } = await supabase
      .from('stock_transfers')
      .select(`
        id, status, created_at, notes, from_branch_id, to_branch_id,
        from_branch:branches!from_branch_id(name),
        to_branch:branches!to_branch_id(name),
        stock_transfer_items(id)
      `)
      .eq('business_id', business.id)
      .or(`from_branch_id.eq.${currentBranch.id},to_branch_id.eq.${currentBranch.id}`)
      .order('created_at', { ascending: false })
      .limit(20);

    if (data) {
      setTransfers(data.map((t: any) => ({
        id: t.id,
        status: t.status,
        created_at: t.created_at,
        notes: t.notes,
        from_branch_id: t.from_branch_id,
        to_branch_id: t.to_branch_id,
        from_branch: t.from_branch?.name || '?',
        to_branch: t.to_branch?.name || '?',
        items_count: t.stock_transfer_items?.length || 0,
      })));
    }
  }, [business, currentBranch]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  useEffect(() => {
    if (!showForm || !currentBranch) return;
    supabase
      .from('inventory')
      .select('product_id, quantity, products(id, name)')
      .eq('branch_id', currentBranch.id)
      .gt('quantity', 0)
      .then(({ data }) => {
        if (data) setProducts(data.map((r: any) => ({ id: r.product_id, name: r.products?.name, quantity: r.quantity })));
      });
  }, [showForm, currentBranch]);

  // Get remaining available qty for a product (stock minus what's already in cart)
  const getAvailable = (productId: string) => {
    const product = products.find(p => p.id === productId);
    if (!product) return 0;
    const inCart = cart.find(c => c.product_id === productId)?.quantity || 0;
    return product.quantity - inCart;
  };

  const addToCart = (product: Product) => {
    const available = getAvailable(product.id);
    if (available <= 0) {
      Alert.alert('No Stock', 'All available stock for this product is already in the cart.');
      return;
    }
    setCart(prev => {
      const existing = prev.find(c => c.product_id === product.id);
      if (existing) {
        return prev.map(c => c.product_id === product.id ? { ...c, quantity: c.quantity + 1 } : c);
      }
      return [...prev, { product_id: product.id, product_name: product.name, quantity: 1, max_qty: product.quantity }];
    });
    setProductSearch('');
  };

  const updateCartQty = (productId: string, delta: number) => {
    setCart(prev =>
      prev
        .map(c => c.product_id === productId
          ? { ...c, quantity: Math.max(0, Math.min(c.max_qty, c.quantity + delta)) }
          : c
        )
        .filter(c => c.quantity > 0)
    );
  };

  const removeFromCart = (productId: string) => {
    setCart(prev => prev.filter(c => c.product_id !== productId));
  };

  const handleCreate = async () => {
    if (!toBranchId) { Alert.alert('Error', 'Select a destination branch'); return; }
    if (cart.length === 0) { Alert.alert('Error', 'Add at least one product to the transfer'); return; }
    if (!business || !currentBranch || !profile) return;

    // Validate all quantities
    for (const item of cart) {
      const product = products.find(p => p.id === item.product_id);
      if (product && item.quantity > product.quantity) {
        Alert.alert('Error', `Only ${product.quantity} units of ${item.product_name} available`);
        return;
      }
    }

    setSaving(true);
    try {
      // 1. Calculate total value by deducting from source branch FIRST
      // This is atomic and ensures we have the value before creating the transfer record
      let totalValue = 0;
      const results = [];
      for (const item of cart) {
        const { data: avcoValue, error: decrError } = await supabase.rpc('decrement_inventory', {
          p_branch_id: currentBranch.id,
          p_product_id: item.product_id,
          p_quantity: item.quantity,
        });
        if (decrError) throw decrError;
        
        const unitCost = Number(avcoValue) || 0;
        totalValue += unitCost * item.quantity;
        results.push({ ...item, unitCost });
      }

      // 2. Insert the transfer record with the value already in notes
      const valueTag = `[VALUE:${totalValue.toFixed(2)}]`;
      const finalNotes = (notes.trim() ? notes.trim() + ' ' : '') + valueTag;

      const { data: transfer, error } = await supabase
        .from('stock_transfers')
        .insert({
          business_id: business.id,
          from_branch_id: currentBranch.id,
          to_branch_id: toBranchId,
          requested_by: profile.id,
          status: 'in_transit',
          notes: finalNotes,
        })
        .select()
        .single();

      if (error) throw error;

      // 3. Insert items with their snapshotted unit_cost
      const transferItems = results.map(r => ({
        transfer_id: transfer.id,
        product_id: r.product_id,
        quantity: r.quantity,
        unit_cost: r.unitCost, // Requires the column from accounting_fixes.sql
      }));
      
      const { error: itemsError } = await supabase.from('stock_transfer_items').insert(transferItems);
      if (itemsError) throw itemsError;

      // 4. Post accounting entry
      const destBranchName = otherBranches.find(b => b.id === toBranchId)?.name || '?';
      await postStockTransferEntry({
        businessId: business.id,
        branchId: currentBranch.id,
        transferId: transfer.id,
        value: totalValue,
        type: 'send',
        otherBranchName: destBranchName,
        userId: profile.id,
      });

      await logTransferAudit({
        action: 'stock_transfer_sent',
        transferId: transfer.id,
        branchId: currentBranch.id,
        newData: {
          from_branch_id: currentBranch.id,
          to_branch_id: toBranchId,
          total_value: totalValue,
          item_count: results.length,
          items: results.map((item) => ({
            product_id: item.product_id,
            product_name: item.product_name,
            quantity: item.quantity,
            unit_cost: item.unitCost,
          })),
        },
      });

      const itemsSummary = cart.map(c => `${c.quantity}× ${c.product_name}`).join('\n');
      Alert.alert('Transfer Sent', `Stock is now "In Transit".\n\n${itemsSummary}`);
      setShowForm(false);
      setToBranchId(''); setCart([]); setNotes(''); setProductSearch('');
      load();
    } catch (err: any) {
      console.error('Transfer creation error:', err);
      Alert.alert('Error', err?.message || 'Failed to create transfer');
    } finally {
      setSaving(false);
    }
  };

  const handleReceive = async (transferId: string) => {
    const transfer = transfers.find((t) => t.id === transferId);
    if (!transfer || !currentBranch || !business) return;

    if (transfer.to_branch_id !== currentBranch.id) {
      void logTransferAudit({
        action: 'stock_transfer_receipt_wrong_branch_attempt',
        transferId,
        branchId: currentBranch.id,
        newData: {
          expected_branch_id: transfer.to_branch_id,
          actual_branch_id: currentBranch.id,
          from_branch_id: transfer.from_branch_id,
          to_branch_id: transfer.to_branch_id,
        },
      });
      Alert.alert('Wrong Branch', 'Switch to the destination branch to confirm receipt for this transfer.');
      return;
    }

    Alert.alert(
      'Confirm Receipt',
      'Confirm you have received this stock? It will be added to your inventory.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm Receipt',
          onPress: async () => {
            setSaving(true);
            let receiptItems: any[] = [];
            let totalValue = 0;
            try {
              // 1. Get items to receive
              const { data: items, error: itemsError } = await supabase
                .from('stock_transfer_items')
                .select('*, products(name)')
                .eq('transfer_id', transferId);

              if (itemsError) {
                if (itemsError.message?.includes('column "unit_cost" does not exist')) {
                  throw new Error('Database column "unit_cost" missing. Please run accounting_fixes.sql in your Supabase SQL editor.');
                }
                throw itemsError;
              }
              if (!items || items.length === 0) throw new Error('No items found in this transfer record. It may have been created incorrectly.');
              receiptItems = items;

              // Debug: Show processing count
              console.log(`Processing receipt for ${items.length} items...`);

              // 2. Increment inventory for each item
              for (const item of items) {
                // Use stored unit_cost if available, else try to infer from notes value (fallback)
                const unitCost = item.unit_cost || 0;
                
                const { error: rpcError } = await supabase.rpc('increment_inventory', {
                  p_branch_id: transfer.to_branch_id,
                  p_product_id: item.product_id,
                  p_quantity: item.quantity,
                  p_unit_cost: unitCost > 0 ? unitCost : null,
                });
                if (rpcError) throw rpcError;
              }

              // 3. Extract value from notes for accounting
              const valueMatch = transfer.notes?.match(/\[VALUE:([\d.]+)\]/);
              totalValue = valueMatch ? parseFloat(valueMatch[1]) : 0;

              // 4. Post accounting entry
              if (totalValue > 0) {
                await postStockTransferEntry({
                  businessId: business.id,
                  branchId: currentBranch.id,
                  transferId: transferId,
                  value: totalValue,
                  type: 'receive',
                  otherBranchName: transfer.from_branch,
                  userId: profile?.id,
                });
              }

              // 5. Mark as received
              const { error: updateError } = await supabase
                .from('stock_transfers')
                .update({ status: 'received', approved_by: profile?.id })
                .eq('id', transferId);
              
              if (updateError) throw updateError;

              await logTransferAudit({
                action: 'stock_transfer_received',
                transferId,
                branchId: transfer.to_branch_id,
                oldData: {
                  status: 'in_transit',
                },
                newData: {
                  status: 'received',
                  from_branch_id: transfer.from_branch_id,
                  to_branch_id: transfer.to_branch_id,
                  receiver_branch_id: currentBranch.id,
                  total_value: totalValue,
                  item_count: receiptItems.length,
                  items: receiptItems.map((item) => ({
                    product_id: item.product_id,
                    product_name: item.products?.name || null,
                    quantity: item.quantity,
                    unit_cost: item.unit_cost || 0,
                  })),
                },
              });

              Alert.alert('Success ✅', 'Stock has been added to your inventory.');
              load();
            } catch (err: any) {
              console.error('Receipt error:', err);
              await logTransferAudit({
                action: 'stock_transfer_receipt_failed',
                transferId,
                branchId: currentBranch.id,
                newData: {
                  from_branch_id: transfer.from_branch_id,
                  to_branch_id: transfer.to_branch_id,
                  receiver_branch_id: currentBranch.id,
                  total_value: totalValue,
                  item_count: receiptItems.length,
                  items: receiptItems.map((item) => ({
                    product_id: item.product_id,
                    product_name: item.products?.name || null,
                    quantity: item.quantity,
                    unit_cost: item.unit_cost || 0,
                  })),
                  error: err?.message || 'Unknown receipt error',
                },
              });
              Alert.alert('Receipt Failed', err?.message || 'Could not process receipt');
            } finally {
              setSaving(false);
            }
          }
        }
      ]
    );
  };

  const statusColor = (status: string) => {
    if (status === 'received') return '#4CAF50';
    if (status === 'in_transit') return '#FF9800';
    if (status === 'cancelled') return '#e94560';
    return '#aaa';
  };

  const filteredProducts = products.filter(p =>
    (!productSearch.trim() || p.name.toLowerCase().includes(productSearch.toLowerCase())) &&
    getAvailable(p.id) > 0
  );

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
    <View style={styles.container}>
      {business && otherBranches.length > 0 && (
        <TouchableOpacity style={styles.addButton} onPress={() => setShowForm(true)}>
          <FontAwesome name="exchange" size={16} color="#fff" />
          <Text style={styles.addButtonText}>Send Stock to Another Branch</Text>
        </TouchableOpacity>
      )}

      <FlatList
        data={transfers}
        keyExtractor={(t) => t.id}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.cardTop}>
              <View style={styles.cardRoute}>
                <Text style={styles.routeText}>{item.from_branch}</Text>
                <FontAwesome name="arrow-right" size={14} color="#aaa" style={{ marginHorizontal: 8 }} />
                <Text style={styles.routeText}>{item.to_branch}</Text>
              </View>
              <View style={[styles.statusBadge, { backgroundColor: statusColor(item.status) + '33', borderColor: statusColor(item.status) }]}>
                <Text style={[styles.statusText, { color: statusColor(item.status) }]}>{item.status.replace('_', ' ')}</Text>
              </View>
            </View>
            <Text style={styles.cardMeta}>{item.items_count} product{item.items_count !== 1 ? 's' : ''}</Text>
            {item.notes && <Text style={styles.cardNote}>{item.notes}</Text>}
            <Text style={styles.cardDate}>{new Date(item.created_at).toLocaleDateString()}</Text>
            {item.status === 'in_transit' && item.to_branch_id === currentBranch?.id && (
              <TouchableOpacity style={styles.receiveBtn} onPress={() => handleReceive(item.id)}>
                <Text style={styles.receiveBtnText}>✅ Confirm Receipt</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <FontAwesome name="exchange" size={48} color="#333" />
            <Text style={styles.emptyText}>No transfers yet</Text>
          </View>
        }
      />

      {/* Transfer Form Modal */}
      <Modal visible={showForm} animationType="slide" transparent>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <ScrollView>
              <Text style={styles.formTitle}>Send Stock Transfer</Text>

              <Text style={styles.label}>To Branch *</Text>
              <View style={styles.chipRow}>
                {otherBranches.map((b) => (
                  <TouchableOpacity
                    key={b.id}
                    style={[styles.chip, toBranchId === b.id && styles.chipActive]}
                    onPress={() => setToBranchId(b.id)}
                  >
                    <Text style={[styles.chipText, toBranchId === b.id && styles.chipTextActive]}>{b.name}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Product Search + Cart */}
              <Text style={[styles.label, { marginTop: 14 }]}>Products *</Text>

              {/* Cart items */}
              {cart.length > 0 && (
                <View style={styles.cartSection}>
                  {cart.map(item => (
                    <View key={item.product_id} style={styles.cartItem}>
                      <View style={{ flex: 1, backgroundColor: 'transparent' }}>
                        <Text style={styles.cartItemName}>{item.product_name}</Text>
                      </View>
                      <View style={styles.qtyControls}>
                        <TouchableOpacity style={styles.qtyBtn} onPress={() => updateCartQty(item.product_id, -1)}>
                          <FontAwesome name="minus" size={10} color="#fff" />
                        </TouchableOpacity>
                        <Text style={styles.qtyText}>{item.quantity}</Text>
                        <TouchableOpacity
                          style={[styles.qtyBtn, { backgroundColor: '#4CAF50' }]}
                          onPress={() => updateCartQty(item.product_id, 1)}
                        >
                          <FontAwesome name="plus" size={10} color="#fff" />
                        </TouchableOpacity>
                      </View>
                      <TouchableOpacity onPress={() => removeFromCart(item.product_id)} style={{ paddingLeft: 10 }}>
                        <FontAwesome name="times-circle" size={18} color="#e94560" />
                      </TouchableOpacity>
                    </View>
                  ))}
                  <Text style={styles.cartSummary}>
                    {cart.length} product{cart.length !== 1 ? 's' : ''} · {cart.reduce((s, c) => s + c.quantity, 0)} total units
                  </Text>
                </View>
              )}

              {/* Search input */}
              <View style={styles.searchBox}>
                <FontAwesome name="search" size={14} color="#555" />
                <TextInput
                  style={styles.searchInput}
                  placeholder="Search product to add..."
                  placeholderTextColor="#555"
                  value={productSearch}
                  onChangeText={setProductSearch}
                />
                {productSearch.length > 0 && (
                  <TouchableOpacity onPress={() => setProductSearch('')}>
                    <FontAwesome name="times" size={14} color="#555" />
                  </TouchableOpacity>
                )}
              </View>

              {/* Filtered product results */}
              <ScrollView style={styles.productList} nestedScrollEnabled showsVerticalScrollIndicator={false}>
                {filteredProducts.slice(0, 8).map(p => (
                  <TouchableOpacity
                    key={p.id}
                    style={styles.productItem}
                    onPress={() => addToCart(p)}
                  >
                    <Text style={styles.productItemName}>{p.name}</Text>
                    <View style={styles.productQtyBadge}>
                      <Text style={styles.productQtyText}>{getAvailable(p.id)} avail</Text>
                    </View>
                    <FontAwesome name="plus-circle" size={20} color="#4CAF50" style={{ marginLeft: 8 }} />
                  </TouchableOpacity>
                ))}
                {filteredProducts.length === 0 && productSearch.trim() && (
                  <Text style={{ color: '#555', fontSize: 13, paddingVertical: 8 }}>No products matching "{productSearch}"</Text>
                )}
                {filteredProducts.length > 8 && (
                  <Text style={{ color: '#666', fontSize: 12, paddingVertical: 4 }}>Type to search... {products.length} products total</Text>
                )}
              </ScrollView>

              <Text style={[styles.label, { marginTop: 14 }]}>Notes (optional)</Text>
              <TextInput style={styles.input} placeholder="e.g. Restocking for weekend" placeholderTextColor="#555" value={notes} onChangeText={setNotes} />

              <TouchableOpacity
                style={[styles.saveBtn, saving && { opacity: 0.6 }]}
                onPress={handleCreate}
                disabled={saving}
              >
                {saving ? <ActivityIndicator color="#fff" /> : (
                  <Text style={styles.saveBtnText}>
                    Send Transfer ({cart.reduce((s, c) => s + c.quantity, 0)} units)
                  </Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity style={styles.cancelBtn} onPress={() => { setShowForm(false); setCart([]); setProductSearch(''); }}>
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
  card: { backgroundColor: '#16213e', borderRadius: 12, padding: 14, marginBottom: 10 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'transparent' },
  cardRoute: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'transparent' },
  routeText: { color: '#fff', fontSize: 14, fontWeight: 'bold' },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, borderWidth: 1 },
  statusText: { fontSize: 11, fontWeight: 'bold', textTransform: 'capitalize' },
  cardMeta: { color: '#888', fontSize: 12, marginTop: 6 },
  cardNote: { color: '#aaa', fontSize: 13, marginTop: 4 },
  cardDate: { color: '#555', fontSize: 12, marginTop: 4 },
  receiveBtn: { backgroundColor: '#2d6a4f', borderRadius: 8, padding: 10, alignItems: 'center', marginTop: 10 },
  receiveBtnText: { color: '#fff', fontWeight: 'bold' },
  empty: { alignItems: 'center', paddingTop: 40 },
  emptyText: { color: '#555', fontSize: 16, marginTop: 12 },
  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#1a1a2e', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: '92%' },
  formTitle: { fontSize: 20, fontWeight: 'bold', color: '#fff', marginBottom: 16 },
  label: { color: '#aaa', fontSize: 13, marginBottom: 6 },
  chipRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', backgroundColor: 'transparent' },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 18, backgroundColor: '#16213e', borderWidth: 1, borderColor: '#0f3460', marginBottom: 6 },
  chipActive: { backgroundColor: '#e94560', borderColor: '#e94560' },
  chipText: { color: '#aaa', fontSize: 13 },
  chipTextActive: { color: '#fff', fontWeight: 'bold' },
  input: { backgroundColor: '#16213e', borderRadius: 10, padding: 12, color: '#fff', fontSize: 15, borderWidth: 1, borderColor: '#0f3460' },
  // Cart
  cartSection: { backgroundColor: '#0f3460', borderRadius: 12, padding: 10, marginBottom: 10 },
  cartItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#16213e', backgroundColor: 'transparent' },
  cartItemName: { color: '#fff', fontSize: 14, fontWeight: '600' },
  qtyControls: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'transparent' },
  qtyBtn: { backgroundColor: '#e94560', width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  qtyText: { color: '#fff', fontSize: 15, fontWeight: 'bold', minWidth: 20, textAlign: 'center' },
  cartSummary: { color: '#aaa', fontSize: 12, marginTop: 8, textAlign: 'center' },
  // Search
  searchBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#16213e', borderRadius: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: '#0f3460', gap: 8 },
  searchInput: { flex: 1, color: '#fff', fontSize: 15, paddingVertical: 12 },
  productList: { marginTop: 6, maxHeight: 220, backgroundColor: 'transparent', overflow: 'hidden' },
  productItem: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#16213e', borderRadius: 10, padding: 12, marginBottom: 6, borderWidth: 1, borderColor: '#0f3460' },
  productItemName: { color: '#fff', fontSize: 14, fontWeight: '600', flex: 1 },
  productQtyBadge: { backgroundColor: '#0f3460', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  productQtyText: { color: '#aaa', fontSize: 11, fontWeight: '600' },
  // Buttons
  saveBtn: { backgroundColor: '#4CAF50', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 16 },
  saveBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  cancelBtn: { padding: 14, alignItems: 'center', marginTop: 8 },
  cancelBtnText: { color: '#aaa', fontSize: 15 },
});
