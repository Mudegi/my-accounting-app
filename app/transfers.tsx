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
} from 'react-native';
import { Text, View } from '@/components/Themed';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useFocusEffect } from 'expo-router';

type Transfer = {
  id: string;
  status: string;
  created_at: string;
  notes: string | null;
  from_branch: string;
  to_branch: string;
  items_count: number;
};

type Product = { id: string; name: string; quantity: number };

export default function TransfersScreen() {
  const { business, branches, currentBranch, profile } = useAuth();
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [toBranchId, setToBranchId] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedProduct, setSelectedProduct] = useState('');
  const [qty, setQty] = useState('1');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const otherBranches = branches.filter((b) => b.id !== currentBranch?.id);

  const load = useCallback(async () => {
    if (!business || !currentBranch) return;
    const { data } = await supabase
      .from('stock_transfers')
      .select(`
        id, status, created_at, notes,
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

  const handleCreate = async () => {
    if (!toBranchId) { Alert.alert('Error', 'Select a destination branch'); return; }
    if (!selectedProduct) { Alert.alert('Error', 'Select a product'); return; }
    const qtyNum = parseInt(qty);
    if (!qtyNum || qtyNum < 1) { Alert.alert('Error', 'Enter a valid quantity'); return; }
    if (!business || !currentBranch || !profile) return;

    const product = products.find((p) => p.id === selectedProduct);
    if (product && qtyNum > product.quantity) {
      Alert.alert('Error', `Only ${product.quantity} units available in this branch`);
      return;
    }

    setSaving(true);
    const { data: transfer, error } = await supabase
      .from('stock_transfers')
      .insert({
        business_id: business.id,
        from_branch_id: currentBranch.id,
        to_branch_id: toBranchId,
        requested_by: profile.id,
        status: 'in_transit',
        notes: notes.trim() || null,
      })
      .select()
      .single();

    if (error) { Alert.alert('Error', error.message); setSaving(false); return; }

    await supabase.from('stock_transfer_items').insert({
      transfer_id: transfer.id,
      product_id: selectedProduct,
      quantity: qtyNum,
    });

    // Deduct from source branch immediately
    await supabase.rpc('decrement_inventory', {
      p_branch_id: currentBranch.id,
      p_product_id: selectedProduct,
      p_quantity: qtyNum,
    });

    Alert.alert('Transfer Sent', 'Stock is now "In Transit". Destination branch must confirm receipt.');
    setShowForm(false);
    setToBranchId(''); setSelectedProduct(''); setQty('1'); setNotes('');
    load();
    setSaving(false);
  };

  const handleReceive = async (transferId: string) => {
    const transfer = transfers.find((t) => t.id === transferId);
    if (!transfer || !currentBranch) return;

    Alert.alert(
      'Confirm Receipt',
      'Confirm you have received this stock? It will be added to your inventory.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm Receipt',
          onPress: async () => {
            // Get transfer items
            const { data: items } = await supabase
              .from('stock_transfer_items')
              .select('*')
              .eq('transfer_id', transferId);

            // Add to destination inventory
            for (const item of (items || [])) {
              await supabase.rpc('increment_inventory', {
                p_branch_id: currentBranch.id,
                p_product_id: item.product_id,
                p_quantity: item.quantity,
              });
            }

            await supabase
              .from('stock_transfers')
              .update({ status: 'received', approved_by: profile?.id })
              .eq('id', transferId);

            load();
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

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
    <View style={styles.container}>
      {!showForm && otherBranches.length > 0 && (
        <TouchableOpacity style={styles.addButton} onPress={() => setShowForm(true)}>
          <FontAwesome name="exchange" size={16} color="#fff" />
          <Text style={styles.addButtonText}>Send Stock to Another Branch</Text>
        </TouchableOpacity>
      )}

      {showForm && (
        <View style={styles.formCard}>
          <Text style={styles.formTitle}>Send Stock</Text>
          <Text style={styles.label}>To Branch</Text>
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

          <Text style={[styles.label, { marginTop: 12 }]}>Product</Text>
          <View style={[styles.chipRow, { flexWrap: 'wrap' }]}>
            {products.map((p) => (
              <TouchableOpacity
                key={p.id}
                style={[styles.chip, selectedProduct === p.id && styles.chipActive]}
                onPress={() => setSelectedProduct(p.id)}
              >
                <Text style={[styles.chipText, selectedProduct === p.id && styles.chipTextActive]}>
                  {p.name} ({p.quantity})
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={[styles.label, { marginTop: 12 }]}>Quantity</Text>
          <TextInput style={styles.input} value={qty} onChangeText={setQty} keyboardType="numeric" />
          <TextInput style={styles.input} placeholder="Note (optional)" placeholderTextColor="#555" value={notes} onChangeText={setNotes} />

          <View style={styles.formButtons}>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowForm(false)}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.saveBtn} onPress={handleCreate} disabled={saving}>
              {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.saveText}>Send</Text>}
            </TouchableOpacity>
          </View>
        </View>
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
            {item.notes && <Text style={styles.cardNote}>{item.notes}</Text>}
            <Text style={styles.cardDate}>{new Date(item.created_at).toLocaleDateString()}</Text>
            {item.status === 'in_transit' && item.to_branch === currentBranch?.name && (
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
    </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e', padding: 16 },
  addButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#e94560', borderRadius: 12, padding: 14, marginBottom: 14, gap: 8 },
  addButtonText: { color: '#fff', fontWeight: 'bold', fontSize: 15 },
  formCard: { backgroundColor: '#16213e', borderRadius: 16, padding: 16, marginBottom: 14 },
  formTitle: { color: '#fff', fontSize: 18, fontWeight: 'bold', marginBottom: 12 },
  label: { color: '#aaa', fontSize: 13, marginBottom: 6 },
  chipRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 18, backgroundColor: '#0f3460', borderWidth: 1, borderColor: '#0f3460', marginBottom: 6 },
  chipActive: { backgroundColor: '#e94560', borderColor: '#e94560' },
  chipText: { color: '#aaa', fontSize: 13 },
  chipTextActive: { color: '#fff', fontWeight: 'bold' },
  input: { backgroundColor: '#0f3460', borderRadius: 10, padding: 14, color: '#fff', fontSize: 15, marginBottom: 10, marginTop: 6 },
  formButtons: { flexDirection: 'row', gap: 10 },
  cancelBtn: { flex: 1, padding: 14, borderRadius: 10, backgroundColor: '#333', alignItems: 'center' },
  cancelText: { color: '#aaa', fontWeight: 'bold' },
  saveBtn: { flex: 1, padding: 14, borderRadius: 10, backgroundColor: '#e94560', alignItems: 'center' },
  saveText: { color: '#fff', fontWeight: 'bold' },
  card: { backgroundColor: '#16213e', borderRadius: 12, padding: 14, marginBottom: 10 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'transparent' },
  cardRoute: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'transparent' },
  routeText: { color: '#fff', fontSize: 14, fontWeight: 'bold' },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, borderWidth: 1 },
  statusText: { fontSize: 11, fontWeight: 'bold', textTransform: 'capitalize' },
  cardNote: { color: '#aaa', fontSize: 13, marginTop: 6 },
  cardDate: { color: '#555', fontSize: 12, marginTop: 4 },
  receiveBtn: { backgroundColor: '#2d6a4f', borderRadius: 8, padding: 10, alignItems: 'center', marginTop: 10 },
  receiveBtnText: { color: '#fff', fontWeight: 'bold' },
  empty: { alignItems: 'center', paddingTop: 40 },
  emptyText: { color: '#555', fontSize: 16, marginTop: 12 },
});
