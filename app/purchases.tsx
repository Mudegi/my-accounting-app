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
  ScrollView,
} from 'react-native';
import { Text, View } from '@/components/Themed';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useFocusEffect, useRouter } from 'expo-router';
import { submitStockIncrease, type EfrisConfig } from '@/lib/efris';
import { postPurchaseEntry, PAYMENT_METHODS } from '@/lib/accounting';
import { loadCurrencies, convertCurrency, getCurrency, type Currency } from '@/lib/currency';

type Purchase = {
  id: string;
  supplier_name: string | null;
  total_amount: number;
  created_at: string;
  created_by_name: string;
  payment_method: string;
  efris_submitted?: boolean;
};

type Product = { id: string; name: string; efris_product_code: string | null; is_service?: boolean };
type SupplierOption = { id: string; name: string; tin: string | null };

type PurchaseLine = {
  id: string;
  product_id: string;
  product_name: string;
  quantity: string;
  unit_cost: string; // Net (excl tax)
  tax_category: string; // code
  tax_rate: number;
  tax_amount: number;
  line_total: number;
};

export default function PurchasesScreen() {
  const { business, currentBranch, profile, fmt, currency, taxes } = useAuth();
  const router = useRouter();
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  
  // Header Info
  const [supplier, setSupplier] = useState('');
  const [supplierTin, setSupplierTin] = useState('');
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null);
  const [supplierSearch, setSupplierSearch] = useState('');
  const [purchasePayMethod, setPurchasePayMethod] = useState('cash');
  const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().split('T')[0]);

  // Multi-currency support
  const [purchaseCurrency, setPurchaseCurrency] = useState(business?.default_currency || 'UGX');
  const [exchangeRate, setExchangeRate] = useState(1);
  const [availableCurrencies, setAvailableCurrencies] = useState<Currency[]>([]);
  const [isConverting, setIsConverting] = useState(false);

  // Line Items
  const [lineItems, setLineItems] = useState<PurchaseLine[]>([]);
  const [activeItemIdx, setActiveItemIdx] = useState<number | null>(null);
  const [productSearch, setProductSearch] = useState('');
  const [showProductList, setShowProductList] = useState(false);

  const [saving, setSaving] = useState(false);
  const efrisEnabled = business?.is_efris_enabled ?? false;
  const [suppliersList, setSuppliersList] = useState<SupplierOption[]>([]);

  const load = useCallback(async () => {
    if (!business || !currentBranch) return;
    
    // Fetch purchases for current branch. 
    // We removed 'profiles(full_name)' join because it was causing query failures.
    const { data, error } = await supabase
      .from('purchases')
      .select(`id, supplier_name, total_amount, base_total, created_at, efris_submitted, created_by, payment_method`)
      .eq('business_id', business.id)
      .eq('branch_id', currentBranch.id)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      console.error('Error loading purchases:', error);
      return;
    }

    if (data) {
      // Manually resolve creator names from profiles
      const creatorIds = [...new Set(data.map((p: any) => p.created_by).filter(Boolean))];
      const creatorMap: Record<string, string> = {};
      
      if (creatorIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, full_name')
          .in('id', creatorIds);
        profiles?.forEach(p => { creatorMap[p.id] = p.full_name; });
      }

      setPurchases(data.map((p: any) => ({
        id: p.id,
        supplier_name: p.supplier_name,
        total_amount: p.total_amount,
        created_at: p.created_at,
        created_by_name: creatorMap[p.created_by] || '?',
        payment_method: p.payment_method || 'cash',
        efris_submitted: p.efris_submitted
      })));
    }
  }, [business, currentBranch]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  useEffect(() => {
    loadCurrencies().then(setAvailableCurrencies);
  }, []);

  useEffect(() => {
    if (business?.default_currency) {
      setPurchaseCurrency(business.default_currency);
    }
  }, [business?.default_currency]);

  useEffect(() => {
    const updateRate = async () => {
      if (!business) return;
      if (purchaseCurrency === business.default_currency) {
        setExchangeRate(1);
        return;
      }
      setIsConverting(true);
      try {
        const { rate } = await convertCurrency(business.id, 1, business.default_currency, purchaseCurrency);
        setExchangeRate(rate);
      } catch (e) {
        console.error('Rate update error:', e);
      } finally {
        setIsConverting(false);
      }
    };
    updateRate();
  }, [purchaseCurrency, business?.default_currency]);

  const loadProducts = async () => {
    if (!business) return;
    const { data } = await supabase
      .from('products')
      .select('id, name, efris_product_code, is_service')
      .eq('business_id', business.id)
      .eq('is_service', false) // Filter out services
      .order('name');
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

    loadSuppliers(); 
    const defTax = taxes.find(t => t.is_default) || taxes[0] || { code: '01', rate: 0.18 };
    setLineItems([{
      id: Math.random().toString(),
      product_id: '',
      product_name: '',
      quantity: '',
      unit_cost: '',
      tax_category: defTax.code,
      tax_rate: defTax.rate,
      tax_amount: 0,
      line_total: 0
    }]);
    setShowForm(true); 
  };

  const addLine = () => {
    const defTax = taxes.find(t => t.is_default) || taxes[0] || { code: '01', rate: 0.18 };
    setLineItems([...lineItems, {
      id: Math.random().toString(),
      product_id: '',
      product_name: '',
      quantity: '',
      unit_cost: '',
      tax_category: defTax.code,
      tax_rate: defTax.rate,
      tax_amount: 0,
      line_total: 0
    }]);
  };

  const removeLine = (id: string) => {
    if (lineItems.length === 1) return;
    setLineItems(lineItems.filter(l => l.id !== id));
  };

  const updateLine = (idx: number, updates: Partial<PurchaseLine>) => {
    const newItems = [...lineItems];
    const item = { ...newItems[idx], ...updates };
    
    // Recalculate
    const q = parseFloat(item.quantity) || 0;
    const c = parseFloat(item.unit_cost) || 0;
    const r = item.tax_rate;
    
    item.tax_amount = q * c * r;
    item.line_total = q * c * (1 + r);
    
    newItems[idx] = item;
    setLineItems(newItems);
  };

  const totals = lineItems.reduce((acc, item) => ({
    subtotal: acc.subtotal + (parseFloat(item.quantity) || 0) * (parseFloat(item.unit_cost) || 0),
    vat: acc.vat + item.tax_amount,
    total: acc.total + item.line_total
  }), { subtotal: 0, vat: 0, total: 0 });

  const handleSave = async (withEfris: boolean = false) => {
    const validItems = lineItems.filter(l => l.product_id && parseFloat(l.quantity) > 0);
    if (validItems.length === 0) { Alert.alert('Error', 'Add at least one product with quantity'); return; }
    
    if (!business || !currentBranch || !profile) return;

    setSaving(true);
    try {
      const { data: purchase, error } = await supabase
        .from('purchases')
        .insert({
          business_id: business.id,
          branch_id: currentBranch.id,
          supplier_name: supplier.trim() || null,
          supplier_id: selectedSupplierId || null,
          total_amount: totals.total,
          subtotal_amount: totals.subtotal,
          vat_amount: totals.vat,
          currency: purchaseCurrency,
          exchange_rate: 1 / exchangeRate, // rate back to base (e.g. 1 USD = 3800 UGX)
          base_total: Math.round(totals.total / exchangeRate),
          payment_method: purchasePayMethod,
          status: purchasePayMethod === 'credit' ? 'unpaid' : 'paid',
          paid_amount: purchasePayMethod === 'credit' ? 0 : totals.total,
          purchase_date: purchaseDate,
          created_by: profile.id,
        })
        .select()
        .single();

      if (error) throw error;

      // Batch insert items
      const { error: itemsErr } = await supabase.from('purchase_items').insert(
        validItems.map(l => ({
          purchase_id: purchase.id,
          product_id: l.product_id,
          quantity: parseFloat(l.quantity),
          unit_cost: parseFloat(l.unit_cost),
          line_total: l.line_total,
          tax_rate: l.tax_rate * 100,
          tax_amount: l.tax_amount,
          tax_category_code: l.tax_category
        }))
      );
      if (itemsErr) throw itemsErr;

      // Update Inventory (Convert to base currency cost for stock valuation)
      for (const item of validItems) {
        await supabase.rpc('increment_inventory', {
          p_branch_id: currentBranch.id,
          p_product_id: item.product_id,
          p_quantity: parseFloat(item.quantity),
          p_unit_cost: parseFloat(item.unit_cost) / exchangeRate,
        });
      }

      // Accounting
      postPurchaseEntry({
        businessId: business.id,
        branchId: currentBranch.id,
        purchaseId: purchase.id,
        totalCost: totals.total / exchangeRate,
        vatAmount: totals.vat / exchangeRate,
        paymentMethod: purchasePayMethod,
        userId: profile.id,
        currencyCode: purchaseCurrency,
        exchangeRate: 1 / exchangeRate,
      });

      // EFRIS
      if (withEfris && efrisEnabled) {
        // Build efris payload for multiple items
        const config: EfrisConfig = {
          apiKey: business.efris_api_key!,
          apiUrl: business.efris_api_url || '',
          testMode: business.efris_test_mode ?? true,
        };
        
        const goodsStockInItem = validItems
          .map(l => {
            const p = products.find(prod => prod.id === l.product_id);
            if (!p?.efris_product_code) return null;
            return {
              goodsCode: p.efris_product_code,
              quantity: l.quantity,
              unitPrice: l.unit_cost,
            };
          })
          .filter(Boolean);

        if (goodsStockInItem.length > 0) {
          const result = await submitStockIncrease(config, {
            goodsStockIn: {
              operationType: '101',
              supplierName: supplier.trim() || 'Unknown',
              supplierTin: supplierTin.trim(),
              stockInType: '101',
              stockInDate: purchaseDate,
              remarks: `Batch purchase #${purchase.id.slice(0,8)}`,
              goodsTypeCode: '101',
            },
            goodsStockInItem: goodsStockInItem as any,
          });
          
          if (result.success) {
            await supabase.from('purchases').update({
                supplier_tin: supplierTin.trim(),
                efris_submitted: true,
                efris_submitted_at: new Date().toISOString(),
            }).eq('id', purchase.id);
          }
        }
      }

      Alert.alert('Success', 'Stock purchase recorded successfully');
      setShowForm(false);
      load();
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
    <View style={styles.container}>
      <TouchableOpacity style={styles.addBtn} onPress={openForm}>
        <FontAwesome name="plus" size={16} color="#fff" />
        <Text style={styles.addBtnText}>Record Stock Purchase</Text>
      </TouchableOpacity>

      {showForm && (
        <ScrollView style={styles.formCard} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
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
                onFocus={() => { if (!supplierSearch) setSupplierSearch(' '); setTimeout(() => setSupplierSearch(''), 100); }}
              />
              {((supplierSearch.trim().length > 0) || (suppliersList.length > 0 && supplierSearch === '')) && filteredSuppliers.length > 0 && !selectedSupplierId && (
                <View style={{ backgroundColor: '#0f3460', borderRadius: 10, marginBottom: 10, maxHeight: 150, borderWidth: 1, borderColor: '#e94560' }}>
                  {filteredSuppliers.slice(0, 5).map(s => (
                    <TouchableOpacity key={s.id} onPress={() => selectSupplier(s)} style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: '#1a1a2e' }}>
                      <Text style={{ color: '#fff', fontSize: 14, fontWeight: 'bold' }}>{s.name}</Text>
                      {s.tin ? <Text style={{ color: '#aaa', fontSize: 11 }}>TIN: {s.tin}</Text> : null}
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </>
          )}
          {efrisEnabled && !selectedSupplierId && (
            <TextInput style={[styles.input, { borderColor: '#7C3AED44' }]} placeholder="Supplier TIN (for EFRIS stock-in)" placeholderTextColor="#555" value={supplierTin} onChangeText={setSupplierTin} keyboardType="numeric" />
          )}

          {/* Currency Selection */}
          <Text style={styles.label}>Purchase Currency</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
            <View style={styles.chipRow}>
              {availableCurrencies.filter(c => c.is_active).map((c) => (
                <TouchableOpacity
                  key={c.code}
                  style={[styles.chip, purchaseCurrency === c.code && styles.chipActive]}
                  onPress={() => setPurchaseCurrency(c.code)}
                >
                  <Text style={[styles.chipText, purchaseCurrency === c.code && styles.chipTextActive]}>{c.code}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>

          {purchaseCurrency !== business?.default_currency && (
            <View style={{ marginBottom: 12, padding: 10, backgroundColor: '#0f3460', borderRadius: 8 }}>
              <Text style={{ color: '#aaa', fontSize: 12 }}>Equiv. to:</Text>
              <Text style={{ color: '#4CAF50', fontSize: 16, fontWeight: 'bold' }}>
                {fmt(Math.round(totals.total / exchangeRate))} (Total)
              </Text>
              <Text style={{ color: '#666', fontSize: 10, marginTop: 2 }}>Rate: 1 {business?.default_currency} = {exchangeRate.toFixed(4)} {purchaseCurrency}</Text>
            </View>
          )}

          <Text style={styles.sectionTitle}>Line Items</Text>
          {lineItems.map((item, idx) => (
            <View key={item.id} style={styles.lineRow}>
               <View style={{ flex: 1, backgroundColor: 'transparent' }}>
                  <Text style={styles.itemLabel}>Item {idx + 1}</Text>
                  {item.product_id ? (
                    <TouchableOpacity 
                      style={styles.selectedProductCard}
                      onPress={() => {
                        const newLines = [...lineItems];
                        newLines[idx].product_id = '';
                        newLines[idx].product_name = '';
                        setLineItems(newLines);
                      }}
                    >
                      <Text style={{ color: '#fff', fontSize: 13 }} numberOfLines={1}>{item.product_name}</Text>
                      <FontAwesome name="times-circle" size={14} color="#e94560" />
                    </TouchableOpacity>
                  ) : (
                    <View>
                      <TextInput
                        style={styles.lineInput}
                        placeholder="Search product..."
                        placeholderTextColor="#555"
                        onFocus={() => { setActiveItemIdx(idx); setShowProductList(true); }}
                        onChangeText={(t) => { setProductSearch(t); setActiveItemIdx(idx); setShowProductList(true); }}
                      />
                      {showProductList && activeItemIdx === idx && (
                        <View style={styles.productDropdown}>
                          {products
                            .filter(p => !productSearch || p.name.toLowerCase().includes(productSearch.toLowerCase()))
                            .slice(0, 5)
                            .map(p => (
                              <TouchableOpacity
                                key={p.id}
                                style={styles.productDropdownItem}
                                onPress={() => {
                                  updateLine(idx, { product_id: p.id, product_name: p.name });
                                  setShowProductList(false);
                                  setProductSearch('');
                                }}
                              >
                                <Text style={{ color: '#fff', fontSize: 13 }}>{p.name}</Text>
                              </TouchableOpacity>
                            ))}
                        </View>
                      )}
                    </View>
                  )}

                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 8, backgroundColor: 'transparent' }}>
                    <TextInput 
                      style={[styles.lineInput, { flex: 0.8 }]} 
                      placeholder="Qty" 
                      placeholderTextColor="#555" 
                      value={item.quantity}
                      onChangeText={(v) => updateLine(idx, { quantity: v })}
                      keyboardType="decimal-pad"
                    />
                    <TextInput 
                      style={[styles.lineInput, { flex: 1.5 }]} 
                      placeholder="Cost/Unit" 
                      placeholderTextColor="#555" 
                      value={item.unit_cost}
                      onChangeText={(v) => updateLine(idx, { unit_cost: v })}
                      keyboardType="numeric"
                    />
                    {efrisEnabled && (
                      <TouchableOpacity 
                        style={styles.taxPicker}
                        onPress={() => {
                          const nextTax = taxes[(taxes.findIndex(t => t.code === item.tax_category) + 1) % taxes.length];
                          if (nextTax) {
                            updateLine(idx, { tax_category: nextTax.code, tax_rate: nextTax.rate });
                          }
                        }}
                      >
                        <Text style={styles.taxText}>{taxes.find(t => t.code === item.tax_category)?.name.split(' ')[0] || 'Tax'}</Text>
                      </TouchableOpacity>
                    )}
                  </View>
               </View>
               <TouchableOpacity onPress={() => removeLine(item.id)} style={{ padding: 10, alignSelf: 'flex-start', marginTop: 20 }}>
                 <FontAwesome name="trash" size={20} color="#555" />
               </TouchableOpacity>
            </View>
          ))}

          <TouchableOpacity style={styles.addLineBtn} onPress={addLine}>
            <FontAwesome name="plus-circle" size={14} color="#e94560" />
            <Text style={styles.addLineText}>Add another item</Text>
          </TouchableOpacity>

          {/* Payment Method */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginVertical: 12, backgroundColor: 'transparent' }}>
            <Text style={[styles.label, { marginBottom: 0 }]}>Payment Method</Text>
            {purchasePayMethod === 'credit' && (
              <Text style={{ color: '#FF9800', fontSize: 11, fontWeight: 'bold' }}>Will record as Payable Debt</Text>
            )}
          </View>
          <ScrollView 
            horizontal 
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8, paddingRight: 20 }}
            style={{ marginBottom: 12, backgroundColor: 'transparent' }}
          >
            {PAYMENT_METHODS.map(pm => (
              <TouchableOpacity
                key={pm.value}
                onPress={() => setPurchasePayMethod(pm.value)}
                style={[styles.chip, purchasePayMethod === pm.value && styles.chipActive]}
              >
                <Text style={[styles.chipText, purchasePayMethod === pm.value && styles.chipTextActive]}>{pm.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Summary */}
          <View style={styles.summaryCard}>
            <View style={styles.sumRow}>
              <Text style={styles.sumLabel}>Subtotal</Text>
              <Text style={styles.sumValue}>{fmt(totals.subtotal)}</Text>
            </View>
            {efrisEnabled && (
              <View style={styles.sumRow}>
                <Text style={styles.sumLabel}>VAT Paid</Text>
                <Text style={styles.sumValue}>{fmt(totals.vat)}</Text>
              </View>
            )}
            <View style={[styles.sumRow, { borderTopWidth: 1, borderTopColor: '#0f3460', marginTop: 6, paddingTop: 6 }]}>
              <Text style={[styles.sumLabel, { fontWeight: 'bold', color: '#fff' }]}>Total Amount</Text>
              <Text style={[styles.sumValue, { fontWeight: 'bold', color: '#4CAF50', fontSize: 18 }]}>{fmt(totals.total)}</Text>
            </View>
          </View>

          <View style={styles.formButtons}>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowForm(false)}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.saveBtn} onPress={() => handleSave(false)} disabled={saving}>
              {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.saveText}>Save Bill</Text>}
            </TouchableOpacity>
            {efrisEnabled && (
              <TouchableOpacity style={styles.efrisBtn} onPress={() => handleSave(true)} disabled={saving}>
                <Text style={styles.saveText}>Save + EFRIS</Text>
              </TouchableOpacity>
            )}
          </View>
        </ScrollView>
      )}

      <FlatList
        data={purchases}
        keyExtractor={(p) => p.id}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.card} onPress={() => router.push({ pathname: '/purchase-detail', params: { purchaseId: item.id } } as any)}>
            <View style={styles.cardTop}>
              <Text style={styles.cardTitle}>{item.supplier_name || 'Unknown Supplier'}</Text>
              <Text style={styles.cardTotal}>{fmt(item.base_total || item.total_amount)}</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4, backgroundColor: 'transparent', gap: 8 }}>
              <Text style={styles.cardSub}>By {item.created_by_name} · {new Date(item.created_at).toLocaleDateString()}</Text>
              <View style={[
                styles.methodBadge, 
                item.payment_method === 'credit' ? styles.badgeCredit : styles.badgeCash
              ]}>
                <Text style={styles.badgeText}>{item.payment_method === 'credit' ? 'Credit' : 'Cash'}</Text>
              </View>
              {efrisEnabled && (
                <Text style={{ fontSize: 11 }}>{item.efris_submitted ? '✅ EFRIS' : '⚠️ No EFRIS'}</Text>
              )}
            </View>
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
  formCard: { backgroundColor: '#16213e', borderRadius: 16, padding: 16, marginBottom: 14 } as any,
  formTitle: { color: '#fff', fontSize: 18, fontWeight: 'bold', marginBottom: 12 },
  label: { color: '#aaa', fontSize: 13, marginBottom: 6 },
  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 18, backgroundColor: '#0f3460', borderWidth: 1, borderColor: '#0f3460', marginBottom: 4 },
  chipActive: { backgroundColor: '#e94560', borderColor: '#e94560' },
  chipText: { color: '#aaa', fontSize: 13 },
  chipTextActive: { color: '#fff', fontWeight: 'bold' },
  input: { backgroundColor: '#0f3460', borderRadius: 10, padding: 14, color: '#fff', fontSize: 15, marginBottom: 10 },
  productDropdown: {
    position: 'absolute', top: 52, left: 0, right: 0, zIndex: 20,
    backgroundColor: '#0f3460', borderRadius: 10, maxHeight: 220,
    borderWidth: 1, borderColor: '#e94560',
    elevation: 10, shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4, shadowRadius: 6,
  },
  productDropdownItem: {
    padding: 12, borderBottomWidth: 1, borderBottomColor: '#1a1a2e',
  },
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
  cardSub: { color: '#555', fontSize: 12 },
  methodBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  badgeCash: { backgroundColor: '#4CAF5020' },
  badgeCredit: { backgroundColor: '#FF980020' },
  badgeText: { fontSize: 10, fontWeight: 'bold', color: '#aaa', textTransform: 'uppercase' },
  empty: { alignItems: 'center', paddingTop: 40 },
  emptyText: { color: '#555', fontSize: 16, marginTop: 12 },
  sectionTitle: { color: '#fff', fontSize: 16, fontWeight: 'bold', marginTop: 10, marginBottom: 10 },
  lineRow: { flexDirection: 'row', backgroundColor: '#0f346033', padding: 12, borderRadius: 12, marginBottom: 10, borderWidth: 1, borderColor: '#0f3460' },
  itemLabel: { color: '#aaa', fontSize: 11, marginBottom: 4, fontWeight: '600' },
  lineInput: { backgroundColor: '#0f3460', borderRadius: 8, padding: 10, color: '#fff', fontSize: 14 },
  selectedProductCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#0f3460', borderRadius: 8, padding: 10, gap: 10 },
  taxPicker: { flex: 1, backgroundColor: '#0f3460', borderRadius: 8, padding: 10, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#4CAF5044' },
  taxText: { color: '#4CAF50', fontSize: 12, fontWeight: 'bold' },
  addLineBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10 },
  addLineText: { color: '#e94560', fontWeight: 'bold', fontSize: 13 },
  summaryCard: { backgroundColor: '#0f346066', borderRadius: 14, padding: 14, marginVertical: 12 },
  sumRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  sumLabel: { color: '#aaa', fontSize: 13 },
  sumValue: { color: '#fff', fontSize: 14, fontWeight: '600' },
});
