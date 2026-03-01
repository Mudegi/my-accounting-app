import React, { useState, useCallback } from 'react';
import {
  StyleSheet,
  TouchableOpacity,
  FlatList,
  TextInput,
  Alert,
  ActivityIndicator,
  ScrollView,
  Modal,
} from 'react-native';
import { Text, View } from '@/components/Themed';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useFocusEffect } from 'expo-router';
import { postCreditNoteEntry } from '@/lib/accounting';
import {
  submitCreditNote,
  EFRIS_CREDIT_REASONS,
  type EfrisConfig,
} from '@/lib/efris';

type FiscalizedSale = {
  id: string;
  invoice_number: string | null;
  total_amount: number;
  efris_fdn: string | null;
  created_at: string;
};

type SaleItem = {
  id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  cost_price: number;
  tax_rate: number;
  line_total: number;
  returnQty: number;
};

type CreditNote = {
  id: string;
  reason: string;
  total_amount: number;
  efris_submitted: boolean;
  created_at: string;
  original_invoice: string | null;
};

export default function CreditNoteScreen() {
  const { business, currentBranch, profile, fmt } = useAuth();
  const [creditNotes, setCreditNotes] = useState<CreditNote[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [fiscalizedSales, setFiscalizedSales] = useState<FiscalizedSale[]>([]);
  const [selectedSale, setSelectedSale] = useState<FiscalizedSale | null>(null);
  const [saleItems, setSaleItems] = useState<SaleItem[]>([]);
  const [reason, setReason] = useState('GOODS_RETURNED');
  const [remarks, setRemarks] = useState('');
  const [saving, setSaving] = useState(false);
  const [showSalePicker, setShowSalePicker] = useState(false);
  const efrisEnabled = business?.is_efris_enabled ?? false;

  const load = useCallback(async () => {
    if (!business || !currentBranch) return;
    const { data } = await supabase
      .from('credit_notes')
      .select('id, reason, total_amount, efris_submitted, created_at, original_invoice_number')
      .eq('business_id', business.id)
      .eq('branch_id', currentBranch.id)
      .order('created_at', { ascending: false })
      .limit(30);
    if (data) setCreditNotes(data.map((cn: any) => ({
      id: cn.id,
      reason: cn.reason,
      total_amount: cn.total_amount,
      efris_submitted: cn.efris_submitted,
      created_at: cn.created_at,
      original_invoice: cn.original_invoice_number,
    })));
  }, [business, currentBranch]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const loadFiscalizedSales = async () => {
    if (!business || !currentBranch) return;
    let query = supabase
      .from('sales')
      .select('id, invoice_number, total_amount, efris_fdn, created_at')
      .eq('business_id', business.id)
      .eq('branch_id', currentBranch.id);

    if (efrisEnabled) {
      query = query.eq('is_fiscalized', true);
    } else {
      query = query.eq('status', 'completed');
    }

    const { data } = await query
      .order('created_at', { ascending: false })
      .limit(30);
    if (data) setFiscalizedSales(data);
  };

  const loadSaleItems = async (saleId: string) => {
    const { data } = await supabase
      .from('sale_items')
      .select('id, product_id, product_name, quantity, unit_price, cost_price, tax_rate, line_total')
      .eq('sale_id', saleId);
    if (data) setSaleItems(data.map((si: any) => ({ ...si, cost_price: si.cost_price || 0, tax_rate: si.tax_rate || 0, returnQty: 0 })));
  };

  const pickSale = (sale: FiscalizedSale) => {
    setSelectedSale(sale);
    loadSaleItems(sale.id);
    setShowSalePicker(false);
  };

  const openForm = () => {
    loadFiscalizedSales();
    setShowForm(true);
    setShowSalePicker(true);
  };

  const updateReturnQty = (itemId: string, delta: number) => {
    setSaleItems(prev => prev.map(si => {
      if (si.id !== itemId) return si;
      const newQty = Math.max(0, Math.min(si.quantity, si.returnQty + delta));
      return { ...si, returnQty: newQty };
    }));
  };

  const returnTotal = saleItems.reduce((sum, si) => sum + si.returnQty * si.unit_price, 0);

  const handleSubmit = async (withEfris: boolean = false) => {
    if (!selectedSale) { Alert.alert('Error', 'Select a sale first'); return; }
    const itemsToReturn = saleItems.filter(si => si.returnQty > 0);
    if (itemsToReturn.length === 0) { Alert.alert('Error', 'Set return quantities for at least one item'); return; }
    if (!business || !currentBranch || !profile) return;

    setSaving(true);
    try {
      // Create credit note
      const { data: cn, error: cnError } = await supabase
        .from('credit_notes')
        .insert({
          business_id: business.id,
          branch_id: currentBranch.id,
          original_sale_id: selectedSale.id,
          original_invoice_number: selectedSale.invoice_number,
          reason,
          remarks: remarks.trim() || null,
          total_amount: returnTotal,
          created_by: profile.id,
        })
        .select()
        .single();

      if (cnError) throw cnError;

      // Create credit note items
      const cnItems = itemsToReturn.map(si => ({
        credit_note_id: cn.id,
        product_id: si.product_id,
        product_name: si.product_name,
        quantity: si.returnQty,
        unit_price: si.unit_price,
        line_total: si.returnQty * si.unit_price,
      }));
      await supabase.from('credit_note_items').insert(cnItems);

      // Restore stock
      for (const si of itemsToReturn) {
        await supabase.rpc('increment_inventory', {
          p_branch_id: currentBranch.id,
          p_product_id: si.product_id,
          p_quantity: si.returnQty,
        });
      }

      // Auto-post accounting entry (including VAT reversal)
      const costOfReturn = itemsToReturn.reduce((sum, si) => sum + (si.cost_price || 0) * si.returnQty, 0);
      const taxOfReturn = itemsToReturn.reduce((sum, si) => sum + si.returnQty * si.unit_price * (si.tax_rate || 0), 0);
      postCreditNoteEntry({
        businessId: business.id,
        branchId: currentBranch.id,
        creditNoteId: cn.id,
        totalAmount: returnTotal,
        taxAmount: Math.round(taxOfReturn * 100) / 100,
        costOfGoods: costOfReturn,
        userId: profile.id,
      });

      // EFRIS: Submit credit note if requested
      if (withEfris && efrisEnabled && business.efris_api_key && selectedSale.efris_fdn) {
        try {
          const config: EfrisConfig = {
            apiKey: business.efris_api_key,
            apiUrl: business.efris_api_url || '',
            testMode: business.efris_test_mode ?? true,
          };

          const result = await submitCreditNote(config, {
            credit_note_number: `CN-${Date.now()}`,
            credit_note_date: new Date().toISOString().split('T')[0],
            original_invoice_number: selectedSale.invoice_number || '',
            original_fdn: selectedSale.efris_fdn || '',
            oriInvoiceId: selectedSale.id,
            oriInvoiceNo: selectedSale.invoice_number || '',
            customer_name: '',
            reason: EFRIS_CREDIT_REASONS.find(r => r.code === reason)?.label || reason,
            currency: 'UGX',
            items: itemsToReturn.map(si => ({
              item_name: si.product_name,
              item_code: si.product_id,
              quantity: si.returnQty,
              unit_price: si.unit_price,
              tax_rate: si.tax_rate || 0.18,
            })),
          } as any);

          if (result.success) {
            await supabase.from('credit_notes').update({
              efris_submitted: true,
              efris_submitted_at: new Date().toISOString(),
            }).eq('id', cn.id);
            Alert.alert('✅ Credit Note Submitted', `Returned ${fmt(returnTotal)} — Submitted to EFRIS`);
          } else {
            Alert.alert('Credit Note Saved', `Return recorded.\n\n⚠️ EFRIS submission failed: ${result.error}`);
          }
        } catch {
          Alert.alert('Credit Note Saved', 'Return recorded but EFRIS submission failed.');
        }
      } else if (withEfris && efrisEnabled && !selectedSale.efris_fdn) {
        Alert.alert('Credit Note Saved', `Return of ${fmt(returnTotal)} recorded.\n\n⚠️ Cannot submit to EFRIS: original sale was not fiscalized.`);
      } else {
        Alert.alert('✅ Credit Note Saved', `Returned ${fmt(returnTotal)}`);
      }

      // Reset form
      setShowForm(false);
      setSelectedSale(null);
      setSaleItems([]);
      setReason('GOODS_RETURNED');
      setRemarks('');
      load();
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.addBtn} onPress={openForm}>
        <FontAwesome name="undo" size={16} color="#fff" />
        <Text style={styles.addBtnText}>New Credit Note / Return</Text>
      </TouchableOpacity>

      {showForm && !showSalePicker && selectedSale && (
        <ScrollView style={styles.formCard} contentContainerStyle={{ paddingBottom: 30 }}>
          <Text style={styles.formTitle}>Credit Note</Text>
          <View style={styles.saleInfo}>
            <Text style={styles.saleInfoText}>Invoice: {selectedSale.invoice_number || 'N/A'}</Text>
            <Text style={styles.saleInfoText}>Amount: {fmt(selectedSale.total_amount)}</Text>
            {efrisEnabled && <Text style={styles.saleInfoText}>FDN: {selectedSale.efris_fdn || 'N/A'}</Text>}
          </View>

          <Text style={styles.label}>Reason</Text>
          <View style={styles.chipGrid}>
            {EFRIS_CREDIT_REASONS.map(r => (
              <TouchableOpacity
                key={r.code}
                style={[styles.chip, reason === r.code && styles.chipActive]}
                onPress={() => setReason(r.code)}
              >
                <Text style={[styles.chipText, reason === r.code && styles.chipTextActive]}>{r.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <TextInput
            style={styles.input}
            placeholder="Remarks (optional)"
            placeholderTextColor="#555"
            value={remarks}
            onChangeText={setRemarks}
          />

          <Text style={styles.label}>Select items & quantities to return</Text>
          {saleItems.map(si => (
            <View key={si.id} style={styles.returnRow}>
              <View style={styles.returnInfo}>
                <Text style={styles.returnName}>{si.product_name}</Text>
                <Text style={styles.returnSub}>Sold: {si.quantity} × {fmt(si.unit_price)}</Text>
              </View>
              <View style={styles.returnQtyControls}>
                <TouchableOpacity style={styles.qtyBtn} onPress={() => updateReturnQty(si.id, -1)}>
                  <Text style={styles.qtyBtnText}>−</Text>
                </TouchableOpacity>
                <Text style={styles.qtyVal}>{si.returnQty}</Text>
                <TouchableOpacity style={styles.qtyBtn} onPress={() => updateReturnQty(si.id, 1)}>
                  <Text style={styles.qtyBtnText}>+</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}

          {returnTotal > 0 && (
            <Text style={styles.returnTotalText}>Return Total: {fmt(returnTotal)}</Text>
          )}

          <View style={styles.formButtons}>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowForm(false)}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.submitBtn} onPress={() => handleSubmit(false)} disabled={saving}>
              {saving ? <ActivityIndicator color="#fff" size="small" /> : (
                <Text style={styles.submitText}>Save Credit Note</Text>
              )}
            </TouchableOpacity>
            {efrisEnabled && (
              <TouchableOpacity style={styles.efrisBtn} onPress={() => handleSubmit(true)} disabled={saving}>
                <Text style={styles.submitText}>Apply to EFRIS</Text>
              </TouchableOpacity>
            )}
          </View>
        </ScrollView>
      )}

      {/* Sale Picker Modal */}
      <Modal visible={showSalePicker && showForm} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{efrisEnabled ? 'Select a Fiscalized Sale' : 'Select a Sale'}</Text>
              <TouchableOpacity onPress={() => { setShowSalePicker(false); setShowForm(false); }}>
                <FontAwesome name="times" size={22} color="#fff" />
              </TouchableOpacity>
            </View>
            <FlatList
              data={fiscalizedSales}
              keyExtractor={(s) => s.id}
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.saleRow} onPress={() => pickSale(item)}>
                  <View style={styles.saleRowInfo}>
                    <Text style={styles.saleRowInv}>{item.invoice_number || 'No invoice #'}</Text>
                    <Text style={styles.saleRowDate}>{new Date(item.created_at).toLocaleDateString()}{efrisEnabled ? ` · FDN: ${item.efris_fdn || 'N/A'}` : ''}</Text>
                  </View>
                  <Text style={styles.saleRowAmount}>{fmt(item.total_amount)}</Text>
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <Text style={{ color: '#666', textAlign: 'center', marginTop: 30 }}>
                  {efrisEnabled
                    ? 'No fiscalized sales found. Only EFRIS-fiscalized invoices can have credit notes.'
                    : 'No completed sales found.'}
                </Text>
              }
            />
          </View>
        </View>
      </Modal>

      {/* Credit Notes List */}
      {!showForm && (
        <FlatList
          data={creditNotes}
          keyExtractor={(cn) => cn.id}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.cardTop}>
                <Text style={styles.cardTitle}>{item.original_invoice || 'Return'}</Text>
                <Text style={styles.cardTotal}>−{fmt(item.total_amount)}</Text>
              </View>
              <Text style={styles.cardSub}>
                {EFRIS_CREDIT_REASONS.find(r => r.code === item.reason)?.label || item.reason} · {new Date(item.created_at).toLocaleDateString()}
                {efrisEnabled ? (item.efris_submitted ? '  ✅ EFRIS' : '  ⚠️ Not submitted') : ''}
              </Text>
            </View>
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <FontAwesome name="undo" size={48} color="#333" />
              <Text style={styles.emptyText}>No credit notes yet</Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e', padding: 16 },
  addBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#7C3AED', borderRadius: 12, padding: 14, marginBottom: 14, gap: 8 },
  addBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 15 },
  formCard: { backgroundColor: '#16213e', borderRadius: 16, padding: 16, marginBottom: 14, maxHeight: '80%' },
  formTitle: { color: '#fff', fontSize: 18, fontWeight: 'bold', marginBottom: 12 },
  saleInfo: { backgroundColor: '#0f3460', borderRadius: 10, padding: 12, marginBottom: 12 },
  saleInfoText: { color: '#aaa', fontSize: 13, marginBottom: 2 },
  label: { color: '#aaa', fontSize: 13, marginBottom: 6, marginTop: 8 },
  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 18, backgroundColor: '#0f3460', borderWidth: 1, borderColor: '#0f3460' },
  chipActive: { backgroundColor: '#7C3AED', borderColor: '#7C3AED' },
  chipText: { color: '#aaa', fontSize: 13 },
  chipTextActive: { color: '#fff', fontWeight: 'bold' },
  input: { backgroundColor: '#0f3460', borderRadius: 10, padding: 14, color: '#fff', fontSize: 15, marginBottom: 10 },
  returnRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0f3460', borderRadius: 10, padding: 12, marginBottom: 8 },
  returnInfo: { flex: 1 },
  returnName: { color: '#fff', fontSize: 14, fontWeight: 'bold' },
  returnSub: { color: '#888', fontSize: 12, marginTop: 2 },
  returnQtyControls: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  qtyBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#7C3AED', justifyContent: 'center', alignItems: 'center' },
  qtyBtnText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  qtyVal: { color: '#fff', fontSize: 16, fontWeight: 'bold', minWidth: 24, textAlign: 'center' },
  returnTotalText: { color: '#e94560', fontSize: 16, fontWeight: 'bold', textAlign: 'center', marginVertical: 10 },
  formButtons: { flexDirection: 'row', gap: 10, marginTop: 10 },
  cancelBtn: { flex: 1, padding: 14, borderRadius: 10, backgroundColor: '#333', alignItems: 'center' },
  cancelText: { color: '#aaa', fontWeight: 'bold' },
  submitBtn: { flex: 1, padding: 14, borderRadius: 10, backgroundColor: '#e94560', alignItems: 'center' },
  submitText: { color: '#fff', fontWeight: 'bold' },
  efrisBtn: { flex: 1, padding: 14, borderRadius: 10, backgroundColor: '#7C3AED', alignItems: 'center' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#1a1a2e', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: '70%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, backgroundColor: 'transparent' },
  modalTitle: { fontSize: 18, fontWeight: 'bold', color: '#fff' },
  saleRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#16213e', borderRadius: 10, padding: 14, marginBottom: 8 },
  saleRowInfo: { flex: 1 },
  saleRowInv: { color: '#fff', fontWeight: 'bold', fontSize: 14 },
  saleRowDate: { color: '#888', fontSize: 12, marginTop: 2 },
  saleRowAmount: { color: '#4CAF50', fontWeight: 'bold', fontSize: 14 },
  card: { backgroundColor: '#16213e', borderRadius: 12, padding: 14, marginBottom: 10 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'transparent' },
  cardTitle: { color: '#fff', fontSize: 15, fontWeight: 'bold' },
  cardTotal: { color: '#e94560', fontSize: 15, fontWeight: 'bold' },
  cardSub: { color: '#555', fontSize: 12, marginTop: 4 },
  empty: { alignItems: 'center', paddingTop: 40 },
  emptyText: { color: '#555', fontSize: 16, marginTop: 12 },
});
