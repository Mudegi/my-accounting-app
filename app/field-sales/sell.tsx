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
import { useFocusEffect } from 'expo-router';
import * as Location from 'expo-location';

type CartItem = {
  assignment_id: string;
  product_id: string;
  product_name: string;
  price: number;
  originalPrice: number;
  cost_price: number;
  quantity: number;
  max_qty: number;
  is_service: boolean;
  tax_rate: number;
  tax_code: string;
  discount: string;
  discountMode: 'amount' | 'percent';
};

const SALE_TAX_OPTIONS = [
  { label: 'No Tax', code: '11', rate: 0 },
  { label: '18% VAT', code: '01', rate: 0.18 },
  { label: 'Zero Rated', code: '02', rate: 0 },
  { label: 'Exempt', code: '03', rate: 0 },
];

const PAYMENT_OPTIONS = [
  { key: 'cash', label: 'Cash', icon: 'money' },
  { key: 'mobile_money', label: 'MoMo', icon: 'mobile' },
  { key: 'credit', label: 'Credit', icon: 'clock-o' },
  { key: 'cheque', label: 'Cheque', icon: 'file-text-o' },
];

export default function FieldSellScreen() {
  const { business, profile, fmt, currentBranch } = useAuth();
  const [assignments, setAssignments] = useState<FieldStockAssignment[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [completing, setCompleting] = useState(false);
  const [expandedDiscountId, setExpandedDiscountId] = useState<string | null>(null);
  const [editingPriceId, setEditingPriceId] = useState<string | null>(null);
  const [editPriceValue, setEditPriceValue] = useState('');

  // Customer fields (mandatory for field sales)
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  type CustomerOption = { id: string; name: string; phone: string | null };
  const [customersList, setCustomersList] = useState<CustomerOption[]>([]);

  // Global discount
  const [discount, setDiscount] = useState('0');
  const [discountMode, setDiscountMode] = useState<'amount' | 'percent'>('amount');

  // GPS
  const [gpsLat, setGpsLat] = useState<number | null>(null);
  const [gpsLng, setGpsLng] = useState<number | null>(null);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsError, setGpsError] = useState('');

  // Payment
  const [payMethod, setPayMethod] = useState('cash');
  const [showCheckout, setShowCheckout] = useState(false);
  const [stockSearch, setStockSearch] = useState('');


  // Load active assignments
  const load = useCallback(async () => {
    if (!business || !profile) return;
    setLoading(true);
    const [result, result2] = await Promise.all([
      getAssignments({ businessId: business.id, userId: profile.id, status: 'active' }),
      getAssignments({ businessId: business.id, userId: profile.id, status: 'partially_returned' }),
    ]);
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
      } catch { setGpsError('Could not get location'); }
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
    } catch { setGpsError('Could not get location'); }
    setGpsLoading(false);
  };

  // Load customers for picker
  const loadCustomers = useCallback(async () => {
    if (!business) return;
    const { data } = await supabase
      .from('customers')
      .select('id, name, phone')
      .eq('business_id', business.id)
      .order('name');
    if (data) setCustomersList(data);
  }, [business]);

  useEffect(() => { loadCustomers(); }, [loadCustomers]);

  const filteredCustomers = customerSearch.length > 0
    ? customersList.filter(c =>
        c.name.toLowerCase().includes(customerSearch.toLowerCase()) ||
        (c.phone && c.phone.includes(customerSearch))
      )
    : [];

  const selectCustomer = (c: CustomerOption) => {
    setSelectedCustomerId(c.id);
    setCustomerName(c.name);
    setCustomerPhone(c.phone || '');
    setCustomerSearch('');
  };

  // Per-item discount helpers (same as normal sell screen)
  const getItemDiscountAmount = (item: CartItem): number => {
    const input = parseFloat(item.discount) || 0;
    if (input <= 0) return 0;
    const itemNet = item.price * item.quantity;
    return item.discountMode === 'percent'
      ? Math.round(itemNet * input / 100)
      : Math.min(input, itemNet);
  };

  // Totals  
  const subtotalAmount = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const discountInput = parseFloat(discount) || 0;
  const perItemDiscountTotal = cart.reduce((sum, item) => sum + getItemDiscountAmount(item), 0);
  const globalDiscountBase = cart.reduce((sum, item) =>
    (parseFloat(item.discount) || 0) > 0 ? sum : sum + item.price * item.quantity, 0);
  const globalDiscountAmount = discountMode === 'percent'
    ? Math.round(globalDiscountBase * discountInput / 100)
    : Math.min(discountInput, globalDiscountBase);
  const discountAmount = perItemDiscountTotal + globalDiscountAmount;
  const discountedNet = subtotalAmount - discountAmount;
  const taxAmount = subtotalAmount > 0
    ? cart.reduce((sum, item) => {
        const itemNet = item.price * item.quantity;
        const itemPerDiscount = getItemDiscountAmount(item);
        const itemGlobalDiscount = (parseFloat(item.discount) || 0) > 0
          ? 0
          : (globalDiscountBase > 0 ? itemNet / globalDiscountBase * globalDiscountAmount : 0);
        const itemDiscountedNet = itemNet - itemPerDiscount - itemGlobalDiscount;
        return sum + Math.max(0, itemDiscountedNet) * item.tax_rate;
      }, 0)
    : 0;
  const totalAmount = discountedNet + taxAmount;

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
      Alert.alert('No Stock', 'All assigned stock for this product is already in the cart.');
      return;
    }

    const [{ data: inv }, { data: prod }] = await Promise.all([
      supabase
        .from('inventory')
        .select('selling_price, avg_cost_price')
        .eq('product_id', assignment.product_id)
        .eq('branch_id', assignment.branch_id)
        .single(),
      supabase
        .from('products')
        .select('tax_category_code, is_service')
        .eq('id', assignment.product_id)
        .single(),
    ]);

    const price = inv?.selling_price || 0;
    const costPrice = inv?.avg_cost_price || 0;
    const taxCode = prod?.tax_category_code || '11';
    const taxOption = SALE_TAX_OPTIONS.find(t => t.code === taxCode);
    const taxRate = taxOption?.rate ?? 0;

    setCart(prev => {
      const existing = prev.find(c => c.assignment_id === assignment.id);
      if (existing) {
        if (!existing.is_service && existing.quantity >= existing.max_qty) {
          Alert.alert('Stock Limit', `Only ${existing.max_qty} unit(s) available.`);
          return prev;
        }
        return prev.map(c =>
          c.assignment_id === assignment.id ? { ...c, quantity: c.quantity + 1 } : c
        );
      }
      return [...prev, {
        assignment_id: assignment.id,
        product_id: assignment.product_id,
        product_name: assignment.product_name || '?',
        price,
        originalPrice: price,
        cost_price: costPrice,
        quantity: 1,
        max_qty: assignment.qty_assigned - assignment.qty_returned,
        is_service: prod?.is_service ?? false,
        tax_rate: taxRate,
        tax_code: taxCode,
        discount: '0',
        discountMode: 'amount',
      }];
    });
  };

  const updateQty = (assignmentId: string, delta: number) => {
    setCart(prev =>
      prev
        .map(c => c.assignment_id === assignmentId
          ? { ...c, quantity: Math.max(0, c.is_service ? (c.quantity + delta) : Math.min(c.max_qty, c.quantity + delta)) }
          : c
        )
        .filter(c => c.quantity > 0)
    );
  };

  const removeFromCart = (assignmentId: string) => {
    setCart(prev => prev.filter(c => c.assignment_id !== assignmentId));
  };

  const updateItemDiscount = (id: string, value: string) => {
    setCart(prev => prev.map(c => c.assignment_id === id ? { ...c, discount: value } : c));
  };

  const toggleItemDiscountMode = (id: string) => {
    setCart(prev => prev.map(c =>
      c.assignment_id === id
        ? { ...c, discountMode: c.discountMode === 'amount' ? 'percent' : 'amount', discount: '0' }
        : c
    ));
  };

  const updateItemTax = (id: string, code: string, rate: number) => {
    setCart(prev => prev.map(c => c.assignment_id === id ? { ...c, tax_rate: rate, tax_code: code } : c));
  };

  const startEditPrice = (id: string, currentPrice: number) => {
    setEditingPriceId(id);
    setEditPriceValue(currentPrice.toString());
  };

  const commitEditPrice = (id: string) => {
    const newPrice = parseFloat(editPriceValue) || 0;
    if (newPrice > 0) {
      setCart(prev => prev.map(c => c.assignment_id === id ? { ...c, price: newPrice } : c));
    }
    setEditingPriceId(null);
    setEditPriceValue('');
  };

  // Complete field sale
  const completeSale = async () => {
    if (cart.length === 0) { Alert.alert('Empty Cart', 'Add items first.'); return; }
    if (!customerName.trim()) { Alert.alert('Required', 'Customer name is required for field sales.'); return; }
    if (!customerPhone.trim()) { Alert.alert('Required', 'Customer phone is required for field sales.'); return; }
    if (!business || !profile) return;

    setCompleting(true);
    try {
      // Try to get fresh GPS (High accuracy to get actual location, not cached)
      try {
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });
        setGpsLat(loc.coords.latitude);
        setGpsLng(loc.coords.longitude);
      } catch { /* use existing coords */ }

      // Create or find customer
      let customerId: string | null = selectedCustomerId;
      if (!customerId) {
        const { data: existing } = await supabase
          .from('customers')
          .select('id')
          .eq('business_id', business.id)
          .eq('phone', customerPhone.trim())
          .single();

        if (existing) {
          customerId = existing.id;
          if (gpsLat && gpsLng) {
            await supabase.from('customers')
              .update({ gps_lat: gpsLat, gps_lng: gpsLng, name: customerName.trim() })
              .eq('id', existing.id);
          }
        } else {
          const { data: newCust } = await supabase.from('customers').insert({
            business_id: business.id,
            name: customerName.trim(),
            phone: customerPhone.trim(),
            source: 'field',
            created_by: profile.id,
            buyer_type: '1',
            gps_lat: gpsLat,
            gps_lng: gpsLng,
          }).select().single();
          if (newCust) customerId = newCust.id;
        }
      }

      // Get branch_id from first cart item's assignment
      const branchId = assignments.find(a => a.id === cart[0]?.assignment_id)?.branch_id
        ?? currentBranch?.id ?? null;

      // Create sale
      const { data: sale, error: saleError } = await supabase
        .from('sales')
        .insert({
          business_id: business.id,
          branch_id: branchId,
          seller_id: profile.id,
          subtotal: Math.round(subtotalAmount),
          tax_amount: Math.round(taxAmount),
          discount_amount: Math.round(discountAmount),
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

      // Create sale items
      const { error: itemsError } = await supabase.from('sale_items').insert(
        cart.map(c => ({
          sale_id: sale.id,
          product_id: c.product_id,
          product_name: c.product_name,
          quantity: c.quantity,
          unit_price: c.price,
          cost_price: c.cost_price,
          tax_rate: c.tax_rate,
          discount_amount: Math.round(getItemDiscountAmount(c)),
          line_total: c.price * c.quantity,
        }))
      );
      if (itemsError) throw itemsError;

      // Audit log
      await supabase.from('audit_log').insert({
        business_id: business.id,
        user_id: profile.id,
        action: 'field_sale_created',
        table_name: 'sales',
        record_id: sale.id,
        new_data: {
          total: Math.round(totalAmount),
          customer_name: customerName.trim(),
          customer_phone: customerPhone.trim(),
          gps_lat: gpsLat,
          gps_lng: gpsLng,
          items: cart.length,
        },
      });

      Alert.alert(
        '✅ Field Sale Recorded',
        `Sale of ${fmt(Math.round(totalAmount))} saved as pending approval.\n\nCustomer: ${customerName.trim()}\nPhone: ${customerPhone.trim()}`,
        [{ text: 'OK' }]
      );

      setCart([]);
      setCustomerName('');
      setCustomerPhone('');
      setSelectedCustomerId(null);
      setDiscount('0');
      setShowCheckout(false);
      load();

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

      {/* Cart section */}
      {cart.length > 0 && (
        <View style={styles.cartSection}>
          <Text style={styles.sectionTitle}>CART</Text>
          <ScrollView style={{ maxHeight: 320 }} nestedScrollEnabled>
            {cart.map(item => {
              const lineDiscount = getItemDiscountAmount(item);
              const lineGross = item.price * item.quantity;
              const lineGlobalDiscount = (parseFloat(item.discount) || 0) > 0
                ? 0
                : (globalDiscountBase > 0 ? lineGross / globalDiscountBase * globalDiscountAmount : 0);
              const lineNet = lineGross - lineDiscount - lineGlobalDiscount;
              const lineTax = Math.max(0, lineNet) * item.tax_rate;
              const taxLabel = SALE_TAX_OPTIONS.find(t => t.code === item.tax_code)?.label || 'No Tax';
              const isExpanded = expandedDiscountId === item.assignment_id;

              return (
                <View key={item.assignment_id} style={styles.cartCard}>
                  {/* Item header row */}
                  <View style={styles.cartItemRow}>
                    <View style={{ flex: 1, backgroundColor: 'transparent' }}>
                      <Text style={styles.cartItemName}>{item.product_name}</Text>
                      {editingPriceId === item.assignment_id ? (
                        <TextInput
                          style={styles.priceInput}
                          value={editPriceValue}
                          onChangeText={setEditPriceValue}
                          keyboardType="numeric"
                          autoFocus
                          onBlur={() => commitEditPrice(item.assignment_id)}
                          onSubmitEditing={() => commitEditPrice(item.assignment_id)}
                        />
                      ) : (
                        <TouchableOpacity onPress={() => startEditPrice(item.assignment_id, item.price)}>
                          <Text style={styles.cartItemPrice}>
                            {fmt(item.price)}
                            {item.price !== item.originalPrice && (
                              <Text style={{ color: '#888', textDecorationLine: 'line-through', fontSize: 11 }}>
                                {' '}{fmt(item.originalPrice)}
                              </Text>
                            )}
                          </Text>
                        </TouchableOpacity>
                      )}
                    </View>
                    {/* Qty controls */}
                    <View style={styles.qtyControls}>
                      <TouchableOpacity style={styles.qtyBtn} onPress={() => updateQty(item.assignment_id, -1)}>
                        <FontAwesome name="minus" size={11} color="#fff" />
                      </TouchableOpacity>
                      <Text style={styles.qtyText}>{item.quantity}</Text>
                      <TouchableOpacity
                        style={[styles.qtyBtn, { backgroundColor: '#4CAF50' }]}
                        onPress={() => updateQty(item.assignment_id, 1)}
                        disabled={item.quantity >= item.max_qty}
                      >
                        <FontAwesome name="plus" size={11} color="#fff" />
                      </TouchableOpacity>
                    </View>
                    {/* Line total + remove */}
                    <View style={{ alignItems: 'flex-end', minWidth: 80, backgroundColor: 'transparent' }}>
                      <Text style={styles.lineTotal}>{fmt(lineGross)}</Text>
                      <TouchableOpacity onPress={() => removeFromCart(item.assignment_id)} style={{ marginTop: 4 }}>
                        <FontAwesome name="trash" size={13} color="#e94560" />
                      </TouchableOpacity>
                    </View>
                  </View>

                  {/* Tax + discount meta row */}
                  <View style={styles.cartMetaRow}>
                    <TouchableOpacity
                      style={styles.taxBadge}
                      onPress={() => {
                        const current = SALE_TAX_OPTIONS.findIndex(t => t.code === item.tax_code);
                        const next = SALE_TAX_OPTIONS[(current + 1) % SALE_TAX_OPTIONS.length];
                        updateItemTax(item.assignment_id, next.code, next.rate);
                      }}
                    >
                      <Text style={styles.taxBadgeText}>{taxLabel}</Text>
                    </TouchableOpacity>
                    {lineTax > 0 && (
                      <Text style={styles.taxAmount}>+{fmt(Math.round(lineTax))} tax</Text>
                    )}
                    {lineDiscount > 0 && (
                      <Text style={styles.discountBadge}>-{fmt(lineDiscount)}</Text>
                    )}
                    <TouchableOpacity
                      style={styles.discountToggle}
                      onPress={() => setExpandedDiscountId(isExpanded ? null : item.assignment_id)}
                    >
                      <FontAwesome name={isExpanded ? 'chevron-up' : 'tag'} size={12} color="#aaa" />
                      <Text style={{ color: '#aaa', fontSize: 11, marginLeft: 4 }}>Disc</Text>
                    </TouchableOpacity>
                  </View>

                  {/* Per-item discount (expandable) */}
                  {isExpanded && (
                    <View style={styles.discountRow}>
                      <TextInput
                        style={styles.discountInput}
                        placeholder="0"
                        placeholderTextColor="#555"
                        value={item.discount === '0' ? '' : item.discount}
                        onChangeText={v => updateItemDiscount(item.assignment_id, v || '0')}
                        keyboardType="numeric"
                      />
                      <TouchableOpacity
                        style={styles.discountModeBtn}
                        onPress={() => toggleItemDiscountMode(item.assignment_id)}
                      >
                        <Text style={styles.discountModeBtnText}>
                          {item.discountMode === 'percent' ? '%' : 'UGX'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              );
            })}
          </ScrollView>

          {/* Totals summary */}
          <View style={styles.totalsBox}>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Subtotal</Text>
              <Text style={styles.totalValue}>{fmt(Math.round(subtotalAmount))}</Text>
            </View>
            {discountAmount > 0 && (
              <View style={styles.totalRow}>
                <Text style={[styles.totalLabel, { color: '#4CAF50' }]}>Discount</Text>
                <Text style={[styles.totalValue, { color: '#4CAF50' }]}>-{fmt(Math.round(discountAmount))}</Text>
              </View>
            )}
            {taxAmount > 0 && (
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Tax</Text>
                <Text style={styles.totalValue}>+{fmt(Math.round(taxAmount))}</Text>
              </View>
            )}
            <View style={[styles.totalRow, { marginTop: 6, borderTopWidth: 1, borderTopColor: '#0f3460', paddingTop: 8 }]}>
              <Text style={[styles.totalLabel, { color: '#fff', fontWeight: 'bold', fontSize: 16 }]}>Total</Text>
              <Text style={[styles.totalValue, { color: '#e94560', fontWeight: 'bold', fontSize: 18 }]}>{fmt(Math.round(totalAmount))}</Text>
            </View>
          </View>

          {/* Global discount */}
          <View style={styles.globalDiscRow}>
            <Text style={{ color: '#aaa', fontSize: 13, marginRight: 8 }}>Global Discount:</Text>
            <TextInput
              style={styles.globalDiscInput}
              placeholder="0"
              placeholderTextColor="#555"
              value={discount === '0' ? '' : discount}
              onChangeText={v => setDiscount(v || '0')}
              keyboardType="numeric"
            />
            <TouchableOpacity
              style={styles.discountModeBtn}
              onPress={() => setDiscountMode(d => d === 'amount' ? 'percent' : 'amount')}
            >
              <Text style={styles.discountModeBtnText}>{discountMode === 'percent' ? '%' : 'UGX'}</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={styles.checkoutBtn} onPress={() => setShowCheckout(true)}>
            <Text style={styles.checkoutBtnText}>Checkout → {fmt(Math.round(totalAmount))}</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Available Stock to Sell */}
      <View style={styles.stockHeader}>
        <Text style={styles.sectionTitle}>YOUR ASSIGNED STOCK</Text>
        <View style={styles.stockSearchRow}>
          <FontAwesome name="search" size={14} color="#666" style={{ marginRight: 8 }} />
          <TextInput
            style={styles.stockSearchInput}
            placeholder="Search stock..."
            placeholderTextColor="#666"
            value={stockSearch}
            onChangeText={setStockSearch}
          />
        </View>
      </View>

      {loading ? (
        <ActivityIndicator color="#e94560" style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={assignments.filter(a => 
            a.product_name?.toLowerCase().includes(stockSearch.toLowerCase())
          )}
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
                      disabled={available <= 0}
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
              <ScrollView keyboardShouldPersistTaps="handled">
                <Text style={styles.formTitle}>Complete Field Sale</Text>

                {/* Cart Summary in checkout */}
                <View style={styles.checkoutCart}>
                  {cart.map(c => {
                    const lDisc = getItemDiscountAmount(c);
                    const lGross = c.price * c.quantity;
                    const lNet = lGross - lDisc;
                    const lTax = lNet * c.tax_rate;
                    return (
                      <View key={c.assignment_id} style={styles.checkoutItem}>
                        <Text style={{ color: '#fff', flex: 1, fontSize: 13 }}>{c.product_name}</Text>
                        <Text style={{ color: '#aaa', fontSize: 12 }}>{c.quantity}×{fmt(c.price)}</Text>
                        {lDisc > 0 && <Text style={{ color: '#4CAF50', fontSize: 12, marginLeft: 6 }}>-{fmt(lDisc)}</Text>}
                        {lTax > 0 && <Text style={{ color: '#FF9800', fontSize: 12, marginLeft: 4 }}>+{fmt(Math.round(lTax))}</Text>}
                        <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 13, marginLeft: 8 }}>{fmt(Math.round(lGross))}</Text>
                      </View>
                    );
                  })}
                  {discountAmount > 0 && (
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingTop: 6, backgroundColor: 'transparent' }}>
                      <Text style={{ color: '#4CAF50', fontSize: 13 }}>Discount</Text>
                      <Text style={{ color: '#4CAF50', fontSize: 13 }}>-{fmt(Math.round(discountAmount))}</Text>
                    </View>
                  )}
                  {taxAmount > 0 && (
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingTop: 4, backgroundColor: 'transparent' }}>
                      <Text style={{ color: '#FF9800', fontSize: 13 }}>Tax</Text>
                      <Text style={{ color: '#FF9800', fontSize: 13 }}>+{fmt(Math.round(taxAmount))}</Text>
                    </View>
                  )}
                  <View style={styles.checkoutTotal}>
                    <Text style={{ color: '#fff', fontSize: 18, fontWeight: 'bold' }}>Total</Text>
                    <Text style={{ color: '#e94560', fontSize: 20, fontWeight: 'bold' }}>{fmt(Math.round(totalAmount))}</Text>
                  </View>
                </View>

                {/* Customer Details (mandatory) */}
                <Text style={styles.label}>Customer Name *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Search or enter customer name…"
                  placeholderTextColor="#555"
                  value={customerSearch || customerName}
                  onChangeText={text => {
                    setCustomerSearch(text);
                    setCustomerName(text);
                    setSelectedCustomerId(null);
                  }}
                />
                {filteredCustomers.length > 0 && (
                  <View style={styles.customerDropdown}>
                    {filteredCustomers.slice(0, 5).map(c => (
                      <TouchableOpacity key={c.id} style={styles.customerOption} onPress={() => selectCustomer(c)}>
                        <Text style={{ color: '#fff', fontSize: 14 }}>{c.name}</Text>
                        {c.phone && <Text style={{ color: '#aaa', fontSize: 12 }}>{c.phone}</Text>}
                      </TouchableOpacity>
                    ))}
                  </View>
                )}

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
                  {PAYMENT_OPTIONS.map(m => (
                    <TouchableOpacity
                      key={m.key}
                      style={[styles.payChip, payMethod === m.key && styles.payChipActive]}
                      onPress={() => setPayMethod(m.key)}
                    >
                      <FontAwesome name={m.icon as any} size={13} color={payMethod === m.key ? '#fff' : '#aaa'} />
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
                    <Text style={styles.completeBtnText}>Record Sale ({fmt(Math.round(totalAmount))})</Text>
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
  sectionTitle: { color: '#888', fontSize: 13, fontWeight: 'bold', letterSpacing: 1, marginBottom: 0 },
  stockHeader: { 
    marginTop: 12, 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center',
    marginBottom: 8,
    backgroundColor: 'transparent',
  },
  stockSearchRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#16213e',
    borderRadius: 8,
    paddingHorizontal: 12,
    marginLeft: 12,
    borderWidth: 1,
    borderColor: '#0f3460',
  },
  stockSearchInput: {
    flex: 1,
    color: '#fff',
    fontSize: 14,
    paddingVertical: 6,
  },
  cartSection: { backgroundColor: '#0f3460', borderRadius: 16, padding: 14, marginBottom: 14 },
  cartCard: { backgroundColor: '#16213e', borderRadius: 12, padding: 12, marginBottom: 8 },
  cartItemRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'transparent' },
  cartItemName: { color: '#fff', fontSize: 14, fontWeight: 'bold' },
  cartItemPrice: { color: '#aaa', fontSize: 13, marginTop: 2 },
  priceInput: { backgroundColor: '#0f3460', color: '#fff', borderRadius: 6, padding: 6, fontSize: 14, marginTop: 2, minWidth: 80 },
  qtyControls: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'transparent', marginHorizontal: 10 },
  qtyBtn: { backgroundColor: '#e94560', width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  qtyText: { color: '#fff', fontSize: 15, fontWeight: 'bold', minWidth: 22, textAlign: 'center' },
  lineTotal: { color: '#fff', fontWeight: 'bold', fontSize: 14 },
  cartMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap', backgroundColor: 'transparent' },
  taxBadge: { backgroundColor: '#0f3460', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  taxBadgeText: { color: '#aaa', fontSize: 11 },
  taxAmount: { color: '#FF9800', fontSize: 11 },
  discountBadge: { color: '#4CAF50', fontSize: 11 },
  discountToggle: { flexDirection: 'row', alignItems: 'center', marginLeft: 'auto' },
  discountRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8, gap: 8, backgroundColor: 'transparent' },
  discountInput: { flex: 1, backgroundColor: '#0f3460', borderRadius: 8, padding: 8, color: '#fff', fontSize: 14 },
  discountModeBtn: { backgroundColor: '#0f3460', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  discountModeBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 13 },
  totalsBox: { backgroundColor: '#16213e', borderRadius: 12, padding: 12, marginTop: 10 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, backgroundColor: 'transparent' },
  totalLabel: { color: '#aaa', fontSize: 14 },
  totalValue: { color: '#fff', fontSize: 14 },
  globalDiscRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10, backgroundColor: 'transparent' },
  globalDiscInput: { flex: 1, backgroundColor: '#16213e', borderRadius: 8, padding: 8, color: '#fff', fontSize: 14, marginRight: 8 },
  checkoutBtn: { backgroundColor: '#e94560', borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 14 },
  checkoutBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  stockCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#16213e', borderRadius: 12, padding: 14, marginBottom: 8 },
  stockName: { color: '#fff', fontSize: 15, fontWeight: 'bold' },
  stockQty: { color: '#aaa', fontSize: 12, marginTop: 3 },
  addBtn: { backgroundColor: '#4CAF50', width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  empty: { alignItems: 'center', paddingTop: 60 },
  emptyText: { color: '#555', fontSize: 16, marginTop: 12 },
  emptyHint: { color: '#444', fontSize: 13, marginTop: 4 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#1a1a2e', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: '94%' },
  formTitle: { fontSize: 22, fontWeight: 'bold', color: '#fff', marginBottom: 16 },
  checkoutCart: { backgroundColor: '#16213e', borderRadius: 14, padding: 14, marginBottom: 16 },
  checkoutItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 5, backgroundColor: 'transparent' },
  checkoutTotal: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: '#0f3460', paddingTop: 10, marginTop: 6, backgroundColor: 'transparent' },
  label: { fontSize: 13, color: '#aaa', marginBottom: 6, marginTop: 12 },
  input: { backgroundColor: '#16213e', borderRadius: 10, padding: 12, color: '#fff', fontSize: 15, borderWidth: 1, borderColor: '#0f3460' },
  customerDropdown: { backgroundColor: '#0f3460', borderRadius: 10, marginTop: 4, overflow: 'hidden' },
  customerOption: { padding: 12, borderBottomWidth: 1, borderBottomColor: '#16213e' },
  payRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', backgroundColor: 'transparent' },
  payChip: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, backgroundColor: '#16213e', borderWidth: 1, borderColor: '#0f3460' },
  payChipActive: { backgroundColor: '#e94560', borderColor: '#e94560' },
  payChipText: { color: '#aaa', fontWeight: 'bold', fontSize: 13 },
  gpsInfo: { flexDirection: 'row', alignItems: 'center', marginTop: 16, backgroundColor: 'transparent' },
  pendingNote: { color: '#FF9800', fontSize: 12, marginTop: 12, backgroundColor: '#FF980015', padding: 10, borderRadius: 8, overflow: 'hidden' },
  completeBtn: { backgroundColor: '#4CAF50', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 16 },
  completeBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  cancelBtn: { padding: 14, alignItems: 'center', marginTop: 8 },
  cancelBtnText: { color: '#aaa', fontSize: 15 },
});
