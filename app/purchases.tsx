import React, { useState, useCallback } from 'react';
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
import { useFocusEffect, useRouter } from 'expo-router';
import { submitStockIncrease, type EfrisConfig } from '@/lib/efris';
import { postPurchaseEntry, PAYMENT_METHODS } from '@/lib/accounting';

type Purchase = {
  id: string;
  supplier_name: string | null;
  total_amount: number;
  created_at: string;
  created_by_name: string;
  efris_submitted?: boolean;
};

type Product = { id: string; name: string; efris_product_code: string | null; is_service?: boolean };
type SupplierOption = { id: string; name: string; tin: string | null };

export default function PurchasesScreen() {
  const { business, currentBranch, profile, fmt, currency } = useAuth();
  const router = useRouter();
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedProduct, setSelectedProduct] = useState('');
  const [qty, setQty] = useState('');
  const [costPrice, setCostPrice] = useState('');
  const [supplier, setSupplier] = useState('');
  const [supplierTin, setSupplierTin] = useState('');
  const [saving, setSaving] = useState(false);
  const [submittingEfris, setSubmittingEfris] = useState<string | null>(null);
  const efrisEnabled = business?.is_efris_enabled ?? false;
  const [suppliersList, setSuppliersList] = useState<SupplierOption[]>([]);
  const [supplierSearch, setSupplierSearch] = useState('');
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null);
  const [purchasePayMethod, setPurchasePayMethod] = useState('cash');
  const [vatAmount, setVatAmount] = useState('');

  const load = useCallback(async () => {
    if (!business || !currentBranch) return;
    const { data } = await supabase
      .from('purchases')
      .select(`id, supplier_name, total_amount, created_at, efris_submitted, profiles(full_name)`)
      .eq('business_id', business.id)
      .eq('branch_id', currentBranch.id)
      .order('created_at', { ascending: false })
      .limit(30);
    if (data) setPurchases(data.map((p: any) => ({ id: p.id, supplier_name: p.supplier_name, total_amount: p.total_amount, created_at: p.created_at, created_by_name: p.profiles?.full_name || '?', efris_submitted: p.efris_submitted })));
  }, [business, currentBranch]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const loadProducts = async () => {
    if (!business) return;
    const { data } = await supabase.from('products').select('id, name, efris_product_code, is_service').eq('business_id', business.id).order('name');
    if (data) setProducts(data);
  };

  const loadSuppliers = async () => {
    if (!business) return;
    const { data } = await supabase.from('suppliers').select('id, name, tin').eq('business_id', business.id).order('name');
    if (data) setSuppliersList(data);
  };

  const selectSupplier = (s: SupplierOption) => {
    setSelectedSupplierId(s.id);
    setSupplier(s.name);
    setSupplierTin(s.tin || '');
    setSupplierSearch('');
  };

  const filteredSuppliers = supplierSearch.trim()
    ? suppliersList.filter(s => s.name.toLowerCase().includes(supplierSearch.toLowerCase()))
    : suppliersList;

  const openForm = () => { loadProducts(); loadSuppliers(); setShowForm(true); };

  const handleSave = async (withEfris: boolean = false) => {
    if (!selectedProduct) { Alert.alert('Error', 'Select a product'); return; }
    const qtyNum = parseInt(qty);
    const cost = parseFloat(costPrice);
    if (!qtyNum || qtyNum < 1) { Alert.alert('Error', 'Enter a valid quantity'); return; }
    if (isNaN(cost) || cost < 0) { Alert.alert('Error', 'Enter a valid cost price'); return; }
    if (!business || !currentBranch || !profile) return;

    setSaving(true);
    const total = qtyNum * cost;

    const { data: purchase, error } = await supabase
      .from('purchases')
      .insert({
        business_id: business.id,
        branch_id: currentBranch.id,
        supplier_name: supplier.trim() || null,
        supplier_id: selectedSupplierId || null,
        total_amount: total,
        payment_method: purchasePayMethod,
        status: purchasePayMethod === 'credit' ? 'unpaid' : 'paid',
        paid_amount: purchasePayMethod === 'credit' ? 0 : total,
        created_by: profile.id,
      })
      .select()
      .single();

    if (error) { Alert.alert('Error', error.message); setSaving(false); return; }

    await supabase.from('purchase_items').insert({
      purchase_id: purchase.id,
      product_id: selectedProduct,
      quantity: qtyNum,
      unit_cost: cost,
      line_total: total,
    });

    // Add stock to inventory with proper AVCO (weighted average cost)
    // The RPC atomically: upserts inventory row, computes new avg_cost_price
    await supabase.rpc('increment_inventory', {
      p_branch_id: currentBranch.id,
      p_product_id: selectedProduct,
      p_quantity: qtyNum,
      p_unit_cost: cost,
    });

    // Auto-post accounting entry
    const vatNum = parseFloat(vatAmount) || 0;
    postPurchaseEntry({
      businessId: business.id,
      branchId: currentBranch.id,
      purchaseId: purchase.id,
      totalCost: total,
      vatAmount: vatNum,
      paymentMethod: purchasePayMethod,
      userId: profile.id,
    });

    // EFRIS: submit stock increase if requested
    const product = products.find(p => p.id === selectedProduct);
    if (withEfris && efrisEnabled && product?.efris_product_code && business?.efris_api_key) {
      try {
        const config: EfrisConfig = {
          apiKey: business.efris_api_key!,
          apiUrl: business.efris_api_url || '',
          testMode: business.efris_test_mode ?? true,
        };
        const today = new Date().toISOString().split('T')[0];
        const result = await submitStockIncrease(config, {
          goodsStockIn: {
            operationType: '101',
            supplierName: supplier.trim() || 'Unknown',
            supplierTin: supplierTin.trim(),
            stockInType: '101',
            stockInDate: today,
            remarks: `Purchase from ${supplier.trim() || 'supplier'}`,
            goodsTypeCode: '101',
          },
          goodsStockInItem: [{
            goodsCode: product.efris_product_code,
            quantity: qtyNum.toString(),
            unitPrice: cost.toString(),
          }],
        });
        if (result.success) {
          await supabase.from('purchases').update({
            supplier_tin: supplierTin.trim(),
            efris_submitted: true,
            efris_submitted_at: new Date().toISOString(),
          }).eq('id', purchase.id);
          Alert.alert('Done', `Added ${qtyNum} units \u2705 Submitted to EFRIS`);
        } else {
          Alert.alert('Stock Added', `Added ${qtyNum} units to inventory.\n\n⚠️ EFRIS submission failed: ${result.error}`);
        }
      } catch {
        Alert.alert('Stock Added', `Added ${qtyNum} units.\n\n⚠️ Could not submit to EFRIS.`);
      }
    } else if (withEfris && efrisEnabled && !product?.efris_product_code) {
      Alert.alert('Stock Added', `Added ${qtyNum} units to inventory.\n\n⚠️ This product is not registered with EFRIS. Register it in the product form first.`);
    } else {
      Alert.alert('Done', `Added ${qtyNum} units to inventory`);
    }
    setShowForm(false);
    setSelectedProduct(''); setQty(''); setCostPrice(''); setSupplier(''); setSupplierTin('');
    setSelectedSupplierId(null); setSupplierSearch('');
    setPurchasePayMethod('cash'); setVatAmount('');
    load();
    setSaving(false);
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
    <View style={styles.container}>
      <TouchableOpacity style={styles.addBtn} onPress={openForm}>
        <FontAwesome name="plus" size={16} color="#fff" />
        <Text style={styles.addBtnText}>Record Stock Purchase</Text>
      </TouchableOpacity>

      {showForm && (
        <View style={styles.formCard}>
          <Text style={styles.formTitle}>New Purchase</Text>

          <Text style={styles.label}>Supplier</Text>
          {selectedSupplierId ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10, backgroundColor: 'transparent' }}>
              <View style={{ flex: 1, backgroundColor: '#0f3460', borderRadius: 10, padding: 14 }}>
                <Text style={{ color: '#fff', fontSize: 15 }}>{supplier}</Text>
                {supplierTin ? <Text style={{ color: '#aaa', fontSize: 12 }}>TIN: {supplierTin}</Text> : null}
              </View>
              <TouchableOpacity onPress={() => { setSelectedSupplierId(null); setSupplier(''); setSupplierTin(''); }} style={{ padding: 10 }}>
                <FontAwesome name="times" size={18} color="#e94560" />
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <TextInput
                style={styles.input}
                placeholder="Search or type supplier name..."
                placeholderTextColor="#555"
                value={supplierSearch || supplier}
                onChangeText={(text) => { setSupplierSearch(text); setSupplier(text); }}
              />
              {supplierSearch.trim() && filteredSuppliers.length > 0 && (
                <View style={{ backgroundColor: '#0f3460', borderRadius: 10, marginBottom: 10, maxHeight: 120 }}>
                  {filteredSuppliers.slice(0, 5).map(s => (
                    <TouchableOpacity key={s.id} onPress={() => selectSupplier(s)} style={{ padding: 10, borderBottomWidth: 1, borderBottomColor: '#1a1a2e' }}>
                      <Text style={{ color: '#fff', fontSize: 14 }}>{s.name}{s.tin ? ` (TIN: ${s.tin})` : ''}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </>
          )}
          {efrisEnabled && !selectedSupplierId && (
            <TextInput style={[styles.input, { borderColor: '#7C3AED44' }]} placeholder="Supplier TIN (for EFRIS stock-in)" placeholderTextColor="#555" value={supplierTin} onChangeText={setSupplierTin} keyboardType="numeric" />
          )}

          <Text style={styles.label}>Product</Text>
          <View style={styles.chipGrid}>
            {products.map((p) => (
              <TouchableOpacity key={p.id} style={[styles.chip, selectedProduct === p.id && styles.chipActive]} onPress={() => setSelectedProduct(p.id)}>
                <Text style={[styles.chipText, selectedProduct === p.id && styles.chipTextActive]}>{p.name}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <TextInput style={styles.input} placeholder="Quantity Received" placeholderTextColor="#555" value={qty} onChangeText={setQty} keyboardType="numeric" />
          <TextInput style={styles.input} placeholder={`Cost Price per Unit (${currency.symbol})`} placeholderTextColor="#555" value={costPrice} onChangeText={setCostPrice} keyboardType="numeric" />
          <TextInput style={styles.input} placeholder={`VAT Amount on Purchase (${currency.symbol}, optional)`} placeholderTextColor="#555" value={vatAmount} onChangeText={setVatAmount} keyboardType="numeric" />

          {/* Payment Method */}
          <Text style={styles.label}>Payment Method</Text>
          <View style={{ flexDirection: 'row', gap: 6, marginBottom: 12, backgroundColor: 'transparent' }}>
            {PAYMENT_METHODS.map(pm => (
              <TouchableOpacity
                key={pm.value}
                onPress={() => setPurchasePayMethod(pm.value)}
                style={[styles.chip, purchasePayMethod === pm.value && styles.chipActive]}
              >
                <Text style={[styles.chipText, purchasePayMethod === pm.value && styles.chipTextActive]}>{pm.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {qty && costPrice && !isNaN(parseFloat(costPrice)) && (
            <Text style={styles.totalPreview}>Total: {fmt(parseInt(qty || '0') * parseFloat(costPrice || '0'))}</Text>
          )}

          <View style={styles.formButtons}>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowForm(false)}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.saveBtn} onPress={() => handleSave(false)} disabled={saving}>
              {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.saveText}>Save</Text>}
            </TouchableOpacity>
            {efrisEnabled && (
              <TouchableOpacity style={styles.efrisBtn} onPress={() => handleSave(true)} disabled={saving}>
                <Text style={styles.saveText}>Increase with EFRIS</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}

      <FlatList
        data={purchases}
        keyExtractor={(p) => p.id}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.card} onPress={() => router.push({ pathname: '/purchase-detail', params: { purchaseId: item.id } } as any)}>
            <View style={styles.cardTop}>
              <Text style={styles.cardTitle}>{item.supplier_name || 'Unknown Supplier'}</Text>
              <Text style={styles.cardTotal}>{fmt(item.total_amount)}</Text>
            </View>
            <Text style={styles.cardSub}>By {item.created_by_name} · {new Date(item.created_at).toLocaleDateString()}{efrisEnabled ? (item.efris_submitted ? '  ✅ EFRIS' : '  ⚠️ Not submitted') : ''}</Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <FontAwesome name="shopping-basket" size={48} color="#333" />
            <Text style={styles.emptyText}>No purchases recorded yet</Text>
          </View>
        }
      />
    </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e', padding: 16 },
  addBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#e94560', borderRadius: 12, padding: 14, marginBottom: 14, gap: 8 },
  addBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 15 },
  formCard: { backgroundColor: '#16213e', borderRadius: 16, padding: 16, marginBottom: 14 },
  formTitle: { color: '#fff', fontSize: 18, fontWeight: 'bold', marginBottom: 12 },
  label: { color: '#aaa', fontSize: 13, marginBottom: 6 },
  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 18, backgroundColor: '#0f3460', borderWidth: 1, borderColor: '#0f3460', marginBottom: 4 },
  chipActive: { backgroundColor: '#e94560', borderColor: '#e94560' },
  chipText: { color: '#aaa', fontSize: 13 },
  chipTextActive: { color: '#fff', fontWeight: 'bold' },
  input: { backgroundColor: '#0f3460', borderRadius: 10, padding: 14, color: '#fff', fontSize: 15, marginBottom: 10 },
  totalPreview: { color: '#4CAF50', fontWeight: 'bold', fontSize: 15, textAlign: 'center', marginBottom: 10 },
  formButtons: { flexDirection: 'row', gap: 10 },
  cancelBtn: { flex: 1, padding: 14, borderRadius: 10, backgroundColor: '#333', alignItems: 'center' },
  cancelText: { color: '#aaa', fontWeight: 'bold' },
  saveBtn: { flex: 1, padding: 14, borderRadius: 10, backgroundColor: '#e94560', alignItems: 'center' },
  saveText: { color: '#fff', fontWeight: 'bold' },
  efrisBtn: { flex: 1, padding: 14, borderRadius: 10, backgroundColor: '#7C3AED', alignItems: 'center' },
  card: { backgroundColor: '#16213e', borderRadius: 12, padding: 14, marginBottom: 10 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'transparent' },
  cardTitle: { color: '#fff', fontSize: 15, fontWeight: 'bold' },
  cardTotal: { color: '#4CAF50', fontSize: 15, fontWeight: 'bold' },
  cardSub: { color: '#555', fontSize: 12, marginTop: 4 },
  empty: { alignItems: 'center', paddingTop: 40 },
  emptyText: { color: '#555', fontSize: 16, marginTop: 12 },
});
