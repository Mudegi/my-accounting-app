import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Text, View } from '@/components/Themed';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import {
  fiscalizeInvoice,
  buildInvoicePayload,
  EFRIS_PAYMENT_METHODS,
  EFRIS_BUYER_TYPES,
  EFRIS_UNIT_MAP,
  type EfrisConfig,
} from '@/lib/efris';

export default function FiscalizeSaleScreen() {
  const { saleId } = useLocalSearchParams<{ saleId: string }>();
  const { business, fmt } = useAuth();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [fiscalizing, setFiscalizing] = useState(false);
  const [sale, setSale] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);

  // Form states
  const [customerName, setCustomerName] = useState('');
  const [customerTin, setCustomerTin] = useState('');
  const [buyerType, setBuyerType] = useState('1');
  const [paymentMethod, setPaymentMethod] = useState('102');

  useEffect(() => {
    if (saleId) load();
  }, [saleId]);

  const load = async () => {
    try {
      setLoading(true);
      // Fetch Sale
      const { data: saleData, error: saleErr } = await supabase
        .from('sales')
        .select('*')
        .eq('id', saleId)
        .single();
      
      if (saleErr) throw saleErr;
      setSale(saleData);
      setCustomerName(saleData.customer_name || '');
      setCustomerTin(saleData.customer_tin || '');
      setBuyerType(saleData.buyer_type || '1');
      setPaymentMethod(saleData.efris_payment_code || '102');

      // Fetch Items with Product EFRIS data
      const { data: itemData, error: itemErr } = await supabase
        .from('sale_items')
        .select(`
          *,
          products:product_id(
            efris_product_code, 
            efris_item_code, 
            commodity_code, 
            tax_category_code, 
            unit
          )
        `)
        .eq('sale_id', saleId);
      
      if (itemErr) throw itemErr;
      setItems(itemData || []);

    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleFiscalize = async () => {
    if (!sale || !business) return;
    if (!business.efris_api_key) {
      Alert.alert('EFRIS not configured', 'Go to Settings → EFRIS Configuration first.');
      return;
    }

    // Validation: Ensure all products have EFRIS codes
    const unregistered = items.filter((si: any) => !si.products?.efris_product_code);
    if (unregistered.length > 0) {
      const names = unregistered.map((si: any) => si.product_name).join(', ');
      Alert.alert('Unregistered Products', `Cannot fiscalize because these products are not registered with EFRIS: ${names}`);
      return;
    }

    setFiscalizing(true);
    try {
      const config: EfrisConfig = {
        apiKey: business.efris_api_key,
        apiUrl: business.efris_api_url || '',
        testMode: business.efris_test_mode ?? true,
      };

      // Generate invoice number
      const { data: invNoData } = await supabase.rpc('generate_invoice_number');
      const invoiceNumber = invNoData || `INV-${Date.now()}`;

      // Build payload
      // Respecting user instruction: items already have tax_rate in sale_items
      const efrisItems = items.map((si: any) => ({
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

      const payload = buildInvoicePayload(
        invoiceNumber,
        {
          customer_name: customerName || undefined,
          customer_tin: customerTin || undefined,
          buyer_type: buyerType,
          payment_method: paymentMethod,
          total_amount: sale.total_total || sale.total_amount,
        },
        efrisItems
      );

      const result = await fiscalizeInvoice(config, payload);
      
      if (result.success) {
        // Update database
        const { error: upErr } = await supabase
          .from('sales')
          .update({
            is_fiscalized: true,
            efris_status: 'submitted',
            efris_fiscalized_at: new Date().toISOString(),
            invoice_number: result.invoice_number || invoiceNumber,
            customer_name: customerName,
            customer_tin: customerTin,
            buyer_type: buyerType,
            efris_payment_code: paymentMethod,
          })
          .eq('id', saleId);

        if (upErr) throw upErr;

        Alert.alert('✅ Success', 'Sale successfully submitted to URA/EFRIS.', [
          { text: 'View Sale', onPress: () => router.back() }
        ]);
      } else {
        // Log failure locally
        await supabase
          .from('sales')
          .update({
            efris_status: 'failed',
            efris_error: result.error || 'Unknown EFRIS error'
          })
          .eq('id', saleId);
          
        throw new Error(result.error || 'Fiscalization failed');
      }

    } catch (e: any) {
      Alert.alert('Fiscalization Error', e.message);
    } finally {
      setFiscalizing(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#e94560" />
        <Text style={{ marginTop: 10, color: '#888' }}>Loading sale data...</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <Stack.Screen options={{ title: 'Fiscalize Historical Sale', headerTintColor: '#e94560', headerStyle: { backgroundColor: '#1a1a2e' } }} />
      <ScrollView style={styles.container} contentContainerStyle={{ padding: 20 }}>
        
        <View style={styles.card}>
          <Text style={styles.cardTitle}>💰 Sale Summary</Text>
          <View style={styles.row}>
            <Text style={styles.label}>Sale ID</Text>
            <Text style={styles.value}>{saleId?.slice(0, 8)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Total Amount</Text>
            <Text style={[styles.value, { color: '#4CAF50', fontSize: 18, fontWeight: '800' }]}>{fmt(sale.total_amount)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Date</Text>
            <Text style={styles.value}>{new Date(sale.created_at).toLocaleString()}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>👤 Buyer Information</Text>
          
          <Text style={styles.formLabel}>Buyer Type</Text>
          <View style={styles.pickerRow}>
            {EFRIS_BUYER_TYPES.map(bt => (
              <TouchableOpacity
                key={bt.code}
                style={[styles.pickerBtn, buyerType === bt.code && styles.pickerBtnActive]}
                onPress={() => setBuyerType(bt.code)}
              >
                <Text style={[styles.pickerText, buyerType === bt.code && styles.pickerTextActive]}>{bt.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.formLabel}>Customer Name</Text>
          <TextInput
            style={styles.input}
            value={customerName}
            onChangeText={setCustomerName}
            placeholder="e.g. Kasumba & Sons Ltd"
            placeholderTextColor="#555"
          />

          <Text style={styles.formLabel}>Customer TIN (Optional for B2C)</Text>
          <TextInput
            style={styles.input}
            value={customerTin}
            onChangeText={setCustomerTin}
            placeholder="10-digit TIN"
            placeholderTextColor="#555"
            keyboardType="numeric"
            maxLength={10}
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>💳 Payment Details</Text>
          <Text style={styles.formLabel}>Select EFRIS Payment Method</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
            {EFRIS_PAYMENT_METHODS.map(pm => (
              <TouchableOpacity
                key={pm.code}
                style={[styles.chip, paymentMethod === pm.code && styles.chipActive]}
                onPress={() => setPaymentMethod(pm.code)}
              >
                <Text style={[styles.chipText, paymentMethod === pm.code && styles.chipTextActive]}>{pm.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>📦 Items List</Text>
          {items.map((item, idx) => (
            <View key={item.id} style={styles.itemRow}>
              <View style={{ flex: 1, backgroundColor: 'transparent' }}>
                <Text style={styles.itemName}>{item.product_name}</Text>
                <Text style={styles.itemMeta}>{item.quantity} x {fmt(item.unit_price)}</Text>
              </View>
              <View style={{ alignItems: 'flex-end', backgroundColor: 'transparent' }}>
                {item.products?.efris_product_code ? (
                  <Text style={{ color: '#4CAF50', fontSize: 10 }}>✓ Registered</Text>
                ) : (
                  <Text style={{ color: '#e94560', fontSize: 10 }}>⚠ Not Registered</Text>
                )}
                <Text style={{ color: '#fff', fontWeight: 'bold' }}>{fmt(item.line_total)}</Text>
              </View>
            </View>
          ))}
        </View>

        <TouchableOpacity 
          style={[styles.submitBtn, fiscalizing && { opacity: 0.7 }]}
          onPress={handleFiscalize}
          disabled={fiscalizing}
        >
          {fiscalizing ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <FontAwesome name="paper-plane" size={18} color="#fff" style={{ marginRight: 10 }} />
              <Text style={styles.submitBtnText}>Submit to EFRIS</Text>
            </>
          )}
        </TouchableOpacity>

        <Text style={styles.warningText}>
          Warning: This sale will be recorded with today's date in the EFRIS system. Ensure this is acceptable for your tax period.
        </Text>

      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#1a1a2e' },
  card: { backgroundColor: '#16213e', borderRadius: 16, padding: 20, marginBottom: 20, borderWidth: 1, borderColor: '#0f3460' },
  cardTitle: { color: '#fff', fontSize: 16, fontWeight: '800', marginBottom: 12 },
  section: { marginBottom: 24, backgroundColor: 'transparent' },
  sectionTitle: { color: '#fff', fontSize: 18, fontWeight: '800', marginBottom: 16 },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6, backgroundColor: 'transparent' },
  label: { color: '#aaa', fontSize: 13 },
  value: { color: '#fff', fontSize: 14, fontWeight: '600' },
  formLabel: { color: '#888', fontSize: 12, fontWeight: '700', marginBottom: 8, marginTop: 12 },
  input: { backgroundColor: '#16213e', color: '#fff', borderRadius: 10, padding: 14, fontSize: 16, borderWidth: 1, borderColor: '#0f3460' },
  pickerRow: { flexDirection: 'row', gap: 8, marginTop: 4, backgroundColor: 'transparent', flexWrap: 'wrap' },
  pickerBtn: { flex: 1, minWidth: '45%', paddingVertical: 10, borderRadius: 10, backgroundColor: '#16213e', alignItems: 'center', borderWidth: 1, borderColor: '#0f3460' },
  pickerBtnActive: { backgroundColor: '#e94560', borderColor: '#e94560' },
  pickerText: { color: '#aaa', fontWeight: 'bold' },
  pickerTextActive: { color: '#fff' },
  chip: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, backgroundColor: '#16213e', marginRight: 8, borderWidth: 1, borderColor: '#0f3460' },
  chipActive: { backgroundColor: '#4CAF50', borderColor: '#4CAF50' },
  chipText: { color: '#aaa', fontWeight: 'bold' },
  chipTextActive: { color: '#fff' },
  itemRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#0f3460', backgroundColor: 'transparent' },
  itemName: { color: '#fff', fontSize: 14, fontWeight: '600' },
  itemMeta: { color: '#888', fontSize: 12, marginTop: 2 },
  submitBtn: { backgroundColor: '#e94560', borderRadius: 12, paddingVertical: 16, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 10 },
  submitBtnText: { color: '#fff', fontSize: 18, fontWeight: '800' },
  warningText: { color: '#8B1A1A', fontSize: 12, textAlign: 'center', marginTop: 20, fontStyle: 'italic', lineHeight: 18 },
});
