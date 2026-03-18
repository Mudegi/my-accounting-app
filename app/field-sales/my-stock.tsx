import React, { useState, useCallback } from 'react';
import {
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Alert,
  ActivityIndicator,
  TextInput,
  Modal,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Text, View } from '@/components/Themed';
import { useAuth } from '@/lib/auth';
import { getAssignments, returnStock, type FieldStockAssignment } from '@/lib/field-sales';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useFocusEffect } from 'expo-router';

export default function MyStockScreen() {
  const { business, profile, fmt } = useAuth();
  const [assignments, setAssignments] = useState<FieldStockAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showReturn, setShowReturn] = useState(false);
  const [returningId, setReturningId] = useState<string | null>(null);
  const [returnQty, setReturnQty] = useState('');
  const [returning, setReturning] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('active');

  const load = useCallback(async () => {
    if (!business || !profile) return;
    setLoading(true);
    const result = await getAssignments({
      businessId: business.id,
      userId: profile.id,
      status: statusFilter !== 'all' ? statusFilter : undefined,
    });
    if (result.error) {
      console.error('Field stock load error:', result.error);
      Alert.alert('Load Error', `Could not load assignments: ${result.error}`);
    }
    setAssignments(result.data);
    setLoading(false);
  }, [business, profile, statusFilter]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openReturn = (assignment: FieldStockAssignment) => {
    setReturningId(assignment.id);
    setReturnQty('');
    setShowReturn(true);
  };

  const handleReturn = async () => {
    if (!returningId || !business || !profile) return;
    const qty = parseInt(returnQty);
    if (!qty || qty < 1) { Alert.alert('Error', 'Enter a valid quantity'); return; }

    setReturning(true);
    const result = await returnStock({
      assignmentId: returningId,
      qtyReturned: qty,
      businessId: business.id,
      userId: profile.id,
    });
    setReturning(false);

    if (result.error) {
      Alert.alert('Error', result.error);
    } else {
      Alert.alert('Stock Returned', `${qty} unit(s) returned successfully.`);
      setShowReturn(false);
      setReturningId(null);
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
    return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
  };

  const totalAssigned = assignments.reduce((s, a) => s + a.qty_assigned, 0);
  const totalReturned = assignments.reduce((s, a) => s + a.qty_returned, 0);
  const totalBalance = totalAssigned - totalReturned;

  return (
    <View style={styles.container}>
      {/* Summary Cards */}
      <View style={styles.summaryRow}>
        <View style={[styles.summaryCard, { backgroundColor: '#0f3460' }]}>
          <Text style={styles.summaryValue}>{totalAssigned}</Text>
          <Text style={styles.summaryLabel}>Assigned</Text>
        </View>
        <View style={[styles.summaryCard, { backgroundColor: '#2d6a4f' }]}>
          <Text style={styles.summaryValue}>{totalReturned}</Text>
          <Text style={styles.summaryLabel}>Returned</Text>
        </View>
        <View style={[styles.summaryCard, { backgroundColor: '#533483' }]}>
          <Text style={styles.summaryValue}>{totalBalance}</Text>
          <Text style={styles.summaryLabel}>Balance</Text>
        </View>
      </View>

      {/* Status Filter */}
      <View style={styles.filterRow}>
        {['active', 'partially_returned', 'returned', 'all'].map(s => (
          <TouchableOpacity
            key={s}
            style={[styles.filterChip, statusFilter === s && styles.filterChipActive]}
            onPress={() => setStatusFilter(s)}
          >
            <Text style={[styles.filterText, statusFilter === s && styles.filterTextActive]}>
              {s === 'all' ? 'All' : s === 'partially_returned' ? 'Partial' : s.charAt(0).toUpperCase() + s.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Stock List */}
      {loading ? (
        <ActivityIndicator color="#e94560" style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={assignments}
          keyExtractor={a => a.id}
          renderItem={({ item }) => {
            const balance = item.qty_assigned - item.qty_returned;
            return (
              <View style={styles.card}>
                <View style={styles.cardTop}>
                  <View style={{ flex: 1, backgroundColor: 'transparent' }}>
                    <Text style={styles.cardProduct}>{item.product_name}</Text>
                    <Text style={styles.cardMeta}>📍 {item.branch_name} · {formatDate(item.assigned_at)}</Text>
                    <Text style={styles.cardMeta}>Assigned by {item.assigned_by_name}</Text>
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
                    <Text style={[styles.qtyValue, { color: balance > 0 ? '#FF9800' : '#4CAF50' }]}>{balance}</Text>
                  </View>
                </View>

                {item.status === 'active' || item.status === 'partially_returned' ? (
                  <TouchableOpacity style={styles.returnBtn} onPress={() => openReturn(item)}>
                    <FontAwesome name="reply" size={14} color="#fff" />
                    <Text style={styles.returnBtnText}>Return Stock</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            );
          }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <FontAwesome name="cubes" size={48} color="#333" />
              <Text style={styles.emptyText}>No stock assigned to you</Text>
              <Text style={styles.emptyHint}>Your admin will assign stock when needed</Text>
            </View>
          }
        />
      )}

      {/* Return Modal */}
      <Modal visible={showReturn} animationType="fade" transparent>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Return Stock</Text>
            <Text style={{ color: '#aaa', fontSize: 13, marginBottom: 12 }}>
              Enter the quantity you are returning to the business.
            </Text>
            <TextInput
              style={styles.input}
              placeholder="Quantity to return"
              placeholderTextColor="#555"
              value={returnQty}
              onChangeText={setReturnQty}
              keyboardType="numeric"
              autoFocus
            />
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 16, backgroundColor: 'transparent' }}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowReturn(false)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmBtn, returning && { opacity: 0.6 }]}
                onPress={handleReturn}
                disabled={returning}
              >
                {returning ? <ActivityIndicator color="#fff" /> : (
                  <Text style={styles.confirmText}>Confirm Return</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e', padding: 16 },
  summaryRow: { flexDirection: 'row', gap: 10, marginBottom: 14, backgroundColor: 'transparent' },
  summaryCard: { flex: 1, borderRadius: 14, padding: 14, alignItems: 'center' },
  summaryValue: { color: '#fff', fontSize: 22, fontWeight: 'bold' },
  summaryLabel: { color: '#ccc', fontSize: 11, marginTop: 4 },
  filterRow: { flexDirection: 'row', gap: 6, marginBottom: 14, backgroundColor: 'transparent' },
  filterChip: { flex: 1, paddingVertical: 8, borderRadius: 10, backgroundColor: '#16213e', alignItems: 'center', borderWidth: 1, borderColor: '#0f3460' },
  filterChipActive: { backgroundColor: '#e94560', borderColor: '#e94560' },
  filterText: { color: '#aaa', fontWeight: 'bold', fontSize: 12 },
  filterTextActive: { color: '#fff' },
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
  returnBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#2196F3', borderRadius: 10, paddingVertical: 10, marginTop: 10 },
  returnBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 14 },
  empty: { alignItems: 'center', paddingTop: 60 },
  emptyText: { color: '#555', fontSize: 16, marginTop: 12 },
  emptyHint: { color: '#444', fontSize: 13, marginTop: 4 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', padding: 24 },
  modalCard: { backgroundColor: '#16213e', borderRadius: 20, padding: 24, borderWidth: 1, borderColor: '#0f3460' },
  modalTitle: { fontSize: 20, fontWeight: 'bold', color: '#fff', marginBottom: 4 },
  input: { backgroundColor: '#0f3460', borderRadius: 10, padding: 14, color: '#fff', fontSize: 16, borderWidth: 1, borderColor: '#1a4a7a' },
  cancelBtn: { flex: 1, padding: 14, borderRadius: 10, backgroundColor: '#333', alignItems: 'center' },
  cancelText: { color: '#aaa', fontWeight: 'bold' },
  confirmBtn: { flex: 1, padding: 14, borderRadius: 10, backgroundColor: '#4CAF50', alignItems: 'center' },
  confirmText: { color: '#fff', fontWeight: 'bold' },
});
