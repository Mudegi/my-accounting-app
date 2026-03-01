import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Alert,
  TextInput,
  Modal,
  Image,
  ActivityIndicator,
  ScrollView,
  BackHandler,
} from 'react-native';
import { Text, View } from '@/components/Themed';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter } from 'expo-router';
import { postSaleEntry, PAYMENT_METHODS } from '@/lib/accounting';
import {
  fiscalizeInvoice,
  buildInvoicePayload,
  EFRIS_PAYMENT_METHODS,
  EFRIS_BUYER_TYPES,
  EFRIS_TAX_CATEGORIES,
  EFRIS_UNIT_MAP,
  type EfrisConfig,
} from '@/lib/efris';

type CartItem = {
  id: string;
  product_id: string;
  name: string;
  price: number;             // current net (tax-exclusive) unit price
  originalPrice: number;     // original selling_price from inventory
  cost_price: number;
  quantity: number;
  stock_quantity: number;    // available stock for validation
  tax_rate: number;
  tax_code: string; // EFRIS tax category code
  discount: string;          // raw discount input per item
  discountMode: 'amount' | 'percent';
};

type InventoryItem = {
  id: string;
  name: string;
  barcode: string | null;
  image_url: string | null;
  selling_price: number;
  avg_cost_price: number;
  stock_quantity: number;
  tax_category_code: string;
};

const SALE_TAX_OPTIONS = [
  { label: 'No Tax', code: '11', rate: 0 },
  { label: '18% VAT', code: '01', rate: 0.18 },
  { label: 'Zero Rated', code: '02', rate: 0 },
  { label: 'Exempt', code: '03', rate: 0 },
];

export default function SalesScreen() {
  const { currentBranch, business, profile, fmt, currency } = useAuth();
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [cart, setCart] = useState<CartItem[]>([]);
  const [scanning, setScanning] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<InventoryItem[]>([]);
  const [showSearch, setShowSearch] = useState(false);
  const [allProducts, setAllProducts] = useState<InventoryItem[]>([]);
  const [lastScannedCode, setLastScannedCode] = useState('');
  const scanTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [expandedDiscountId, setExpandedDiscountId] = useState<string | null>(null);
  const [editingPriceId, setEditingPriceId] = useState<string | null>(null);
  const [editPriceValue, setEditPriceValue] = useState('');

  // Back handler: close camera instead of closing the app
  useEffect(() => {
    const onBack = () => {
      if (scanning) {
        setScanning(false);
        return true; // consume event
      }
      return false; // let default behavior happen
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', onBack);
    return () => sub.remove();
  }, [scanning]);

  // EFRIS state
  const efrisEnabled = business?.is_efris_enabled ?? false;
  const [showFiscalize, setShowFiscalize] = useState(false);
  const [lastSaleId, setLastSaleId] = useState<string | null>(null);
  const [lastSaleTotal, setLastSaleTotal] = useState(0);
  const [lastSaleDiscount, setLastSaleDiscount] = useState(0);
  const [customerName, setCustomerName] = useState('');
  const [customerTin, setCustomerTin] = useState('');
  const [buyerType, setBuyerType] = useState('1'); // B2C default
  const [paymentMethod, setPaymentMethod] = useState('102'); // Cash default
  const [fiscalizing, setFiscalizing] = useState(false);
  const [discount, setDiscount] = useState('0');
  const [discountMode, setDiscountMode] = useState<'amount' | 'percent'>('amount');
  const [salePayMethod, setSalePayMethod] = useState('cash');

  // Helper: compute per-item net discount amount
  const getItemDiscountAmount = (item: CartItem): number => {
    const input = parseFloat(item.discount) || 0;
    if (input <= 0) return 0;
    const itemNet = item.price * item.quantity;
    return item.discountMode === 'percent'
      ? Math.round(itemNet * input / 100)
      : Math.min(input, itemNet); // cap at item total
  };

  // Customer picker state
  type CustomerOption = { id: string; name: string; tin: string | null; buyer_type: string; phone: string | null };
  const [customersList, setCustomersList] = useState<CustomerOption[]>([]);
  const [customerSearch, setCustomerSearch] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);

  const subtotalAmount = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const discountInput = parseFloat(discount) || 0;
  // Global discount on net subtotal (applied to items WITHOUT their own per-item discount)
  const perItemDiscountTotal = cart.reduce((sum, item) => sum + getItemDiscountAmount(item), 0);
  const globalDiscountBase = cart.reduce((sum, item) => {
    // Only items with no per-item discount participate in global discount
    return (parseFloat(item.discount) || 0) > 0 ? sum : sum + item.price * item.quantity;
  }, 0);
  const globalDiscountAmount = discountMode === 'percent'
    ? Math.round(globalDiscountBase * discountInput / 100)
    : Math.min(discountInput, globalDiscountBase);
  const discountAmount = perItemDiscountTotal + globalDiscountAmount;
  const discountedNet = subtotalAmount - discountAmount;
  // Tax computed on each item's discounted net
  const taxAmount = subtotalAmount > 0
    ? cart.reduce((sum, item) => {
        const itemNet = item.price * item.quantity;
        const itemPerDiscount = getItemDiscountAmount(item);
        // If item has its own discount, use it; otherwise apply global proportion
        const itemGlobalDiscount = (parseFloat(item.discount) || 0) > 0
          ? 0
          : (globalDiscountBase > 0 ? itemNet / globalDiscountBase * globalDiscountAmount : 0);
        const itemDiscountedNet = itemNet - itemPerDiscount - itemGlobalDiscount;
        return sum + Math.max(0, itemDiscountedNet) * item.tax_rate;
      }, 0)
    : 0;
  const totalAmount = discountedNet + taxAmount;

  // Load saved customers for fiscalize picker
  const loadCustomers = async () => {
    if (!business) return;
    const { data } = await supabase
      .from('customers')
      .select('id, name, tin, buyer_type, phone')
      .eq('business_id', business.id)
      .order('name');
    if (data) setCustomersList(data);
  };

  const selectCustomer = (c: CustomerOption) => {
    setSelectedCustomerId(c.id);
    setCustomerName(c.name);
    setCustomerTin(c.tin || '');
    setBuyerType(c.buyer_type || '1');
    setCustomerSearch('');
  };

  const clearCustomer = () => {
    setSelectedCustomerId(null);
    setCustomerName('');
    setCustomerTin('');
    setBuyerType('1');
    setCustomerSearch('');
  };

  const filteredCustomers = customerSearch.length > 0
    ? customersList.filter((c) =>
        c.name.toLowerCase().includes(customerSearch.toLowerCase()) ||
        (c.tin && c.tin.includes(customerSearch))
      )
    : [];

  // Load all products for browsing (no-barcode items)
  const loadAllProducts = async () => {
    if (!business || !currentBranch) return;
    const { data } = await supabase
      .from('products')
      .select(`
        id, name, barcode, image_url, tax_category_code,
        inventory!inner(selling_price, avg_cost_price, quantity)
      `)
      .eq('business_id', business.id)
      .eq('inventory.branch_id', currentBranch.id)
      .gt('inventory.quantity', 0)
      .order('name')
      .limit(50);

    if (data) {
      const results: InventoryItem[] = data.map((p: any) => ({
        id: p.id,
        name: p.name,
        barcode: p.barcode,
        image_url: p.image_url,
        selling_price: p.inventory[0]?.selling_price || 0,
        avg_cost_price: p.inventory[0]?.avg_cost_price || 0,
        stock_quantity: p.inventory[0]?.quantity || 0,
        tax_category_code: p.tax_category_code || '01',
      }));
      setAllProducts(results);
      setSearchResults(results);
    }
  };

  // Search products by name
  const searchProducts = async (query: string) => {
    if (!query || !business) {
      setSearchResults(allProducts);
      return;
    }

    // Client-side filter first for speed
    if (query.length < 3 && allProducts.length > 0) {
      const lower = query.toLowerCase();
      setSearchResults(allProducts.filter(p => p.name.toLowerCase().includes(lower)));
      return;
    }

    const { data } = await supabase
      .from('products')
      .select(`
        id, name, barcode, image_url, tax_category_code,
        inventory!inner(selling_price, avg_cost_price, quantity)
      `)
      .eq('business_id', business.id)
      .eq('inventory.branch_id', currentBranch?.id)
      .ilike('name', `%${query}%`)
      .limit(20);

    if (data) {
      const results: InventoryItem[] = data.map((p: any) => ({
        id: p.id,
        name: p.name,
        barcode: p.barcode,
        image_url: p.image_url,
        selling_price: p.inventory[0]?.selling_price || 0,
        avg_cost_price: p.inventory[0]?.avg_cost_price || 0,
        stock_quantity: p.inventory[0]?.quantity || 0,
        tax_category_code: p.tax_category_code || '01',
      }));
      setSearchResults(results);
    }
  };

  // Look up product by barcode
  const lookupBarcode = async (barcode: string) => {
    if (!business || !currentBranch) return;

    const { data } = await supabase
      .from('products')
      .select(`
        id, name, barcode, image_url, tax_category_code,
        inventory!inner(selling_price, avg_cost_price, quantity)
      `)
      .eq('business_id', business.id)
      .eq('barcode', barcode)
      .eq('inventory.branch_id', currentBranch.id)
      .single();

    if (data) {
      const inv = (data as any).inventory[0];
      addToCart({
        id: data.id,
        name: data.name,
        barcode: data.barcode,
        image_url: data.image_url,
        selling_price: inv?.selling_price || 0,
        avg_cost_price: inv?.avg_cost_price || 0,
        stock_quantity: inv?.quantity || 0,
        tax_category_code: (data as any).tax_category_code || '01',
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Not Found', `No product found with barcode: ${barcode}`);
    }
  };

  // Handle barcode scan
  const onBarcodeScanned = ({ data }: { data: string }) => {
    if (data === lastScannedCode) return;
    setLastScannedCode(data);
    if (scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current);
    scanTimeoutRef.current = setTimeout(() => setLastScannedCode(''), 2000);
    lookupBarcode(data);
  };

  // Add item to cart
  const addToCart = (product: InventoryItem) => {
    // Non-EFRIS users: no tax calculation, price = price
    // EFRIS users: resolve tax rate from product's tax category
    const taxCat = EFRIS_TAX_CATEGORIES.find(t => t.code === product.tax_category_code);
    const defaultTaxRate = efrisEnabled ? (taxCat?.rate ?? 0) : 0;
    const defaultTaxCode = efrisEnabled ? (product.tax_category_code || '01') : '11';
    setCart((prev) => {
      const existing = prev.find((item) => item.product_id === product.id);
      if (existing) {
        if (existing.quantity >= existing.stock_quantity) {
          Alert.alert('Stock Limit', `Only ${existing.stock_quantity} unit(s) of "${existing.name}" available in stock.`);
          return prev;
        }
        return prev.map((item) =>
          item.product_id === product.id
            ? { ...item, quantity: item.quantity + 1 }
            : item
        );
      }
      if (product.stock_quantity <= 0) {
        Alert.alert('Out of Stock', `"${product.name}" is out of stock.`);
        return prev;
      }
      return [
        ...prev,
        {
          id: Date.now().toString(),
          product_id: product.id,
          name: product.name,
          price: product.selling_price,
          originalPrice: product.selling_price,
          cost_price: product.avg_cost_price,
          quantity: 1,
          stock_quantity: product.stock_quantity,
          tax_rate: defaultTaxRate,
          tax_code: defaultTaxCode,
          discount: '0',
          discountMode: 'amount' as const,
        },
      ];
    });
    setShowSearch(false);
    setSearchQuery('');
  };

  // Remove item from cart
  const removeFromCart = (id: string) => {
    setCart((prev) => prev.filter((item) => item.id !== id));
  };

  // Update item quantity
  const updateQuantity = (id: string, delta: number) => {
    setCart((prev) => {
      const target = prev.find((item) => item.id === id);
      if (target && delta > 0 && target.quantity >= target.stock_quantity) {
        Alert.alert('Stock Limit', `Only ${target.stock_quantity} unit(s) of "${target.name}" available in stock.`);
        return prev;
      }
      return prev
        .map((item) =>
          item.id === id
            ? { ...item, quantity: Math.max(0, Math.min(item.stock_quantity, item.quantity + delta)) }
            : item
        )
        .filter((item) => item.quantity > 0);
    });
  };

  // Update item tax rate
  const updateItemTax = (id: string, code: string, rate: number) => {
    setCart((prev) =>
      prev.map((item) => item.id === id ? { ...item, tax_rate: rate, tax_code: code } : item)
    );
  };

  // Update item selling price (user enters net price, system adds tax)
  const startEditPrice = (id: string, currentPrice: number) => {
    setEditingPriceId(id);
    setEditPriceValue(currentPrice.toString());
  };
  const commitEditPrice = (id: string) => {
    const newPrice = parseFloat(editPriceValue) || 0;
    if (newPrice > 0) {
      setCart((prev) =>
        prev.map((item) => item.id === id ? { ...item, price: newPrice } : item)
      );
    }
    setEditingPriceId(null);
    setEditPriceValue('');
  };

  // Update per-item discount
  const updateItemDiscount = (id: string, value: string) => {
    setCart((prev) =>
      prev.map((item) => item.id === id ? { ...item, discount: value } : item)
    );
  };
  const toggleItemDiscountMode = (id: string) => {
    setCart((prev) =>
      prev.map((item) => item.id === id
        ? { ...item, discountMode: item.discountMode === 'amount' ? 'percent' : 'amount', discount: '0' }
        : item
      )
    );
  };

  // Complete the sale
  // Credit sale customer picker state
  const [creditCustomer, setCreditCustomer] = useState<CustomerOption | null>(null);
  const [creditCustomerSearch, setCreditCustomerSearch] = useState('');
  const [showCreditPicker, setShowCreditPicker] = useState(false);

  // Load customers when switching to credit
  useEffect(() => {
    if (salePayMethod === 'credit') loadCustomers();
  }, [salePayMethod]);

  const creditFilteredCustomers = creditCustomerSearch.length > 0
    ? customersList.filter((c) =>
        c.name.toLowerCase().includes(creditCustomerSearch.toLowerCase()) ||
        (c.tin && c.tin.includes(creditCustomerSearch)) ||
        (c.phone && c.phone.includes(creditCustomerSearch))
      )
    : customersList;

  const completeSale = async (withEfris: boolean = false) => {
    if (cart.length === 0) {
      Alert.alert('Empty Cart', 'Please add items before completing the sale.');
      return;
    }
    if (!business || !currentBranch || !profile) return;

    // Require customer for credit sales
    if (salePayMethod === 'credit' && !creditCustomer) {
      Alert.alert('Customer Required', 'Please select a customer for credit sales.');
      setShowCreditPicker(true);
      return;
    }

    try {
      const { data: sale, error: saleError } = await supabase
        .from('sales')
        .insert({
          business_id: business.id,
          branch_id: currentBranch.id,
          seller_id: profile.id,
          subtotal: subtotalAmount,
          tax_amount: Math.round(taxAmount),
          discount_amount: Math.round(discountAmount),
          total_amount: Math.round(totalAmount),
          payment_method: salePayMethod,
          status: 'completed',
          customer_id: creditCustomer?.id || null,
          customer_name: creditCustomer?.name || null,
        })
        .select()
        .single();

      if (saleError) throw saleError;

      const saleItems = cart.map((item) => ({
        sale_id: sale.id,
        product_id: item.product_id,
        product_name: item.name,
        quantity: item.quantity,
        unit_price: item.price,
        cost_price: item.cost_price,
        tax_rate: item.tax_rate,
        discount_amount: Math.round(getItemDiscountAmount(item)),
        line_total: item.price * item.quantity,
      }));

      const { error: itemsError } = await supabase
        .from('sale_items')
        .insert(saleItems);

      if (itemsError) throw itemsError;

      // Decrement inventory for each sold item
      for (const item of cart) {
        const { data: inv } = await supabase
          .from('inventory')
          .select('quantity')
          .eq('product_id', item.product_id)
          .eq('branch_id', currentBranch.id)
          .single();
        if (inv) {
          await supabase
            .from('inventory')
            .update({ quantity: Math.max(0, inv.quantity - item.quantity) })
            .eq('product_id', item.product_id)
            .eq('branch_id', currentBranch.id);
        }
      }

      // Auto-post accounting entry
      const costOfGoods = cart.reduce((sum, item) => sum + item.cost_price * item.quantity, 0);
      postSaleEntry({
        businessId: business.id,
        branchId: currentBranch.id,
        saleId: sale.id,
        subtotal: subtotalAmount,
        taxAmount: Math.round(taxAmount),
        totalAmount: Math.round(totalAmount),
        costOfGoods,
        discountAmount: discountAmount,
        paymentMethod: salePayMethod,
        userId: profile.id,
      });

      // Auto-earn loyalty points if customer linked
      if (creditCustomer && business) {
        try {
          const { data: bizSettings } = await supabase
            .from('businesses')
            .select('loyalty_points_per_amount, loyalty_amount_unit')
            .eq('id', business.id)
            .single();

          const ptsPerAmt = bizSettings?.loyalty_points_per_amount || 1;
          const amtUnit = bizSettings?.loyalty_amount_unit || 1000;

          if (amtUnit > 0) {
            const pointsEarned = Math.floor(Math.round(totalAmount) / amtUnit) * ptsPerAmt;
            if (pointsEarned > 0) {
              await supabase.from('loyalty_transactions').insert({
                business_id: business.id,
                customer_id: creditCustomer.id,
                sale_id: sale.id,
                points: pointsEarned,
                type: 'earn',
                description: `Earned from sale ${sale.id.slice(0, 8)}`,
                created_by: profile.id,
              });

              await supabase.rpc('increment_loyalty_points', {
                p_customer_id: creditCustomer.id,
                p_points: pointsEarned,
              }).then(() => {}).catch(() => {
                // Fallback if RPC doesn't exist: direct update
                supabase
                  .from('customers')
                  .select('loyalty_points')
                  .eq('id', creditCustomer.id)
                  .single()
                  .then(({ data }) => {
                    if (data) {
                      supabase
                        .from('customers')
                        .update({ loyalty_points: (data.loyalty_points || 0) + pointsEarned })
                        .eq('id', creditCustomer.id);
                    }
                  });
              });
            }
          }
        } catch (_) { /* loyalty is non-critical */ }
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      if (withEfris && efrisEnabled) {
        setLastSaleId(sale.id);
        setLastSaleTotal(Math.round(totalAmount));
        setLastSaleDiscount(Math.round(globalDiscountAmount)); // only global (extra) discount
        loadCustomers();
        setShowFiscalize(true);
      } else {
        // Navigate to receipt screen
        router.push({ pathname: '/receipt', params: { saleId: sale.id } });
      }
      setCart([]);
      setDiscount('0');
      setDiscountMode('amount');
      setCreditCustomer(null);
      setCreditCustomerSearch('');
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to complete sale');
    }
  };

  // EFRIS: Fiscalize invoice
  const handleFiscalize = async () => {
    if (!lastSaleId || !business) return;
    if (!business.efris_api_key) {
      Alert.alert('EFRIS not configured', 'Go to Settings → EFRIS Configuration first.'); return;
    }
    setFiscalizing(true);
    try {
      const config: EfrisConfig = {
        apiKey: business.efris_api_key,
        apiUrl: business.efris_api_url || '',
        testMode: business.efris_test_mode ?? true,
      };

      // Get sale items with product EFRIS data
      const { data: saleItems } = await supabase
        .from('sale_items')
        .select(`*, products:product_id(efris_product_code, efris_item_code, commodity_code, tax_category_code, unit)`)
        .eq('sale_id', lastSaleId);

      if (!saleItems || saleItems.length === 0) { Alert.alert('Error', 'No sale items found'); setFiscalizing(false); return; }

      // Warn about unregistered items
      const unregistered = saleItems.filter((si: any) => !si.products?.efris_product_code);
      if (unregistered.length > 0) {
        const names = unregistered.map((si: any) => si.product_name).join(', ');
        Alert.alert('Unregistered Products', `These products are not registered with EFRIS and cannot be fiscalized: ${names}. Register them in the product form first.`);
        setFiscalizing(false); return;
      }

      // Generate invoice number
      const { data: invNoData } = await supabase.rpc('generate_invoice_number');
      const invoiceNumber = invNoData || `INV-${Date.now()}`;

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

      const payload = buildInvoicePayload(
        invoiceNumber,
        {
          customer_name: customerName || undefined,
          customer_tin: customerTin || undefined,
          buyer_type: buyerType,
          payment_method: paymentMethod,
          total_amount: lastSaleTotal,
          global_discount: lastSaleDiscount > 0 ? lastSaleDiscount : undefined,
        },
        items,
      );

      // DEBUG: Log the exact payload sent to EFRIS (check Metro terminal)
      console.log('=== EFRIS PAYLOAD ===');
      console.log(JSON.stringify(payload, null, 2));
      console.log('=== END PAYLOAD ===');

      const result = await fiscalizeInvoice(config, payload);
      if (result.success) {
        // Store the full EFRIS response for receipt rendering
        const efrisResponse = result.fullEfrisResponse || result;
        await supabase.from('sales').update({
          is_fiscalized: true,
          efris_fdn: result.fdn || null,
          efris_verification_code: result.verification_code || null,
          efris_qr_code: result.qr_code || null,
          efris_response: efrisResponse,
          invoice_number: invoiceNumber,
          buyer_type: buyerType,
          customer_name: customerName || null,
          customer_tin: customerTin || null,
          efris_payment_code: paymentMethod,
          efris_fiscalized_at: new Date().toISOString(),
          customer_id: selectedCustomerId || null,
        }).eq('id', lastSaleId);

        setShowFiscalize(false);
        resetFiscalizeForm();
        // Navigate to receipt screen after fiscalization
        router.push({ pathname: '/receipt', params: { saleId: lastSaleId } });
      } else {
        Alert.alert('EFRIS Error', result.error || 'Fiscalization failed.');
      }
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setFiscalizing(false);
    }
  };

  const resetFiscalizeForm = () => {
    setCustomerName(''); setCustomerTin(''); setBuyerType('1');
    setPaymentMethod('102'); setLastSaleId(null); setLastSaleTotal(0);
    setLastSaleDiscount(0); setSelectedCustomerId(null); setCustomerSearch('');
  };

  const skipFiscalize = () => {
    setShowFiscalize(false);
    const saleIdToShow = lastSaleId;
    resetFiscalizeForm();
    // Navigate to receipt even if not fiscalized
    if (saleIdToShow) {
      router.push({ pathname: '/receipt', params: { saleId: saleIdToShow } });
    }
  };

  if (!permission) return <View />;
  if (!permission.granted && scanning) {
    return (
      <View style={styles.container}>
        <Text style={styles.permissionText}>Camera permission is needed for scanning</Text>
        <TouchableOpacity style={styles.permButton} onPress={requestPermission}>
          <Text style={styles.permButtonText}>Grant Permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.branchName}>📍 {currentBranch?.name || 'No Branch'}</Text>
        <Text style={styles.headerTotal}>Total: {fmt(totalAmount)}</Text>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      {/* Scanner or Action Buttons */}
      {scanning ? (
        <View style={styles.scannerContainer}>
          <CameraView
            style={styles.camera}
            facing="back"
            barcodeScannerSettings={{
              barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'code93', 'qr'],
            }}
            onBarcodeScanned={onBarcodeScanned}
          />
          <View style={styles.scanOverlay}>
            <View style={styles.scanFrame} />
          </View>
          <TouchableOpacity style={styles.closeScanButton} onPress={() => setScanning(false)}>
            <FontAwesome name="times" size={24} color="#fff" />
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={[styles.actionButton, styles.scanButton]}
            onPress={() => {
              if (!permission?.granted) requestPermission();
              else setScanning(true);
            }}
          >
            <FontAwesome name="camera" size={28} color="#fff" />
            <Text style={styles.actionButtonText}>Scan Item</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, styles.searchButton]}
            onPress={() => { setShowSearch(true); loadAllProducts(); }}
          >
            <FontAwesome name="search" size={28} color="#fff" />
            <Text style={styles.actionButtonText}>Search Item</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Cart */}
      <View style={styles.cartContainer}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'transparent' }}>
          <Text style={styles.cartTitle}>🛒 Cart ({cart.reduce((sum, i) => sum + i.quantity, 0)} items)</Text>
          {cart.length > 0 && (
            <TouchableOpacity
              onPress={() => {
                Alert.alert('Clear Cart', 'Remove all items from the cart?', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Clear All', style: 'destructive', onPress: () => setCart([]) },
                ]);
              }}
              style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 4, paddingHorizontal: 10, backgroundColor: 'rgba(233,69,96,0.15)', borderRadius: 8 }}
            >
              <FontAwesome name="trash" size={14} color="#e94560" />
              <Text style={{ color: '#e94560', fontSize: 13, fontWeight: '600', marginLeft: 5 }}>Clear All</Text>
            </TouchableOpacity>
          )}
        </View>
        {cart.length === 0 ? (
          <View style={styles.emptyCart}>
            <Text style={styles.emptyCartText}>Scan or search items to add to cart</Text>
          </View>
        ) : (
          <View>
            {cart.map((item) => {
              const itemDiscAmt = getItemDiscountAmount(item);
              const hasDiscount = itemDiscAmt > 0;
              return (
              <View style={styles.cartItem}>
                <View style={{ flex: 1, backgroundColor: 'transparent' }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', backgroundColor: 'transparent' }}>
                    <View style={styles.cartItemInfo}>
                      <Text style={styles.cartItemName}>{item.name}</Text>
                      {editingPriceId === item.id ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2, backgroundColor: 'transparent' }}>
                          <Text style={{ color: '#aaa', fontSize: 13 }}>{efrisEnabled ? 'Net price:' : 'Price:'}</Text>
                          <TextInput
                            style={{ backgroundColor: '#0f3460', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, color: '#4CAF50', fontSize: 14, fontWeight: 'bold', minWidth: 100, textAlign: 'right' }}
                            value={editPriceValue}
                            onChangeText={setEditPriceValue}
                            keyboardType="numeric"
                            autoFocus
                            selectTextOnFocus
                            onBlur={() => commitEditPrice(item.id)}
                            onSubmitEditing={() => commitEditPrice(item.id)}
                          />
                          <TouchableOpacity onPress={() => commitEditPrice(item.id)}>
                            <FontAwesome name="check" size={16} color="#4CAF50" />
                          </TouchableOpacity>
                        </View>
                      ) : (
                        <TouchableOpacity onPress={() => startEditPrice(item.id, item.price)} activeOpacity={0.6}>
                          <Text style={styles.cartItemPrice}>
                            {fmt(Math.round(efrisEnabled ? item.price * (1 + item.tax_rate) : item.price))} × {item.quantity} = {fmt(Math.round((efrisEnabled ? item.price * (1 + item.tax_rate) : item.price) * item.quantity))}  ✏️
                          </Text>
                          {item.price !== item.originalPrice && (
                            <Text style={{ color: '#ff9800', fontSize: 11, marginTop: 1 }}>
                              Custom price (was {item.originalPrice.toLocaleString()})
                            </Text>
                          )}
                        </TouchableOpacity>
                      )}
                      {hasDiscount && (
                        <Text style={{ color: '#e94560', fontSize: 12, marginTop: 2 }}>
                          Discount: -{item.discountMode === 'percent' ? `${item.discount}%` : `${fmt(Math.round(itemDiscAmt))}`}
                          {item.discountMode === 'percent' ? ` (${fmt(Math.round(itemDiscAmt))})` : ''}
                        </Text>
                      )}
                      {efrisEnabled && item.tax_rate > 0 && editingPriceId !== item.id && (
                        <Text style={{ color: '#888', fontSize: 11, marginTop: 2 }}>
                          Net: {item.price.toLocaleString()} + {(item.tax_rate * 100).toFixed(0)}% tax
                        </Text>
                      )}
                      {efrisEnabled && (
                        <View style={styles.taxChips}>
                          {SALE_TAX_OPTIONS.map(opt => (
                            <TouchableOpacity
                              key={opt.code}
                              style={[styles.taxChip, item.tax_code === opt.code && styles.taxChipActive]}
                              onPress={() => updateItemTax(item.id, opt.code, opt.rate)}
                            >
                              <Text style={[styles.taxChipText, item.tax_code === opt.code && styles.taxChipTextActive]}>
                                {opt.label}
                              </Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      )}
                    </View>
                    <View style={styles.cartItemActions}>
                      <TouchableOpacity style={styles.qtyButton} onPress={() => updateQuantity(item.id, -1)}>
                        <Text style={styles.qtyButtonText}>−</Text>
                      </TouchableOpacity>
                      <Text style={styles.qtyText}>{item.quantity}</Text>
                      <TouchableOpacity style={styles.qtyButton} onPress={() => updateQuantity(item.id, 1)}>
                        <Text style={styles.qtyButtonText}>+</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.removeButton, { marginLeft: 4 }]}
                        onPress={() => setExpandedDiscountId(expandedDiscountId === item.id ? null : item.id)}
                      >
                        <FontAwesome name="percent" size={14} color={hasDiscount ? '#e94560' : '#888'} />
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.removeButton} onPress={() => removeFromCart(item.id)}>
                        <FontAwesome name="trash" size={18} color="#e94560" />
                      </TouchableOpacity>
                    </View>
                  </View>
                  {/* Per-item discount row (expanded) */}
                  {expandedDiscountId === item.id && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#0f3460', backgroundColor: 'transparent' }}>
                      <Text style={{ color: '#aaa', fontSize: 12 }}>Discount:</Text>
                      <TouchableOpacity
                        style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, backgroundColor: item.discountMode === 'amount' ? '#e94560' : '#0f3460' }}
                        onPress={() => toggleItemDiscountMode(item.id)}
                      >
                        <Text style={{ color: item.discountMode === 'amount' ? '#fff' : '#888', fontSize: 11, fontWeight: 'bold' }}>{currency.symbol}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, backgroundColor: item.discountMode === 'percent' ? '#e94560' : '#0f3460' }}
                        onPress={() => toggleItemDiscountMode(item.id)}
                      >
                        <Text style={{ color: item.discountMode === 'percent' ? '#fff' : '#888', fontSize: 11, fontWeight: 'bold' }}>%</Text>
                      </TouchableOpacity>
                      <TextInput
                        style={{ backgroundColor: '#0f3460', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, color: '#e94560', fontSize: 14, fontWeight: 'bold', minWidth: 70, textAlign: 'right', flex: 1 }}
                        value={item.discount}
                        onChangeText={(v) => updateItemDiscount(item.id, v)}
                        keyboardType="numeric"
                        placeholder="0"
                        placeholderTextColor="#555"
                        selectTextOnFocus
                      />
                    </View>
                  )}
                </View>
              </View>
            );})}
          </View>
        )}
      </View>

      {/* Cart Totals */}
      {cart.length > 0 && (
        <View style={styles.cartTotals}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>{efrisEnabled ? 'Subtotal (net)' : 'Subtotal'}</Text>
            <Text style={styles.totalValue}>{fmt(subtotalAmount)}</Text>
          </View>
          {perItemDiscountTotal > 0 && (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Item Discounts</Text>
              <Text style={{ color: '#e94560', fontSize: 14 }}>-{fmt(Math.round(perItemDiscountTotal))}</Text>
            </View>
          )}
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Extra Discount</Text>
            <View style={styles.discountRow}>
              <View style={styles.discountToggle}>
                <TouchableOpacity
                  style={[styles.discountToggleBtn, discountMode === 'amount' && styles.discountToggleBtnActive]}
                  onPress={() => { setDiscountMode('amount'); setDiscount('0'); }}
                >
                  <Text style={[styles.discountToggleText, discountMode === 'amount' && styles.discountToggleTextActive]}>{currency.symbol}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.discountToggleBtn, discountMode === 'percent' && styles.discountToggleBtnActive]}
                  onPress={() => { setDiscountMode('percent'); setDiscount('0'); }}
                >
                  <Text style={[styles.discountToggleText, discountMode === 'percent' && styles.discountToggleTextActive]}>%</Text>
                </TouchableOpacity>
              </View>
              <TextInput
                style={styles.discountInput}
                value={discount}
                onChangeText={setDiscount}
                keyboardType="numeric"
                placeholder="0"
                placeholderTextColor="#555"
                selectTextOnFocus
              />
            </View>
          </View>
          {globalDiscountAmount > 0 && discountMode === 'percent' && (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}></Text>
              <Text style={{ color: '#e94560', fontSize: 12 }}>= -{fmt(Math.round(globalDiscountAmount))}</Text>
            </View>
          )}
          {discountAmount > 0 && (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Total Discount</Text>
              <Text style={{ color: '#e94560', fontSize: 14, fontWeight: 'bold' }}>-{fmt(Math.round(discountAmount))}</Text>
            </View>
          )}
          {efrisEnabled && (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Tax</Text>
              <Text style={styles.totalValue}>{fmt(Math.round(taxAmount))}</Text>
            </View>
          )}
          <View style={[styles.totalRow, styles.grandTotalRow]}>
            <Text style={styles.grandTotalLabel}>TOTAL</Text>
            <Text style={styles.grandTotalValue}>{fmt(Math.round(totalAmount))}</Text>
          </View>
        </View>
      )}

      {/* Payment Method Picker */}
      {cart.length > 0 && (
        <View style={{ paddingHorizontal: 16, paddingTop: 8, backgroundColor: 'transparent' }}>
          <Text style={{ color: '#aaa', fontSize: 12, marginBottom: 6 }}>Payment Method</Text>
          <View style={{ flexDirection: 'row', gap: 6, backgroundColor: 'transparent' }}>
            {PAYMENT_METHODS.map(pm => (
              <TouchableOpacity
                key={pm.value}
                onPress={() => setSalePayMethod(pm.value)}
                style={{ flex: 1, paddingVertical: 8, borderRadius: 10, backgroundColor: salePayMethod === pm.value ? '#e94560' : '#16213e', borderWidth: 1, borderColor: salePayMethod === pm.value ? '#e94560' : '#0f3460', alignItems: 'center' }}
              >
                <Text style={{ color: salePayMethod === pm.value ? '#fff' : '#aaa', fontSize: 11, fontWeight: salePayMethod === pm.value ? 'bold' : 'normal' }}>{pm.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {/* Credit Customer Picker */}
      {cart.length > 0 && salePayMethod === 'credit' && (
        <View style={{ paddingHorizontal: 16, paddingTop: 8, backgroundColor: 'transparent' }}>
          <Text style={{ color: '#FF9800', fontSize: 12, marginBottom: 6 }}>⚠️ Credit Sale — Select Customer</Text>
          {creditCustomer ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#16213e', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: '#4CAF50' }}>
              <FontAwesome name="user" size={14} color="#4CAF50" style={{ marginRight: 8 }} />
              <Text style={{ color: '#fff', flex: 1, fontSize: 14 }}>{creditCustomer.name}</Text>
              <TouchableOpacity onPress={() => setCreditCustomer(null)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <FontAwesome name="times" size={16} color="#e94560" />
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              style={{ backgroundColor: '#16213e', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#FF9800', alignItems: 'center' }}
              onPress={() => { loadCustomers(); setShowCreditPicker(true); }}
            >
              <Text style={{ color: '#FF9800', fontSize: 14 }}>Tap to select customer</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Complete Sale */}
      {cart.length > 0 && (
        efrisEnabled ? (
          <View style={styles.saleButtonRow}>
            <TouchableOpacity style={styles.completeSaleButton} onPress={() => completeSale(false)}>
              <Text style={styles.completeSaleText}>💰 Complete Sale</Text>
              <Text style={styles.completeSaleAmountText}>{fmt(totalAmount)}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.fiscalizeSaleButton} onPress={() => completeSale(true)}>
              <Text style={styles.completeSaleText}>💰 Fiscalize</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity style={[styles.completeSaleButton, { margin: 16 }]} onPress={() => completeSale(false)}>
            <Text style={styles.completeSaleText}>💰 Complete Sale — {fmt(totalAmount)}</Text>
          </TouchableOpacity>
        )
      )}

      <View style={{ height: 16 }} />
      </ScrollView>

      {/* Credit Customer Picker Modal */}
      <Modal visible={showCreditPicker} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Customer</Text>
              <TouchableOpacity onPress={() => setShowCreditPicker(false)}>
                <FontAwesome name="times" size={22} color="#aaa" />
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.searchInput}
              placeholder="Search by name, TIN, phone..."
              placeholderTextColor="#666"
              value={creditCustomerSearch}
              onChangeText={setCreditCustomerSearch}
              autoFocus
            />
            <FlatList
              data={creditFilteredCustomers}
              keyExtractor={(item) => item.id}
              style={{ maxHeight: 350 }}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.productRow}
                  onPress={() => {
                    setCreditCustomer(item);
                    setShowCreditPicker(false);
                    setCreditCustomerSearch('');
                  }}
                >
                  <View style={{ backgroundColor: 'transparent', flex: 1 }}>
                    <Text style={{ color: '#fff', fontSize: 15, fontWeight: 'bold' }}>{item.name}</Text>
                    {item.phone && <Text style={{ color: '#aaa', fontSize: 12 }}>📱 {item.phone}</Text>}
                    {item.tin && <Text style={{ color: '#aaa', fontSize: 12 }}>TIN: {item.tin}</Text>}
                  </View>
                  <FontAwesome name="check-circle" size={20} color="#4CAF50" />
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <Text style={{ color: '#555', textAlign: 'center', marginTop: 20 }}>
                  {customersList.length === 0 ? 'No customers added yet.\nGo to Customers to add one.' : 'No matching customers'}
                </Text>
              }
            />
          </View>
        </View>
      </Modal>

      {/* Search Modal */}
      <Modal visible={showSearch} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Search Products</Text>
              <TouchableOpacity onPress={() => { setShowSearch(false); setSearchResults([]); setSearchQuery(''); }}>
                <FontAwesome name="times" size={24} color="#fff" />
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.searchInput}
              placeholder="Search by product name..."
              placeholderTextColor="#999"
              value={searchQuery}
              onChangeText={(text) => { setSearchQuery(text); searchProducts(text); }}
              autoFocus
            />
            <FlatList
              data={searchResults}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.searchResultItem} onPress={() => addToCart(item)}>
                  {item.image_url ? (
                    <Image source={{ uri: item.image_url }} style={styles.resultImage} />
                  ) : (
                    <View style={styles.resultImagePlaceholder}>
                      <FontAwesome name="cube" size={20} color="#555" />
                    </View>
                  )}
                  <View style={styles.searchResultInfo}>
                    <Text style={styles.searchResultName}>{item.name}</Text>
                    <Text style={styles.searchResultPrice}>
                      {fmt(item.selling_price)} | Stock: {item.stock_quantity}
                      {item.barcode ? '' : '  📝 No barcode'}
                    </Text>
                  </View>
                  <FontAwesome name="plus-circle" size={28} color="#4CAF50" />
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <View style={styles.emptySearchContainer}>
                  <Text style={styles.noResults}>
                    {searchQuery.length > 0 ? 'No products found' : 'All products with stock appear here'}
                  </Text>
                  {searchQuery.length > 0 && (
                    <TouchableOpacity 
                      style={styles.quickAddButton}
                      onPress={() => {
                        setShowSearch(false);
                        setSearchResults([]);
                        setSearchQuery('');
                        router.push('/product/new');
                      }}
                    >
                      <FontAwesome name="plus" size={16} color="#fff" />
                      <Text style={styles.quickAddText}>Quick Add "{searchQuery}" as new product</Text>
                    </TouchableOpacity>
                  )}
                </View>
              }
            />
          </View>
        </View>
      </Modal>

      {/* EFRIS Fiscalize Modal */}
      <Modal visible={showFiscalize} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <ScrollView>
              <Text style={styles.fiscalizeTitle}>🇺🇬 Fiscalize Invoice</Text>
              <Text style={styles.fiscalizeSubtitle}>Sale: {fmt(lastSaleTotal)}</Text>

              <Text style={styles.fiscalizeLabel}>Customer (default: Walk-in B2C)</Text>
              {selectedCustomerId ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#0f3460', borderRadius: 10, padding: 12, marginBottom: 8 }}>
                  <View style={{ flex: 1, backgroundColor: 'transparent' }}>
                    <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 15 }}>{customerName}</Text>
                    {customerTin ? <Text style={{ color: '#aaa', fontSize: 13 }}>TIN: {customerTin}</Text> : null}
                    <Text style={{ color: '#7C3AED', fontSize: 12, marginTop: 2 }}>
                      {EFRIS_BUYER_TYPES.find(b => b.code === buyerType)?.label || 'B2C'}
                    </Text>
                  </View>
                  <TouchableOpacity onPress={clearCustomer} style={{ padding: 8 }}>
                    <FontAwesome name="times-circle" size={22} color="#e94560" />
                  </TouchableOpacity>
                </View>
              ) : (
                <>
                  <TextInput
                    style={styles.searchInput}
                    placeholder="Search saved customers or type name..."
                    placeholderTextColor="#666"
                    value={customerSearch || customerName}
                    onChangeText={(t) => {
                      setCustomerSearch(t);
                      setCustomerName(t);
                    }}
                  />
                  {filteredCustomers.length > 0 && (
                    <View style={{ maxHeight: 150, backgroundColor: '#16213e', borderRadius: 8, marginBottom: 8, borderWidth: 1, borderColor: '#0f3460' }}>
                      {filteredCustomers.slice(0, 5).map((item) => (
                        <TouchableOpacity
                          key={item.id}
                          onPress={() => selectCustomer(item)}
                          style={{ padding: 10, borderBottomWidth: 1, borderBottomColor: '#0f3460' }}
                        >
                          <Text style={{ color: '#fff', fontWeight: '600' }}>{item.name}</Text>
                          <Text style={{ color: '#aaa', fontSize: 12 }}>
                            {item.tin ? `TIN: ${item.tin}` : 'No TIN'} • {item.phone || ''}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                </>
              )}

              <Text style={styles.fiscalizeLabel}>Customer TIN (for B2B)</Text>
              <TextInput
                style={styles.searchInput}
                placeholder="e.g. 1000000001"
                placeholderTextColor="#666"
                value={customerTin}
                onChangeText={setCustomerTin}
                keyboardType="numeric"
                editable={!selectedCustomerId}
              />

              <Text style={styles.fiscalizeLabel}>Buyer Type</Text>
              <View style={styles.chipRowWrap}>
                {EFRIS_BUYER_TYPES.map((bt) => (
                  <TouchableOpacity
                    key={bt.code}
                    style={[styles.fiscalizeChip, buyerType === bt.code && styles.fiscalizeChipActive]}
                    onPress={() => setBuyerType(bt.code)}
                  >
                    <Text style={[styles.fiscalizeChipText, buyerType === bt.code && { color: '#fff' }]}>{bt.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.fiscalizeLabel}>Payment Method</Text>
              <View style={styles.chipRowWrap}>
                {EFRIS_PAYMENT_METHODS.map((pm) => (
                  <TouchableOpacity
                    key={pm.code}
                    style={[styles.fiscalizeChip, paymentMethod === pm.code && styles.fiscalizeChipActive]}
                    onPress={() => setPaymentMethod(pm.code)}
                  >
                    <Text style={[styles.fiscalizeChipText, paymentMethod === pm.code && { color: '#fff' }]}>{pm.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <TouchableOpacity
                style={[styles.fiscalizeBtn, fiscalizing && { opacity: 0.6 }]}
                onPress={handleFiscalize}
                disabled={fiscalizing}
              >
                {fiscalizing ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.fiscalizeBtnText}>Fiscalize 🇺🇬</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity style={styles.skipFiscalizeBtn} onPress={skipFiscalize}>
                <Text style={styles.skipFiscalizeText}>Skip — Print Receipt Without EFRIS</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={{ alignItems: 'center', paddingVertical: 14, marginTop: 4 }}
                onPress={() => { setShowFiscalize(false); resetFiscalizeForm(); }}
              >
                <Text style={{ color: '#e94560', fontSize: 15, fontWeight: '600' }}>Cancel</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#16213e',
    borderBottomWidth: 1, borderBottomColor: '#0f3460',
  },
  branchName: { fontSize: 14, color: '#aaa' },
  headerTotal: { fontSize: 18, fontWeight: 'bold', color: '#4CAF50' },
  permissionText: { textAlign: 'center', marginTop: 40, fontSize: 16, color: '#aaa', paddingHorizontal: 20 },
  permButton: { backgroundColor: '#e94560', borderRadius: 12, padding: 14, margin: 20, alignItems: 'center' },
  permButtonText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  scannerContainer: { height: 250, position: 'relative' },
  camera: { flex: 1 },
  scanOverlay: {
    ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center', backgroundColor: 'transparent',
  },
  scanFrame: { width: 220, height: 120, borderWidth: 2, borderColor: '#4CAF50', borderRadius: 12, backgroundColor: 'transparent' },
  closeScanButton: { position: 'absolute', top: 10, right: 10, backgroundColor: 'rgba(0,0,0,0.6)', padding: 10, borderRadius: 20 },
  actionRow: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 10, gap: 12, backgroundColor: 'transparent' },
  actionButton: { flex: 1, borderRadius: 16, paddingVertical: 16, alignItems: 'center', justifyContent: 'center' },
  scanButton: { backgroundColor: '#0f3460' },
  searchButton: { backgroundColor: '#533483' },
  actionButtonText: { color: '#fff', fontSize: 13, fontWeight: 'bold', marginTop: 4 },
  cartContainer: { paddingHorizontal: 16, backgroundColor: 'transparent' },
  cartTitle: { fontSize: 18, fontWeight: 'bold', color: '#fff', marginBottom: 8 },
  emptyCart: { justifyContent: 'center', alignItems: 'center', backgroundColor: 'transparent', paddingVertical: 40 },
  emptyCartText: { color: '#666', fontSize: 16 },
  cartItem: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#16213e', borderRadius: 12, padding: 12, marginBottom: 8,
  },
  cartItemInfo: { flex: 1, backgroundColor: 'transparent' },
  cartItemName: { fontSize: 16, fontWeight: 'bold', color: '#fff' },
  cartItemPrice: { fontSize: 13, color: '#aaa', marginTop: 2 },
  cartItemActions: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'transparent' },
  qtyButton: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#0f3460', justifyContent: 'center', alignItems: 'center' },
  qtyButtonText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  qtyText: { color: '#fff', fontSize: 16, fontWeight: 'bold', minWidth: 24, textAlign: 'center' },
  removeButton: { marginLeft: 8, padding: 4 },
  taxChips: { flexDirection: 'row', gap: 6, marginTop: 4 },
  taxChip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, backgroundColor: '#0f3460' },
  taxChipActive: { backgroundColor: '#e94560' },
  taxChipText: { color: '#666', fontSize: 10 },
  taxChipTextActive: { color: '#fff', fontSize: 10, fontWeight: 'bold' },
  saleButtonRow: { flexDirection: 'row', gap: 10, marginHorizontal: 16, marginBottom: 8, marginTop: 4 },
  cartTotals: { backgroundColor: '#16213e', marginHorizontal: 16, borderRadius: 12, padding: 12, marginBottom: 4 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  totalLabel: { color: '#aaa', fontSize: 14 },
  totalValue: { color: '#fff', fontSize: 14 },
  discountRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  discountToggle: { flexDirection: 'row', borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: '#0f3460' },
  discountToggleBtn: { paddingHorizontal: 10, paddingVertical: 4, backgroundColor: '#0f3460' },
  discountToggleBtnActive: { backgroundColor: '#e94560' },
  discountToggleText: { color: '#666', fontSize: 12, fontWeight: 'bold' },
  discountToggleTextActive: { color: '#fff', fontSize: 12, fontWeight: 'bold' },
  discountInput: { backgroundColor: '#0f3460', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 4, color: '#e94560', fontSize: 14, fontWeight: 'bold', minWidth: 80, textAlign: 'right' },
  grandTotalRow: { borderTopWidth: 1, borderTopColor: '#0f3460', paddingTop: 8, marginTop: 4, marginBottom: 0 },
  grandTotalLabel: { color: '#4CAF50', fontSize: 18, fontWeight: 'bold' },
  grandTotalValue: { color: '#4CAF50', fontSize: 18, fontWeight: 'bold' },
  completeSaleButton: { flex: 1, backgroundColor: '#4CAF50', borderRadius: 16, padding: 14, alignItems: 'center' },
  fiscalizeSaleButton: { flex: 1, backgroundColor: '#7C3AED', borderRadius: 16, padding: 14, alignItems: 'center' },
  completeSaleText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  completeSaleAmountText: { color: '#fff', fontSize: 13, marginTop: 2 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#1a1a2e', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: '80%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, backgroundColor: 'transparent' },
  modalTitle: { fontSize: 20, fontWeight: 'bold', color: '#fff' },
  searchInput: { backgroundColor: '#16213e', borderRadius: 12, padding: 14, fontSize: 16, color: '#fff', borderWidth: 1, borderColor: '#0f3460', marginBottom: 12 },
  searchResultItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#16213e', borderRadius: 10, padding: 14, marginBottom: 8 },
  resultImage: { width: 44, height: 44, borderRadius: 8, marginRight: 12 },
  resultImagePlaceholder: { width: 44, height: 44, borderRadius: 8, backgroundColor: '#0f3460', justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  searchResultInfo: { flex: 1, backgroundColor: 'transparent' },
  searchResultName: { fontSize: 16, fontWeight: 'bold', color: '#fff' },
  searchResultPrice: { fontSize: 13, color: '#aaa', marginTop: 2 },
  noResults: { textAlign: 'center', color: '#666', marginTop: 20, fontSize: 14 },
  emptySearchContainer: { alignItems: 'center', paddingTop: 20, backgroundColor: 'transparent' },
  quickAddButton: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#e94560', borderRadius: 12, paddingHorizontal: 20, paddingVertical: 14, marginTop: 16 },
  quickAddText: { color: '#fff', fontWeight: 'bold', fontSize: 14 },
  // EFRIS Fiscalize styles
  fiscalizeTitle: { fontSize: 22, fontWeight: 'bold', color: '#7C3AED', textAlign: 'center', marginBottom: 4 },
  fiscalizeSubtitle: { fontSize: 16, color: '#4CAF50', textAlign: 'center', marginBottom: 16 },
  fiscalizeLabel: { fontSize: 13, color: '#aaa', marginBottom: 6, marginTop: 10 },
  chipRowWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
  fiscalizeChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: '#16213e', borderWidth: 1, borderColor: '#0f3460' },
  fiscalizeChipActive: { backgroundColor: '#7C3AED', borderColor: '#7C3AED' },
  fiscalizeChipText: { color: '#aaa', fontSize: 13 },
  fiscalizeBtn: { backgroundColor: '#7C3AED', borderRadius: 14, padding: 18, alignItems: 'center', marginTop: 20 },
  fiscalizeBtnText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  skipFiscalizeBtn: { alignItems: 'center', padding: 14, marginTop: 8, marginBottom: 20 },
  skipFiscalizeText: { color: '#888', fontSize: 14 },
});
