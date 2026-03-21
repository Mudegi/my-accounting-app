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
  TextInput,
} from 'react-native';
import { Text, View } from '@/components/Themed';
import { useAuth } from '@/lib/auth';
import { getPendingFieldSales, approveFieldSale, rejectFieldSale, type PendingFieldSale } from '@/lib/field-sales';
import {
  fiscalizeInvoice,
  buildInvoicePayload,
  EFRIS_PAYMENT_METHODS,
  EFRIS_BUYER_TYPES,
  EFRIS_UNIT_MAP,
  type EfrisConfig,
} from '@/lib/efris';
import { supabase } from '@/lib/supabase';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useFocusEffect, Redirect, useRouter } from 'expo-router';

export default function ApproveSalesScreen() {
  const { business, profile, fmt } = useAuth();
  const isAdmin = profile?.role === 'admin' || profile?.role === 'branch_manager';

  if (profile && !isAdmin) return <Redirect href="/" />;

  const [sales, setSales] = useState<PendingFieldSale[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSale, setSelectedSale] = useState<PendingFieldSale | null>(null);
  const [processing, setProcessing] = useState(false);

  // EFRIS fiscalization state
  const [showEfrisModal, setShowEfrisModal] = useState(false);
  const [efrisSale, setEfrisSale] = useState<PendingFieldSale | null>(null);
  const [efrisBuyerType, setEfrisBuyerType] = useState('1');
  const [efrisTin, setEfrisTin] = useState('');
  const [efrisPaymentCode, setEfrisPaymentCode] = useState('101');
  const [fiscalizing, setFiscalizing] = useState(false);
  const router = useRouter();
  const isEfris = !!business?.is_efris_enabled;

  const PAYMENT_TO_EFRIS: Record<string, string> = {
    cash: '101', credit: '102', cheque: '103', mobile_money: '104', visa_mastercard: '105',
  };

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

  const openEfrisModal = (sale: PendingFieldSale) => {
    setEfrisSale(sale);
    setEfrisBuyerType('1');
    setEfrisTin('');
    setEfrisPaymentCode(PAYMENT_TO_EFRIS[sale.payment_method] || '101');
    setShowEfrisModal(true);
  };

  const handleApproveFiscalize = async () => {
    if (!efrisSale || !business || !profile) return;
    if (!business.efris_api_key) {
      Alert.alert('EFRIS not configured', 'Go to Settings → EFRIS Configuration first.');
      return;
    }
    setFiscalizing(true);
    try {
      // 1. Approve the sale first
      const approveResult = await approveFieldSale({
        saleId: efrisSale.id,
        approverId: profile.id,
        businessId: business.id,
        branchId: business.id,
      });
      if (approveResult.error) {
        Alert.alert('Approve Error', approveResult.error);
        setFiscalizing(false);
        return;
      }

      // 2. Get sale items with EFRIS product data
      const { data: saleItems } = await supabase
        .from('sale_items')
        .select('*, products:product_id(efris_product_code, efris_item_code, commodity_code, tax_category_code, unit)')
        .eq('sale_id', efrisSale.id);

      if (!saleItems || saleItems.length === 0) {
        Alert.alert('Error', 'No sale items found for fiscalization. Sale was approved.');
        setFiscalizing(false);
        setShowEfrisModal(false);
        load();
        return;
      }

      // 3. Warn about unregistered items
      const unregistered = saleItems.filter((si: any) => !si.products?.efris_product_code);
      if (unregistered.length > 0) {
        const names = unregistered.map((si: any) => si.product_name).join(', ');
        Alert.alert('Unregistered Products', `These products are not registered with EFRIS: ${names}. Sale was approved but NOT fiscalized. Register them first.`);
        setFiscalizing(false);
        setShowEfrisModal(false);
        load();
        return;
      }

      // 4. Generate invoice number
      const { data: invNoData } = await supabase.rpc('generate_invoice_number');
      const invoiceNumber = invNoData || `INV-${Date.now()}`;

      // 5. Build EFRIS payload
      const config: EfrisConfig = {
        apiKey: business.efris_api_key,
        apiUrl: business.efris_api_url || '',
        testMode: business.efris_test_mode ?? true,
      };

      const items = saleItems.map((si: any) => ({
        name: si.product_name,
        efris_item_code: si.products?.efris_item_code || '',
        quantity: si.quantity,
        unit_price: si.unit_price,
        discount_amount: si.discount_amount || 0,
        unit_code: EFRIS_UNIT_MAP[si.products?.unit || 'piece'] || '101',
        commodity_code: si.products?.commodity_code || '',
        commodity_name: '',
        tax_category_code: si.products?.tax_category_code || '01',
      }));

      const payload = buildInvoicePayload(invoiceNumber, {
        customer_name: efrisSale.customer_name || undefined,
        customer_tin: efrisBuyerType === '0' ? efrisTin || undefined : undefined,
        buyer_type: efrisBuyerType,
        payment_method: efrisPaymentCode,
        total_amount: efrisSale.total_amount,
        global_discount: efrisSale.discount_amount > 0 ? efrisSale.discount_amount : undefined,
      }, items);

      // 6. Fiscalize
      const result = await fiscalizeInvoice(config, payload);
      if (result.success) {
        const efrisResponse = result.fullEfrisResponse || result;
        await supabase.from('sales').update({
          is_fiscalized: true,
          efris_fdn: result.fdn || null,
          efris_verification_code: result.verification_code || null,
          efris_qr_code: result.qr_code || null,
          efris_response: efrisResponse,
          invoice_number: invoiceNumber,
          buyer_type: efrisBuyerType,
          customer_name: efrisSale.customer_name || null,
          customer_tin: efrisBuyerType === '0' ? efrisTin || null : null,
          efris_payment_code: efrisPaymentCode,
          efris_fiscalized_at: new Date().toISOString(),
        }).eq('id', efrisSale.id);

        setShowEfrisModal(false);
        setEfrisSale(null);
        setSelectedSale(null);
        Alert.alert('Success', 'Sale approved and fiscalized!', [
          { text: 'View Receipt', onPress: () => router.push({ pathname: '/receipt', params: { saleId: efrisSale.id } }) },
          { text: 'OK' },
        ]);
        load();
      } else {
        Alert.alert('EFRIS Error', `Sale was approved but fiscalization failed:\n${result.error || 'Unknown error'}.\n\nYou can fiscalize it later from the sale details.`);
        setShowEfrisModal(false);
        load();
      }
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Something went wrong');
    } finally {
      setFiscalizing(false);
    }
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

  const PAYMENT_LABELS: Record<string, string> = {
    cash: 'Cash', mobile_money: 'Mobile Money', credit: 'Credit', cheque: 'Cheque',
    visa_mastercard: 'Card',
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
            <View style={styles.card}>
              {/* ── Header row ── */}
              <View style={styles.cardTop}>
                <View style={{ flex: 1, backgroundColor: 'transparent' }}>
                  <Text style={styles.cardAmount}>{fmt(item.total_amount)}</Text>
                  <View style={styles.metaRowInline}>
                    <FontAwesome name="user" size={11} color="#888" />
                    <Text style={styles.cardMeta}>{item.seller_name}</Text>
                    <Text style={styles.metaDivider}>·</Text>
                    <FontAwesome name="clock-o" size={11} color="#888" />
                    <Text style={styles.cardMeta}>{formatDate(item.created_at)}</Text>
                  </View>
                </View>
                <View style={styles.pendingBadge}>
                  <Text style={styles.pendingText}>⏳ Pending</Text>
                </View>
              </View>

              {/* ── Customer row ── */}
              <View style={styles.customerRow}>
                <FontAwesome name="bookmark" size={11} color="#aaa" />
                <Text style={styles.customerInfo}>
                  {item.customer_name || '—'}
                </Text>
                {item.customer_phone ? (
                  <>
                    <Text style={styles.metaDivider}>·</Text>
                    <FontAwesome name="mobile" size={13} color="#aaa" />
                    <Text style={styles.customerInfo}>{item.customer_phone}</Text>
                  </>
                ) : null}
                <Text style={styles.metaDivider}>·</Text>
                <FontAwesome name="money" size={11} color="#aaa" />
                <Text style={styles.customerInfo}>{PAYMENT_LABELS[item.payment_method] || item.payment_method}</Text>
              </View>

              {/* ── GPS ── */}
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

              {/* ── Items ── */}
              <View style={styles.itemsTable}>
                {item.items.map((si, i) => {
                  const tax = (si.unit_price * si.quantity - si.discount_amount) * si.tax_rate;
                  return (
                    <View key={i} style={styles.itemRow}>
                      <View style={styles.itemRowTop}>
                        <Text style={styles.itemName} numberOfLines={2}>{si.product_name}</Text>
                        <Text style={styles.itemTotal}>{fmt(si.line_total)}</Text>
                      </View>
                      <View style={styles.itemRowBottom}>
                        <Text style={styles.itemQtyPrice}>{si.quantity} × {fmt(si.unit_price)}</Text>
                        <View style={{ flexDirection: 'row', gap: 6, backgroundColor: 'transparent' }}>
                          {si.discount_amount > 0 && <Text style={styles.itemDiscText}>-{fmt(si.discount_amount)}</Text>}
                          {si.tax_rate > 0 && <Text style={styles.itemTaxText}>+{fmt(Math.round(tax))} tax</Text>}
                        </View>
                      </View>
                    </View>
                  );
                })}
              </View>

              {/* ── Totals breakdown ── */}
              <View style={styles.totalsBox}>
                <View style={styles.totalLine}>
                  <Text style={styles.totalLbl}>Subtotal</Text>
                  <Text style={styles.totalVal}>{fmt(item.subtotal)}</Text>
                </View>
                {item.discount_amount > 0 && (
                  <View style={styles.totalLine}>
                    <Text style={[styles.totalLbl, { color: '#4CAF50' }]}>Discount</Text>
                    <Text style={[styles.totalVal, { color: '#4CAF50' }]}>-{fmt(item.discount_amount)}</Text>
                  </View>
                )}
                {item.tax_amount > 0 && (
                  <View style={styles.totalLine}>
                    <Text style={[styles.totalLbl, { color: '#FF9800' }]}>Tax</Text>
                    <Text style={[styles.totalVal, { color: '#FF9800' }]}>+{fmt(item.tax_amount)}</Text>
                  </View>
                )}
                <View style={[styles.totalLine, styles.totalLineGrand]}>
                  <Text style={styles.grandLbl}>Total</Text>
                  <Text style={styles.grandVal}>{fmt(item.total_amount)}</Text>
                </View>
              </View>

              {/* ── Action buttons ── */}
              <View style={styles.actionRow}>
                <TouchableOpacity
                  style={styles.approveBtn}
                  onPress={() => handleApprove(item)}
                  disabled={processing}
                >
                  <FontAwesome name="check" size={14} color="#fff" />
                  <Text style={styles.actionBtnText}>Approve</Text>
                </TouchableOpacity>
                {isEfris && (
                  <TouchableOpacity
                    style={styles.fiscalizeBtn}
                    onPress={() => openEfrisModal(item)}
                    disabled={processing}
                  >
                    <FontAwesome name="certificate" size={14} color="#fff" />
                    <Text style={styles.actionBtnText}>Fiscalize</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={styles.rejectBtn}
                  onPress={() => handleReject(item)}
                  disabled={processing}
                >
                  <FontAwesome name="times" size={14} color="#fff" />
                  <Text style={styles.actionBtnText}>Reject</Text>
                </TouchableOpacity>
              </View>
            </View>
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

      {/* Detail Modal — keep for quick-tap access */}
      <Modal visible={!!selectedSale} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            {selectedSale && (
              <ScrollView>
                <Text style={styles.modalTitle}>Sale Details</Text>

                {/* Seller + date */}
                <View style={styles.detailSection}>
                  <Text style={styles.detailLabel}>Seller</Text>
                  <Text style={styles.detailValue}>{selectedSale.seller_name}</Text>
                  <Text style={{ color: '#aaa', fontSize: 13 }}>{formatDate(selectedSale.created_at)}</Text>
                </View>

                {/* Customer */}
                <View style={styles.detailSection}>
                  <Text style={styles.detailLabel}>Customer</Text>
                  <Text style={styles.detailValue}>{selectedSale.customer_name || '—'}</Text>
                  {selectedSale.customer_phone && (
                    <Text style={{ color: '#aaa', fontSize: 13 }}>📱 {selectedSale.customer_phone}</Text>
                  )}
                </View>

                {/* Payment */}
                <View style={styles.detailSection}>
                  <Text style={styles.detailLabel}>Payment Method</Text>
                  <Text style={styles.detailValue}>{PAYMENT_LABELS[selectedSale.payment_method] || selectedSale.payment_method}</Text>
                </View>

                {/* GPS */}
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

                {/* Items table in modal */}
                <Text style={[styles.detailLabel, { marginTop: 8, marginBottom: 6 }]}>Items ({selectedSale.items.length})</Text>
                <View style={styles.itemsTable}>
                  {selectedSale.items.map((si, i) => {
                    const tax = (si.unit_price * si.quantity - si.discount_amount) * si.tax_rate;
                    return (
                      <View key={i} style={styles.itemRow}>
                        <View style={styles.itemRowTop}>
                          <Text style={styles.itemName} numberOfLines={2}>{si.product_name}</Text>
                          <Text style={styles.itemTotal}>{fmt(si.line_total)}</Text>
                        </View>
                        <View style={styles.itemRowBottom}>
                          <Text style={styles.itemQtyPrice}>{si.quantity} × {fmt(si.unit_price)}</Text>
                          <View style={{ flexDirection: 'row', gap: 6, backgroundColor: 'transparent' }}>
                            {si.discount_amount > 0 && <Text style={styles.itemDiscText}>-{fmt(si.discount_amount)}</Text>}
                            {si.tax_rate > 0 && <Text style={styles.itemTaxText}>+{fmt(Math.round(tax))} tax</Text>}
                          </View>
                        </View>
                      </View>
                    );
                  })}
                </View>

                {/* Totals */}
                <View style={[styles.totalsBox, { marginTop: 12 }]}>
                  <View style={styles.totalLine}>
                    <Text style={styles.totalLbl}>Subtotal</Text>
                    <Text style={styles.totalVal}>{fmt(selectedSale.subtotal)}</Text>
                  </View>
                  {selectedSale.discount_amount > 0 && (
                    <View style={styles.totalLine}>
                      <Text style={[styles.totalLbl, { color: '#4CAF50' }]}>Discount</Text>
                      <Text style={[styles.totalVal, { color: '#4CAF50' }]}>-{fmt(selectedSale.discount_amount)}</Text>
                    </View>
                  )}
                  {selectedSale.tax_amount > 0 && (
                    <View style={styles.totalLine}>
                      <Text style={[styles.totalLbl, { color: '#FF9800' }]}>Tax</Text>
                      <Text style={[styles.totalVal, { color: '#FF9800' }]}>+{fmt(selectedSale.tax_amount)}</Text>
                    </View>
                  )}
                  <View style={[styles.totalLine, styles.totalLineGrand]}>
                    <Text style={styles.grandLbl}>Total</Text>
                    <Text style={styles.grandVal}>{fmt(selectedSale.total_amount)}</Text>
                  </View>
                </View>

                <View style={styles.actionRow}>
                  <TouchableOpacity style={styles.approveBtn} onPress={() => handleApprove(selectedSale)} disabled={processing}>
                    {processing ? <ActivityIndicator color="#fff" size="small" /> : (
                      <>
                        <FontAwesome name="check" size={14} color="#fff" />
                        <Text style={styles.actionBtnText}>Approve</Text>
                      </>
                    )}
                  </TouchableOpacity>
                  {isEfris && (
                    <TouchableOpacity style={styles.fiscalizeBtn} onPress={() => { setSelectedSale(null); openEfrisModal(selectedSale); }} disabled={processing}>
                      <FontAwesome name="certificate" size={14} color="#fff" />
                      <Text style={styles.actionBtnText}>Fiscalize</Text>
                    </TouchableOpacity>
                  )}
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

      {/* EFRIS Approve & Fiscalize Modal */}
      <Modal visible={showEfrisModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            {efrisSale && (
              <ScrollView>
                <Text style={styles.modalTitle}>Approve & Fiscalize</Text>
                <Text style={{ color: '#aaa', fontSize: 13, marginBottom: 16 }}>
                  This will approve the sale and submit it to EFRIS for fiscal certification.
                </Text>

                {/* Sale summary */}
                <View style={styles.detailSection}>
                  <Text style={styles.detailLabel}>Sale</Text>
                  <Text style={styles.detailValue}>{fmt(efrisSale.total_amount)} — {efrisSale.seller_name}</Text>
                  <Text style={{ color: '#aaa', fontSize: 12 }}>{efrisSale.customer_name || 'Walk-in'} · {efrisSale.items.length} item(s)</Text>
                </View>

                {/* Buyer Type */}
                <Text style={[styles.detailLabel, { marginTop: 8 }]}>Buyer Type</Text>
                <View style={styles.efrisOptionRow}>
                  {EFRIS_BUYER_TYPES.map(bt => (
                    <TouchableOpacity
                      key={bt.code}
                      style={[styles.efrisOptionBtn, efrisBuyerType === bt.code && styles.efrisOptionBtnActive]}
                      onPress={() => setEfrisBuyerType(bt.code)}
                    >
                      <Text style={[styles.efrisOptionText, efrisBuyerType === bt.code && styles.efrisOptionTextActive]}>
                        {bt.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* TIN (only for B2B) */}
                {efrisBuyerType === '0' && (
                  <View style={{ marginTop: 12 }}>
                    <Text style={styles.detailLabel}>Customer TIN</Text>
                    <TextInput
                      style={styles.tinInput}
                      value={efrisTin}
                      onChangeText={setEfrisTin}
                      placeholder="Enter TIN"
                      placeholderTextColor="#555"
                      keyboardType="number-pad"
                    />
                  </View>
                )}

                {/* EFRIS Payment Method */}
                <Text style={[styles.detailLabel, { marginTop: 12 }]}>EFRIS Payment Method</Text>
                <View style={styles.efrisOptionRow}>
                  {EFRIS_PAYMENT_METHODS.map(pm => (
                    <TouchableOpacity
                      key={pm.code}
                      style={[styles.efrisOptionBtn, efrisPaymentCode === pm.code && styles.efrisOptionBtnActive]}
                      onPress={() => setEfrisPaymentCode(pm.code)}
                    >
                      <Text style={[styles.efrisOptionText, efrisPaymentCode === pm.code && styles.efrisOptionTextActive]}>
                        {pm.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* Proceed */}
                <TouchableOpacity
                  style={[styles.approveBtn, { marginTop: 20, backgroundColor: '#FF9800' }]}
                  onPress={handleApproveFiscalize}
                  disabled={fiscalizing}
                >
                  {fiscalizing ? <ActivityIndicator color="#fff" size="small" /> : (
                    <>
                      <FontAwesome name="certificate" size={14} color="#fff" />
                      <Text style={styles.actionBtnText}>Approve & Fiscalize</Text>
                    </>
                  )}
                </TouchableOpacity>

                <TouchableOpacity style={styles.closeBtn} onPress={() => { setShowEfrisModal(false); setEfrisSale(null); }}>
                  <Text style={styles.closeBtnText}>Cancel</Text>
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

  // Card
  card: { backgroundColor: '#16213e', borderRadius: 14, padding: 14, marginBottom: 12 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', backgroundColor: 'transparent' },
  cardAmount: { color: '#fff', fontSize: 22, fontWeight: 'bold' },
  metaRowInline: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'transparent', marginTop: 4 },
  cardMeta: { color: '#888', fontSize: 12 },
  metaDivider: { color: '#555', fontSize: 12, marginHorizontal: 2 },
  pendingBadge: { backgroundColor: '#FF980022', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, borderWidth: 1, borderColor: '#FF9800' },
  pendingText: { color: '#FF9800', fontSize: 11, fontWeight: 'bold' },
  customerRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 5, marginTop: 10, backgroundColor: 'transparent' },
  customerInfo: { color: '#ccc', fontSize: 13 },
  gpsText: { color: '#4CAF50', fontSize: 11, marginTop: 6 },
  mapLink: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, backgroundColor: '#2196F315', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, alignSelf: 'flex-start' },
  mapLinkText: { color: '#2196F3', fontSize: 12, fontWeight: '600' },

  // Items table
  itemsTable: { backgroundColor: '#0f3460', borderRadius: 10, marginTop: 12, overflow: 'hidden' },
  itemRow: { paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#16213e' },
  itemRowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', backgroundColor: 'transparent' },
  itemName: { color: '#fff', fontSize: 14, flex: 1, marginRight: 10 },
  itemTotal: { color: '#fff', fontSize: 14, fontWeight: 'bold' },
  itemRowBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 3, backgroundColor: 'transparent' },
  itemQtyPrice: { color: '#888', fontSize: 12 },
  itemDiscText: { color: '#4CAF50', fontSize: 11 },
  itemTaxText: { color: '#FF9800', fontSize: 11 },

  // Totals
  totalsBox: { backgroundColor: '#0f3460', borderRadius: 10, padding: 12, marginTop: 10 },
  totalLine: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, backgroundColor: 'transparent' },
  totalLineGrand: { borderTopWidth: 1, borderTopColor: '#16213e', marginTop: 6, paddingTop: 8 },
  totalLbl: { color: '#aaa', fontSize: 14 },
  totalVal: { color: '#fff', fontSize: 14 },
  grandLbl: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  grandVal: { color: '#e94560', fontSize: 18, fontWeight: 'bold' },

  // Actions
  actionRow: { flexDirection: 'row', gap: 8, marginTop: 14, backgroundColor: 'transparent', flexWrap: 'wrap' },
  approveBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#4CAF50', borderRadius: 10, paddingVertical: 12, minWidth: 100 },
  fiscalizeBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#FF9800', borderRadius: 10, paddingVertical: 12, minWidth: 100 },
  rejectBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#e94560', borderRadius: 10, paddingVertical: 12, minWidth: 100 },
  actionBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 14 },

  // EFRIS modal
  efrisOptionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  efrisOptionBtn: { backgroundColor: '#0f3460', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: '#0f3460' },
  efrisOptionBtnActive: { borderColor: '#FF9800', backgroundColor: '#FF980022' },
  efrisOptionText: { color: '#aaa', fontSize: 13 },
  efrisOptionTextActive: { color: '#FF9800', fontWeight: 'bold' },
  tinInput: { backgroundColor: '#0f3460', borderRadius: 10, padding: 12, color: '#fff', fontSize: 16, marginTop: 6 },

  // Empty
  empty: { alignItems: 'center', paddingTop: 60 },
  emptyText: { color: '#4CAF50', fontSize: 18, fontWeight: 'bold', marginTop: 12 },
  emptyHint: { color: '#555', fontSize: 13, marginTop: 4 },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#1a1a2e', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: '90%' },
  modalTitle: { fontSize: 22, fontWeight: 'bold', color: '#fff', marginBottom: 16 },
  detailSection: { marginBottom: 12, backgroundColor: 'transparent' },
  detailLabel: { color: '#888', fontSize: 12, marginBottom: 2 },
  detailValue: { color: '#fff', fontSize: 16, fontWeight: '600' },
  viewMapBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#2196F3', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, marginTop: 8, alignSelf: 'flex-start' },
  viewMapBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 13 },
  closeBtn: { padding: 14, alignItems: 'center', marginTop: 8 },
  closeBtnText: { color: '#aaa', fontSize: 15 },
});
