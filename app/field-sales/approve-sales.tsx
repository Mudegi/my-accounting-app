import React, { useState, useCallback } from 'react';
import {
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Alert,
  ActivityIndicator,
  Modal,
  ScrollView,
  Linking,
} from 'react-native';
import { Text, View } from '@/components/Themed';
import { useAuth } from '@/lib/auth';
import { getPendingFieldSales, approveFieldSale, rejectFieldSale, type PendingFieldSale } from '@/lib/field-sales';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useFocusEffect, Redirect } from 'expo-router';

export default function ApproveSalesScreen() {
  const { business, profile, fmt } = useAuth();
  const isAdmin = profile?.role === 'admin' || profile?.role === 'branch_manager';

  if (profile && !isAdmin) return <Redirect href="/" />;

  const [sales, setSales] = useState<PendingFieldSale[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSale, setSelectedSale] = useState<PendingFieldSale | null>(null);
  const [processing, setProcessing] = useState(false);

  const load = useCallback(async () => {
    if (!business) return;
    setLoading(true);
    const data = await getPendingFieldSales(business.id);
    setSales(data);
    setLoading(false);
  }, [business]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleApprove = (sale: PendingFieldSale) => {
    Alert.alert(
      'Approve Sale',
      `Approve field sale of ${fmt(sale.total_amount)} by ${sale.seller_name}?\n\nThis will add it to accounting.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Approve',
          onPress: async () => {
            if (!business || !profile) return;
            setProcessing(true);
            const result = await approveFieldSale({
              saleId: sale.id,
              approverId: profile.id,
              businessId: business.id,
              branchId: business.id, // Will be resolved from sale data
            });
            setProcessing(false);
            if (result.error) {
              Alert.alert('Error', result.error);
            } else {
              Alert.alert('Approved', 'Sale has been approved and posted to accounting.');
              load();
              setSelectedSale(null);
            }
          },
        },
      ]
    );
  };

  const handleReject = (sale: PendingFieldSale) => {
    Alert.alert(
      'Reject Sale',
      `Reject field sale of ${fmt(sale.total_amount)} by ${sale.seller_name}?\n\nThis will void the transaction.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reject',
          style: 'destructive',
          onPress: async () => {
            if (!business || !profile) return;
            setProcessing(true);
            const result = await rejectFieldSale({
              saleId: sale.id,
              approverId: profile.id,
              businessId: business.id,
              reason: 'Rejected by admin',
            });
            setProcessing(false);
            if (result.error) {
              Alert.alert('Error', result.error);
            } else {
              Alert.alert('Rejected', 'Sale has been voided.');
              load();
              setSelectedSale(null);
            }
          },
        },
      ]
    );
  };

  const openMap = (lat: number, lng: number, label?: string) => {
    const encodedLabel = encodeURIComponent(label || 'Field Sale Location');
    const url = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}&query_place_id=${encodedLabel}`;
    Linking.openURL(url);
  };

  const formatDate = (d: string) => {
    const date = new Date(d);
    const today = new Date();
    const isToday = date.toDateString() === today.toDateString();
    const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return isToday ? `Today ${time}` : `${date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} ${time}`;
  };

  const totalPending = sales.reduce((s, sale) => s + sale.total_amount, 0);

  return (
    <View style={styles.container}>
      {/* Summary */}
      <View style={styles.summaryBar}>
        <View style={{ backgroundColor: 'transparent' }}>
          <Text style={styles.summaryCount}>{sales.length} pending</Text>
          <Text style={styles.summaryTotal}>{fmt(totalPending)} total value</Text>
        </View>
        <TouchableOpacity onPress={load} disabled={loading}>
          <FontAwesome name="refresh" size={18} color="#aaa" />
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator color="#e94560" style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={sales}
          keyExtractor={s => s.id}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.card} onPress={() => setSelectedSale(item)} activeOpacity={0.7}>
              <View style={styles.cardTop}>
                <View style={{ flex: 1, backgroundColor: 'transparent' }}>
                  <Text style={styles.cardAmount}>{fmt(item.total_amount)}</Text>
                  <Text style={styles.cardMeta}>👤 {item.seller_name}</Text>
                  <Text style={styles.cardMeta}>🕐 {formatDate(item.created_at)}</Text>
                </View>
                <View style={styles.pendingBadge}>
                  <Text style={styles.pendingText}>⏳ Pending</Text>
                </View>
              </View>

              <View style={styles.customerRow}>
                <Text style={styles.customerInfo}>
                  🧾 {item.customer_name || 'No name'} · 📱 {item.customer_phone || 'No phone'}
                </Text>
              </View>

              {item.gps_lat && item.gps_lng ? (
                <TouchableOpacity
                  style={styles.mapLink}
                  onPress={() => openMap(item.gps_lat!, item.gps_lng!, `Sale by ${item.seller_name}`)}
                >
                  <FontAwesome name="map-marker" size={14} color="#2196F3" />
                  <Text style={styles.mapLinkText}>
                    {item.gps_lat.toFixed(4)}, {item.gps_lng.toFixed(4)}
                  </Text>
                  <FontAwesome name="external-link" size={10} color="#2196F3" />
                </TouchableOpacity>
              ) : (
                <Text style={[styles.gpsText, { color: '#e94560' }]}>⚠️ No GPS location recorded</Text>
              )}

              <Text style={styles.itemCountText}>{item.item_count} item{item.item_count !== 1 ? 's' : ''}</Text>

              {/* Quick Actions */}
              <View style={styles.actionRow}>
                <TouchableOpacity
                  style={styles.approveBtn}
                  onPress={() => handleApprove(item)}
                  disabled={processing}
                >
                  <FontAwesome name="check" size={14} color="#fff" />
                  <Text style={styles.actionBtnText}>Approve</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.rejectBtn}
                  onPress={() => handleReject(item)}
                  disabled={processing}
                >
                  <FontAwesome name="times" size={14} color="#fff" />
                  <Text style={styles.actionBtnText}>Reject</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <FontAwesome name="check-circle" size={48} color="#2d6a4f" />
              <Text style={styles.emptyText}>All caught up!</Text>
              <Text style={styles.emptyHint}>No field sales pending approval</Text>
            </View>
          }
        />
      )}

      {/* Detail Modal */}
      <Modal visible={!!selectedSale} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            {selectedSale && (
              <ScrollView>
                <Text style={styles.modalTitle}>Sale Details</Text>

                <View style={styles.detailSection}>
                  <Text style={styles.detailLabel}>Amount</Text>
                  <Text style={styles.detailValue}>{fmt(selectedSale.total_amount)}</Text>
                </View>

                <View style={styles.detailSection}>
                  <Text style={styles.detailLabel}>Seller</Text>
                  <Text style={styles.detailValue}>{selectedSale.seller_name}</Text>
                </View>

                <View style={styles.detailSection}>
                  <Text style={styles.detailLabel}>Customer</Text>
                  <Text style={styles.detailValue}>{selectedSale.customer_name || '-'}</Text>
                  <Text style={{ color: '#aaa', fontSize: 13 }}>📱 {selectedSale.customer_phone || '-'}</Text>
                </View>

                <View style={styles.detailSection}>
                  <Text style={styles.detailLabel}>Location</Text>
                  {selectedSale.gps_lat && selectedSale.gps_lng ? (
                    <>
                      <Text style={[styles.detailValue, { color: '#4CAF50' }]}>
                        {selectedSale.gps_lat.toFixed(6)}, {selectedSale.gps_lng.toFixed(6)}
                      </Text>
                      <TouchableOpacity
                        style={styles.viewMapBtn}
                        onPress={() => openMap(selectedSale.gps_lat!, selectedSale.gps_lng!, `Sale by ${selectedSale.seller_name}`)}
                      >
                        <FontAwesome name="map" size={14} color="#fff" />
                        <Text style={styles.viewMapBtnText}>View on Map</Text>
                        <FontAwesome name="external-link" size={11} color="#fff" />
                      </TouchableOpacity>
                    </>
                  ) : (
                    <Text style={[styles.detailValue, { color: '#e94560' }]}>No GPS data</Text>
                  )}
                </View>

                <View style={styles.detailSection}>
                  <Text style={styles.detailLabel}>Date</Text>
                  <Text style={styles.detailValue}>{formatDate(selectedSale.created_at)}</Text>
                </View>

                <Text style={[styles.detailLabel, { marginTop: 16 }]}>Items</Text>
                {selectedSale.items.map((item, i) => (
                  <View key={i} style={styles.itemRow}>
                    <Text style={{ color: '#fff', flex: 1, fontSize: 14 }}>{item.product_name}</Text>
                    <Text style={{ color: '#aaa', fontSize: 14 }}>
                      {item.quantity} × {fmt(item.unit_price)} = {fmt(item.line_total)}
                    </Text>
                  </View>
                ))}

                <View style={styles.actionRow}>
                  <TouchableOpacity style={styles.approveBtn} onPress={() => handleApprove(selectedSale)} disabled={processing}>
                    {processing ? <ActivityIndicator color="#fff" size="small" /> : (
                      <>
                        <FontAwesome name="check" size={14} color="#fff" />
                        <Text style={styles.actionBtnText}>Approve</Text>
                      </>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.rejectBtn} onPress={() => handleReject(selectedSale)} disabled={processing}>
                    <FontAwesome name="times" size={14} color="#fff" />
                    <Text style={styles.actionBtnText}>Reject</Text>
                  </TouchableOpacity>
                </View>

                <TouchableOpacity style={styles.closeBtn} onPress={() => setSelectedSale(null)}>
                  <Text style={styles.closeBtnText}>Close</Text>
                </TouchableOpacity>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e', padding: 16 },
  summaryBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#16213e', borderRadius: 14, padding: 16, marginBottom: 14 },
  summaryCount: { color: '#FF9800', fontSize: 18, fontWeight: 'bold' },
  summaryTotal: { color: '#aaa', fontSize: 13, marginTop: 2 },
  card: { backgroundColor: '#16213e', borderRadius: 14, padding: 14, marginBottom: 10 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', backgroundColor: 'transparent' },
  cardAmount: { color: '#fff', fontSize: 20, fontWeight: 'bold' },
  cardMeta: { color: '#888', fontSize: 12, marginTop: 3 },
  pendingBadge: { backgroundColor: '#FF980022', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, borderWidth: 1, borderColor: '#FF9800' },
  pendingText: { color: '#FF9800', fontSize: 11, fontWeight: 'bold' },
  customerRow: { marginTop: 8, backgroundColor: 'transparent' },
  customerInfo: { color: '#aaa', fontSize: 13 },
  gpsText: { color: '#4CAF50', fontSize: 11, marginTop: 4 },
  mapLink: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6, backgroundColor: '#2196F315', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, alignSelf: 'flex-start' },
  mapLinkText: { color: '#2196F3', fontSize: 12, fontWeight: '600' },
  viewMapBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#2196F3', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, marginTop: 8, alignSelf: 'flex-start' },
  viewMapBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 13 },
  itemCountText: { color: '#666', fontSize: 12, marginTop: 4 },
  actionRow: { flexDirection: 'row', gap: 10, marginTop: 12, backgroundColor: 'transparent' },
  approveBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#4CAF50', borderRadius: 10, paddingVertical: 10 },
  rejectBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#e94560', borderRadius: 10, paddingVertical: 10 },
  actionBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 14 },
  empty: { alignItems: 'center', paddingTop: 60 },
  emptyText: { color: '#4CAF50', fontSize: 18, fontWeight: 'bold', marginTop: 12 },
  emptyHint: { color: '#555', fontSize: 13, marginTop: 4 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#1a1a2e', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: '85%' },
  modalTitle: { fontSize: 22, fontWeight: 'bold', color: '#fff', marginBottom: 16 },
  detailSection: { marginBottom: 12, backgroundColor: 'transparent' },
  detailLabel: { color: '#888', fontSize: 12, marginBottom: 2 },
  detailValue: { color: '#fff', fontSize: 16, fontWeight: '600' },
  itemRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#0f3460', backgroundColor: 'transparent' },
  closeBtn: { padding: 14, alignItems: 'center', marginTop: 8 },
  closeBtnText: { color: '#aaa', fontSize: 15 },
});
