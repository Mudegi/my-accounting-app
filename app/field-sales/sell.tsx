import React, { useState, useEffect, useCallback } from 'react';
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
import { getAssignments, type FieldStockAssignment } from '@/lib/field-sales';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useFocusEffect, useRouter } from 'expo-router';
import * as Location from 'expo-location';

type CartItem = {
  assignment_id: string;
  product_id: string;
  product_name: string;
  price: number;
  cost_price: number;
  quantity: number;
  max_qty: number; // available from assignment
};

export default function FieldSellScreen() {
  const { business, profile, fmt, currentBranch } = useAuth();
  const router = useRouter();
  const [assignments, setAssignments] = useState<FieldStockAssignment[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [completing, setCompleting] = useState(false);

  // Customer fields (mandatory for field sales)
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');

  // GPS
  const [gpsLat, setGpsLat] = useState<number | null>(null);
  const [gpsLng, setGpsLng] = useState<number | null>(null);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsError, setGpsError] = useState('');

  // Payment
  const [payMethod, setPayMethod] = useState('cash');
  const [showCheckout, setShowCheckout] = useState(false);

  // Load active assignments
  const load = useCallback(async () => {
    if (!business || !profile) return;
    setLoading(true);
    const result = await getAssignments({
      businessId: business.id,
      userId: profile.id,
      status: 'active',
    });
    // Also load partially returned
    const result2 = await getAssignments({
      businessId: business.id,
      userId: profile.id,
      status: 'partially_returned',
    });
    setAssignments([...result.data, ...result2.data]);
    setLoading(false);
  }, [business, profile]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Request GPS on mount
  useEffect(() => {
    (async () => {
      setGpsLoading(true);
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setGpsError('Location permission denied');
        setGpsLoading(false);
        return;
      }
      try {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
        setGpsLat(loc.coords.latitude);
        setGpsLng(loc.coords.longitude);
      } catch (e) {
        setGpsError('Could not get location');
      }
      setGpsLoading(false);
    })();
  }, []);

  const refreshGps = async () => {
    setGpsLoading(true);
    setGpsError('');
    try {
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      setGpsLat(loc.coords.latitude);
      setGpsLng(loc.coords.longitude);
    } catch (e) {
      setGpsError('Could not get location');
    }
    setGpsLoading(false);
  };

  // Get available qty for an assignment (assigned - returned - already in cart)
  const getAvailableQty = (assignment: FieldStockAssignment) => {
    const balance = assignment.qty_assigned - assignment.qty_returned;
    const inCart = cart.find(c => c.assignment_id === assignment.id)?.quantity || 0;
    return balance - inCart;
  };

  // Add to cart from assignment
  const addToCart = async (assignment: FieldStockAssignment) => {
    const available = getAvailableQty(assignment);
    if (available <= 0) {
      Alert.alert('No Stock', 'All assigned stock for this product is already in the cart or sold.');
      return;
    }

    // Get selling price from inventory
    const { data: inv } = await supabase
      .from('inventory')
      .select('selling_price, avg_cost_price')
      .eq('product_id', assignment.product_id)
      .eq('branch_id', assignment.branch_id)
      .single();

    const price = inv?.selling_price || 0;
    const costPrice = inv?.avg_cost_price || 0;

    setCart(prev => {
      const existing = prev.find(c => c.assignment_id === assignment.id);
      if (existing) {
        return prev.map(c =>
          c.assignment_id === assignment.id
            ? { ...c, quantity: c.quantity + 1 }
            : c
        );
      }
      return [...prev, {
        assignment_id: assignment.id,
        product_id: assignment.product_id,
        product_name: assignment.product_name || '?',
        price,
        cost_price: costPrice,
        quantity: 1,
        max_qty: assignment.qty_assigned - assignment.qty_returned,
      }];
    });
  };

  const updateQty = (assignmentId: string, delta: number) => {
    setCart(prev =>
      prev
        .map(c => c.assignment_id === assignmentId
          ? { ...c, quantity: Math.max(0, Math.min(c.max_qty, c.quantity + delta)) }
          : c
        )
        .filter(c => c.quantity > 0)
    );
  };

  const removeFromCart = (assignmentId: string) => {
    setCart(prev => prev.filter(c => c.assignment_id !== assignmentId));
  };

  const subtotal = cart.reduce((sum, c) => sum + c.price * c.quantity, 0);
  const totalAmount = subtotal; // No tax for field sales simplicity

  // Complete field sale
  const completeSale = async () => {
    if (cart.length === 0) { Alert.alert('Empty Cart', 'Add items first.'); return; }
    if (!customerName.trim()) { Alert.alert('Required', 'Customer name is mandatory for field sales.'); return; }
    if (!customerPhone.trim()) { Alert.alert('Required', 'Customer phone number is mandatory for field sales.'); return; }
    if (!business || !profile) return;

    setCompleting(true);

    try {
      // Refresh GPS one more time
      try {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        setGpsLat(loc.coords.latitude);
        setGpsLng(loc.coords.longitude);
      } catch (e) { /* use existing coords */ }

      // 1. Create or find customer
      let customerId: string | null = null;
      const { data: existingCustomer } = await supabase
        .from('customers')
        .select('id')
        .eq('business_id', business.id)
        .eq('phone', customerPhone.trim())
        .single();

      if (existingCustomer) {
        customerId = existingCustomer.id;
      } else {
        const { data: newCustomer } = await supabase
          .from('customers')
          .insert({
            business_id: business.id,
            name: customerName.trim(),
            phone: customerPhone.trim(),
            source: 'field',
            created_by: profile.id,
            buyer_type: '1', // B2C default
          })
          .select()
          .single();
        if (newCustomer) customerId = newCustomer.id;
      }

      // 2. Create sale with pending_approval status
      const { data: sale, error: saleError } = await supabase
        .from('sales')
        .insert({
          business_id: business.id,
          branch_id: currentBranch?.id || cart[0]?.assignment_id ? assignments.find(a => a.id === cart[0]?.assignment_id)?.branch_id : null,
          seller_id: profile.id,
          subtotal: subtotal,
          tax_amount: 0,
          discount_amount: 0,
          total_amount: Math.round(totalAmount),
          payment_method: payMethod,
          status: 'pending_approval',
          is_field_sale: true,
          gps_lat: gpsLat,
          gps_lng: gpsLng,
          customer_id: customerId,
          customer_name: customerName.trim(),
          customer_phone: customerPhone.trim(),
        })
        .select()
        .single();

      if (saleError) throw saleError;

      // 3. Create sale items
      const saleItems = cart.map(c => ({
        sale_id: sale.id,
        product_id: c.product_id,
        product_name: c.product_name,
        quantity: c.quantity,
        unit_price: c.price,
        cost_price: c.cost_price,
        tax_rate: 0,
        discount_amount: 0,
        line_total: c.price * c.quantity,
      }));

      const { error: itemsError } = await supabase
        .from('sale_items')
        .insert(saleItems);

      if (itemsError) throw itemsError;

      // 4. Audit log
      await supabase.from('audit_log').insert({
        business_id: business.id,
        user_id: profile.id,
        action: 'field_sale_created',
        table_name: 'sales',
        record_id: sale.id,
        new_data: {
          total: totalAmount,
          customer_name: customerName.trim(),
          customer_phone: customerPhone.trim(),
          gps_lat: gpsLat,
          gps_lng: gpsLng,
          items: cart.length,
        },
      });

      Alert.alert(
        '✅ Field Sale Recorded',
        `Sale of ${fmt(totalAmount)} saved. Pending admin approval.\n\nCustomer: ${customerName.trim()}\nPhone: ${customerPhone.trim()}${gpsLat ? `\nLocation: ${gpsLat.toFixed(4)}, ${gpsLng?.toFixed(4)}` : ''}`,
        [{ text: 'OK' }]
      );

      // Reset
      setCart([]);
      setCustomerName('');
      setCustomerPhone('');
      setShowCheckout(false);
      load(); // Refresh assignments

    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to record sale');
    } finally {
      setCompleting(false);
    }
  };

  return (
    <View style={styles.container}>
      {/* GPS Status Bar */}
      <View style={styles.gpsBar}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'transparent' }}>
          <FontAwesome name="map-marker" size={16} color={gpsLat ? '#4CAF50' : '#e94560'} />
          <Text style={{ color: gpsLat ? '#4CAF50' : '#aaa', fontSize: 12 }}>
            {gpsLoading ? 'Getting location...' : gpsLat ? `${gpsLat.toFixed(4)}, ${gpsLng?.toFixed(4)}` : gpsError || 'No location'}
          </Text>
        </View>
        <TouchableOpacity onPress={refreshGps} disabled={gpsLoading}>
          <FontAwesome name="refresh" size={14} color="#aaa" />
        </TouchableOpacity>
      </View>

      {/* Header / Cart Summary */}
      {cart.length > 0 && (
        <View style={styles.cartSummary}>
          <Text style={styles.cartTotal}>{fmt(totalAmount)}</Text>
          <Text style={styles.cartCount}>{cart.reduce((s, c) => s + c.quantity, 0)} items in cart</Text>
          <TouchableOpacity style={styles.checkoutBtn} onPress={() => setShowCheckout(true)}>
            <Text style={styles.checkoutBtnText}>Checkout →</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Available Stock to Sell */}
      <Text style={styles.sectionTitle}>Your Assigned Stock</Text>

      {loading ? (
        <ActivityIndicator color="#e94560" style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={assignments}
          keyExtractor={a => a.id}
          renderItem={({ item }) => {
            const available = getAvailableQty(item);
            const inCart = cart.find(c => c.assignment_id === item.id);
            return (
              <View style={styles.stockCard}>
                <View style={{ flex: 1, backgroundColor: 'transparent' }}>
                  <Text style={styles.stockName}>{item.product_name}</Text>
                  <Text style={styles.stockQty}>
                    {available} available · {item.qty_assigned - item.qty_returned} total
                  </Text>
                </View>
                {inCart ? (
                  <View style={styles.qtyControls}>
                    <TouchableOpacity style={styles.qtyBtn} onPress={() => updateQty(item.id, -1)}>
                      <FontAwesome name="minus" size={12} color="#fff" />
                    </TouchableOpacity>
                    <Text style={styles.qtyText}>{inCart.quantity}</Text>
                    <TouchableOpacity
                      style={[styles.qtyBtn, { backgroundColor: '#4CAF50' }]}
                      onPress={() => updateQty(item.id, 1)}
                    >
                      <FontAwesome name="plus" size={12} color="#fff" />
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={styles.addBtn}
                    onPress={() => addToCart(item)}
                    disabled={available <= 0}
                  >
                    <FontAwesome name="plus" size={14} color={available > 0 ? '#fff' : '#555'} />
                  </TouchableOpacity>
                )}
              </View>
            );
          }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <FontAwesome name="cubes" size={48} color="#333" />
              <Text style={styles.emptyText}>No active stock assignments</Text>
              <Text style={styles.emptyHint}>Ask your admin to assign stock to you</Text>
            </View>
          }
        />
      )}

      {/* Checkout Modal */}
      <Modal visible={showCheckout} animationType="slide" transparent>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <ScrollView>
              <Text style={styles.formTitle}>Complete Field Sale</Text>

              {/* Cart Summary */}
              <View style={styles.checkoutCart}>
                {cart.map(c => (
                  <View key={c.assignment_id} style={styles.checkoutItem}>
                    <Text style={{ color: '#fff', flex: 1, fontSize: 14 }}>{c.product_name}</Text>
                    <Text style={{ color: '#aaa', fontSize: 14 }}>{c.quantity} × {fmt(c.price)}</Text>
                    <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 14, marginLeft: 8 }}>
                      {fmt(c.price * c.quantity)}
                    </Text>
                  </View>
                ))}
                <View style={styles.checkoutTotal}>
                  <Text style={{ color: '#fff', fontSize: 18, fontWeight: 'bold' }}>Total</Text>
                  <Text style={{ color: '#e94560', fontSize: 20, fontWeight: 'bold' }}>{fmt(totalAmount)}</Text>
                </View>
              </View>

              {/* Customer Details (mandatory) */}
              <Text style={styles.label}>Customer Name *</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. John Doe"
                placeholderTextColor="#555"
                value={customerName}
                onChangeText={setCustomerName}
              />

              <Text style={styles.label}>Customer Phone *</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. +256 700 123456"
                placeholderTextColor="#555"
                value={customerPhone}
                onChangeText={setCustomerPhone}
                keyboardType="phone-pad"
              />

              {/* Payment Method */}
              <Text style={styles.label}>Payment Method</Text>
              <View style={styles.payRow}>
                {[
                  { key: 'cash', label: 'Cash', icon: 'money' },
                  { key: 'mobile_money', label: 'MoMo', icon: 'mobile' },
                ].map(m => (
                  <TouchableOpacity
                    key={m.key}
                    style={[styles.payChip, payMethod === m.key && styles.payChipActive]}
                    onPress={() => setPayMethod(m.key)}
                  >
                    <FontAwesome name={m.icon as any} size={14} color={payMethod === m.key ? '#fff' : '#aaa'} />
                    <Text style={[styles.payChipText, payMethod === m.key && { color: '#fff' }]}>{m.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* GPS Info */}
              <View style={styles.gpsInfo}>
                <FontAwesome name="map-marker" size={14} color={gpsLat ? '#4CAF50' : '#FF9800'} />
                <Text style={{ color: gpsLat ? '#4CAF50' : '#FF9800', fontSize: 12, marginLeft: 8 }}>
                  {gpsLat ? `Location: ${gpsLat.toFixed(4)}, ${gpsLng?.toFixed(4)}` : 'Location not available — sale will still be saved'}
                </Text>
              </View>

              <Text style={styles.pendingNote}>
                ⏳ This sale will be saved as "Pending Approval". Your admin must approve it before it counts in accounting.
              </Text>

              <TouchableOpacity
                style={[styles.completeBtn, completing && { opacity: 0.6 }]}
                onPress={completeSale}
                disabled={completing}
              >
                {completing ? <ActivityIndicator color="#fff" /> : (
                  <Text style={styles.completeBtnText}>Record Sale ({fmt(totalAmount)})</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowCheckout(false)}>
                <Text style={styles.cancelBtnText}>Back to Cart</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e', padding: 16 },
  gpsBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#16213e', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 12 },
  cartSummary: { backgroundColor: '#0f3460', borderRadius: 14, padding: 16, marginBottom: 14, alignItems: 'center' },
  cartTotal: { color: '#fff', fontSize: 24, fontWeight: 'bold' },
  cartCount: { color: '#aaa', fontSize: 13, marginTop: 4 },
  checkoutBtn: { backgroundColor: '#e94560', borderRadius: 10, paddingHorizontal: 24, paddingVertical: 10, marginTop: 10 },
  checkoutBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 15 },
  sectionTitle: { color: '#888', fontSize: 12, fontWeight: 'bold', letterSpacing: 1, marginBottom: 10 },
  stockCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#16213e', borderRadius: 12, padding: 14, marginBottom: 8 },
  stockName: { color: '#fff', fontSize: 15, fontWeight: 'bold' },
  stockQty: { color: '#aaa', fontSize: 12, marginTop: 3 },
  qtyControls: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'transparent' },
  qtyBtn: { backgroundColor: '#e94560', width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  qtyText: { color: '#fff', fontSize: 16, fontWeight: 'bold', minWidth: 24, textAlign: 'center' },
  addBtn: { backgroundColor: '#4CAF50', width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  empty: { alignItems: 'center', paddingTop: 60 },
  emptyText: { color: '#555', fontSize: 16, marginTop: 12 },
  emptyHint: { color: '#444', fontSize: 13, marginTop: 4 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#1a1a2e', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: '92%' },
  formTitle: { fontSize: 22, fontWeight: 'bold', color: '#fff', marginBottom: 16 },
  checkoutCart: { backgroundColor: '#16213e', borderRadius: 14, padding: 14, marginBottom: 16 },
  checkoutItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, backgroundColor: 'transparent' },
  checkoutTotal: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: '#0f3460', paddingTop: 10, marginTop: 6, backgroundColor: 'transparent' },
  label: { fontSize: 13, color: '#aaa', marginBottom: 6, marginTop: 12 },
  input: { backgroundColor: '#16213e', borderRadius: 10, padding: 12, color: '#fff', fontSize: 15, borderWidth: 1, borderColor: '#0f3460' },
  payRow: { flexDirection: 'row', gap: 10, backgroundColor: 'transparent' },
  payChip: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 10, borderRadius: 10, backgroundColor: '#16213e', borderWidth: 1, borderColor: '#0f3460' },
  payChipActive: { backgroundColor: '#e94560', borderColor: '#e94560' },
  payChipText: { color: '#aaa', fontWeight: 'bold', fontSize: 14 },
  gpsInfo: { flexDirection: 'row', alignItems: 'center', marginTop: 16, backgroundColor: 'transparent' },
  pendingNote: { color: '#FF9800', fontSize: 12, marginTop: 12, backgroundColor: '#FF980015', padding: 10, borderRadius: 8, overflow: 'hidden' },
  completeBtn: { backgroundColor: '#4CAF50', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 16 },
  completeBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  cancelBtn: { padding: 14, alignItems: 'center', marginTop: 8 },
  cancelBtnText: { color: '#aaa', fontSize: 15 },
});
