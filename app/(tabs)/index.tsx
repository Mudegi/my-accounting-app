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
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Text, View } from '@/components/Themed';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter, Redirect } from 'expo-router';
import FieldSellScreen from '../field-sales/sell';
import { postSaleEntry, postCustomerPaymentEntry, PAYMENT_METHODS } from '@/lib/accounting';
import { fetchCustomerBalance } from '@/lib/customer-utils';
import { loadCurrencies, convertCurrency, getCurrency, type Currency } from '@/lib/currency';
import {
  fiscalizeInvoice,
  buildInvoicePayload,
  EFRIS_PAYMENT_METHODS,
  EFRIS_BUYER_TYPES,
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
  is_service: boolean;
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
  is_service: boolean;
};


export default function SalesScreen() {
  const { currentBranch, business, profile, fmt, currency, hasFeature, taxes } = useAuth();
  const router = useRouter();

  // Field-only salespeople see the Field Sell screen within the same tab
  if (profile && profile.sales_type === 'field') {
    return <FieldSellScreen />;
  }

  const [permission, requestPermission] = useCameraPermissions();
  const [cart, setCart] = useState<CartItem[]>([]);
  const [scanning, setScanning] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<InventoryItem[]>([]);
  const [showSearch, setShowSearch] = useState(false);
  const [allProducts, setAllProducts] = useState<InventoryItem[]>([]);
  const [lastScannedCode, setLastScannedCode] = useState('');
  const [showQuickAddCustomer, setShowQuickAddCustomer] = useState(false);
  const scanTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [expandedDiscountId, setExpandedDiscountId] = useState<string | null>(null);
  const [editingPriceId, setEditingPriceId] = useState<string | null>(null);
  const [editPriceValue, setEditPriceValue] = useState('');

  // Multi-currency support
  const [saleCurrency, setSaleCurrency] = useState(business?.default_currency || 'UGX');
  const [exchangeRate, setExchangeRate] = useState(1);
  const [availableCurrencies, setAvailableCurrencies] = useState<Currency[]>([]);
  const [isConverting, setIsConverting] = useState(false);

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
  type CustomerOption = { id: string; name: string; tin: string | null; buyer_type: string; phone: string | null; credit_limit: number };
  const [customersList, setCustomersList] = useState<CustomerOption[]>([]);
  const [customerSearch, setCustomerSearch] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  
  // Quick Add Customer states
  const [isSavingCustomer, setIsSavingCustomer] = useState(false);
  const [quickAddName, setQuickAddName] = useState('');
  const [quickAddPhone, setQuickAddPhone] = useState('');

  // Multi-currency support initialization
  useEffect(() => {
    loadAllProducts();
    loadCurrencies().then(setAvailableCurrencies);
  }, [currentBranch?.id]);

  useEffect(() => {
    if (business?.default_currency) {
      setSaleCurrency(business.default_currency);
    }
  }, [business?.default_currency]);

  useEffect(() => {
    const updateRate = async () => {
      if (!business) return;
      if (saleCurrency === business.default_currency) {
        setExchangeRate(1);
        return;
      }
      setIsConverting(true);
      try {
        const { rate } = await convertCurrency(business.id, 1, business.default_currency, saleCurrency);
        setExchangeRate(rate);
      } catch (e) {
        console.error('Rate update error:', e);
      } finally {
        setIsConverting(false);
      }
    };
    updateRate();
  }, [saleCurrency, business?.default_currency]);

  // Partial Payment State
  const [upfrontAmount, setUpfrontAmount] = useState('');
  const [upfrontMethod, setUpfrontMethod] = useState('cash');

  const [quickAddSource, setQuickAddSource] = useState<'credit' | 'efris'>('credit');

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
  const taxAmount = (subtotalAmount > 0 && efrisEnabled)
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
      .select('id, name, tin, buyer_type, phone, credit_limit')
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
        id, name, barcode, image_url, tax_category_code, is_service, efris_product_code,
        inventory!inner(selling_price, avg_cost_price, quantity)
      `)
      .eq('business_id', business.id)
      .eq('inventory.branch_id', currentBranch.id)
      .order('name');

    if (data) {
      // Rule: Service is always available. 
      // Physical product requires stock > 0 AND a cost price > 0 to be available for sale.
      const results: InventoryItem[] = data
        .filter((p: any) => p.is_service || ((p.inventory[0]?.quantity || 0) > 0 && (p.inventory[0]?.avg_cost_price || 0) > 0))
        .map((p: any) => ({
          id: p.id,
          name: p.name,
          barcode: p.barcode,
          image_url: p.image_url,
          selling_price: p.inventory[0]?.selling_price || 0,
          avg_cost_price: p.inventory[0]?.avg_cost_price || 0,
          stock_quantity: p.inventory[0]?.quantity || 0,
          tax_category_code: p.tax_category_code || '01',
          is_service: p.is_service ?? false,
          efris_product_code: p.efris_product_code || null,
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

    const lower = query.toLowerCase();
    
    const localMatches = allProducts.filter(p => 
      (p.is_service || p.stock_quantity > 0) &&
      (p.name.toLowerCase().includes(lower) || 
      (p.barcode && p.barcode.includes(query)))
    );
    setSearchResults(localMatches);

    // 2. Only hit the network if we have few local matches AND query is long enough
    // This allows finding items that might not have been in the initial "loadAll"
    if (localMatches.length < 5 && query.length >= 3) {
      const { data } = await supabase
        .from('products')
        .select(`
          id, name, barcode, image_url, tax_category_code, is_service,
          inventory!inner(selling_price, avg_cost_price, quantity)
        `)
        .eq('business_id', business.id)
        .eq('inventory.branch_id', currentBranch?.id)
        .ilike('name', `%${query}%`)
        .limit(20);

      if (data) {
        const networkResults: InventoryItem[] = data
          .filter((p: any) => p.is_service || ((p.inventory[0]?.quantity || 0) > 0 && (p.inventory[0]?.avg_cost_price || 0) > 0))
          .map((p: any) => ({
            id: p.id,
            name: p.name,
            barcode: p.barcode,
            image_url: p.image_url,
            selling_price: p.inventory[0]?.selling_price || 0,
            avg_cost_price: p.inventory[0]?.avg_cost_price || 0,
            stock_quantity: p.inventory[0]?.quantity || 0,
            tax_category_code: p.tax_category_code || '01',
            is_service: p.is_service ?? false,
          }));
        
        // Merge with local results, avoiding duplicates
        setSearchResults(prev => {
          const combined = [...prev];
          networkResults.forEach(nr => {
            if (!combined.some(c => c.id === nr.id)) combined.push(nr);
          });
          return combined;
        });
      }
    }
  };

  // Look up product by barcode
  const lookupBarcode = async (barcode: string) => {
    if (!business || !currentBranch) return;

    const { data } = await supabase
      .from('products')
      .select(`
        id, name, barcode, image_url, tax_category_code, is_service, efris_product_code,
        inventory!inner(selling_price, avg_cost_price, quantity)
      `)
      .eq('business_id', business.id)
      .eq('barcode', barcode)
      .eq('inventory.branch_id', currentBranch.id)
      .single();

    if (data) {
      const inv = (data as any).inventory[0];
      const cost = inv?.avg_cost_price || 0;
      const isService = (data as any).is_service ?? false;

      // Enforcement: No stock = No sale (except services)
      if (!isService && (inv?.quantity || 0) <= 0) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        Alert.alert('Out of Stock', 'This item doesnt have stock');
        return;
      }

      // Enforcement: No cost price = No sale (except services)
      if (!isService && cost <= 0) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        Alert.alert('Sale Blocked', `"${data.name}" cannot be sold because its cost price is not set. Please update the product cost in Inventory first.`);
        return;
      }

      addToCart({
        id: data.id,
        name: data.name,
        barcode: data.barcode,
        image_url: data.image_url,
        selling_price: inv?.selling_price || 0,
        avg_cost_price: cost,
        stock_quantity: inv?.quantity || 0,
        tax_category_code: (data as any).tax_category_code || '01',
        is_service: isService,
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
    scanTimeoutRef.current = setTimeout(() => setLastScannedCode(''), 2000) as any;
    lookupBarcode(data);
  };

  // Add item to cart
  const addToCart = (product: InventoryItem) => {
    // Non-EFRIS users: no tax calculation, price = price
    // Resolve tax rate from product's tax category or business defaults
    const taxCat = taxes.find(t => t.code === product.tax_category_code);
    const defaultTaxRate = taxCat?.rate ?? 0;
    const defaultTaxCode = product.tax_category_code || (taxes.find(t => t.is_default)?.code) || (taxes[0]?.code) || '00';
    setCart((prev) => {
      const existing = prev.find((item) => item.product_id === product.id);
      if (existing) {
        if (!product.is_service && existing.quantity >= existing.stock_quantity) {
          Alert.alert('Stock Limit', `Only ${existing.stock_quantity} unit(s) of "${existing.name}" available in stock.`);
          return prev;
        }
        return prev.map((item) =>
          item.product_id === product.id
            ? { ...item, quantity: item.quantity + 1 }
            : item
        );
      }
      if (!product.is_service && product.stock_quantity <= 0) {
        Alert.alert('Out of Stock', 'This item doesnt have stock');
        return prev;
      }
      if (!product.is_service && (product.avg_cost_price || 0) <= 0) {
        Alert.alert('Incomplete Product', `"${product.name}" cannot be sold because its cost price is missing. Update it in Inventory first.`);
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
          is_service: product.is_service,
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
      if (target && delta > 0 && !target.is_service && target.quantity >= target.stock_quantity) {
        Alert.alert('Stock Limit', `Only ${target.stock_quantity} unit(s) of "${target.name}" available in stock.`);
        return prev;
      }
      return prev
        .map((item) =>
          item.id === id
            ? { ...item, quantity: Math.max(0, item.is_service ? (item.quantity + delta) : Math.min(item.stock_quantity, item.quantity + delta)) }
            : item
        )
        .filter((item) => item.quantity > 0);
    });
  };

  const setCartQuantity = (id: string, value: string) => {
    const qty = parseFloat(value) || 0;
    setCart((prev) => {
      const target = prev.find((item) => item.id === id);
      if (target && !target.is_service && qty > target.stock_quantity) {
        Alert.alert('Stock Limit', `Only ${target.stock_quantity} unit(s) of "${target.name}" available in stock.`);
        return prev.map(item => item.id === id ? { ...item, quantity: item.stock_quantity } : item);
      }
      return prev.map((item) =>
        item.id === id ? { ...item, quantity: Math.max(0, qty) } : item
      );
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

  const handleQuickAddSave = async () => {
    if (!quickAddName.trim()) {
      Alert.alert('Error', 'Customer name is required');
      return;
    }
    if (!business) return;
    
    setIsSavingCustomer(true);
    try {
      const { data, error } = await supabase
        .from('customers')
        .insert({
          business_id: business.id,
          name: quickAddName.trim(),
          phone: quickAddPhone.trim() || null,
          buyer_type: '1', // Default to B2C for quick add
        })
        .select()
        .single();

      if (error) throw error;

      // Update local choices
      const newCustomer: CustomerOption = { id: data.id, name: data.name, tin: data.tin, phone: data.phone, buyer_type: data.buyer_type, credit_limit: data.credit_limit || 0 };
      setCustomersList(prev => [newCustomer, ...prev]);
      
      if (quickAddSource === 'credit') {
        setCreditCustomer(newCustomer);
        setShowCreditPicker(false);
      } else if (quickAddSource === 'efris') {
        setSelectedCustomerId(data.id);
        setCustomerName(data.name);
        setCustomerTin(data.tin || '');
        if (data.tin) setBuyerType('2'); // Auto set B2B if TIN exists
      }
      
      // Close modal
      setShowQuickAddCustomer(false);
      
      // Reset form
      setQuickAddName('');
      setQuickAddPhone('');
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setIsSavingCustomer(false);
    }
  };

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

    // Credit Limit Check
    if (salePayMethod === 'credit' && creditCustomer && creditCustomer.credit_limit > 0) {
      try {
        const currentBalance = await fetchCustomerBalance(business.id, creditCustomer.id, null);
        const newTotal = currentBalance + Math.round(totalAmount) - (Number(upfrontAmount) || 0);
        if (newTotal > creditCustomer.credit_limit) {
          Alert.alert(
            'Credit Limit Exceeded',
            `This sale pushes the customer over their limit of ${fmt(creditCustomer.credit_limit)}.\n\n` +
            `Current Balance: ${fmt(currentBalance)}\n` +
            `Limit Remaining: ${fmt(Math.max(0, creditCustomer.credit_limit - currentBalance))}`
          );
          return;
        }
      } catch (e) {
        console.error('Balance check error:', e);
      }
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
          currency: saleCurrency,
          exchange_rate: 1 / exchangeRate, // rate from display currency BACK to base (e.g. 1 USD = 3800 UGX)
          base_total: Math.round(totalAmount / exchangeRate), // consistent reporting
          payment_method: salePayMethod,
          status: 'completed',
          customer_id: creditCustomer?.id || null,
          customer_name: creditCustomer?.name || null,
        })
        .select()
        .single();

      if (saleError) throw saleError;

      // Handle Partial Payment (Upfront)
      const upfront = Number(upfrontAmount) || 0;
      if (salePayMethod === 'credit' && upfront > 0) {
        if (upfront > totalAmount) {
          throw new Error('Upfront payment cannot exceed total amount');
        }

        // Insert payment record
        await supabase
          .from('debt_payments')
          .insert({
            business_id: business.id,
            sale_id: sale.id,
            customer_id: creditCustomer!.id,
            amount: upfront,
            payment_method: upfrontMethod,
            note: 'Initial partial payment at checkout',
            received_by: profile.id,
          });

        // Accounting entry
        await postCustomerPaymentEntry({
          businessId: business.id,
          branchId: currentBranch.id,
          paymentId: sale.id,
          amount: upfront,
          customerName: creditCustomer!.name,
          paymentMethod: upfrontMethod,
          userId: profile.id,
        });
      }

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

      // We'll calculate COGS but only decrement inventory later if EFRIS is active
      let actualCOGS = 0;
      let goodsRevenue = cart.filter(i => !i.is_service).reduce((sum, i) => sum + (i.price * i.quantity), 0);
      let serviceRevenue = cart.filter(i => i.is_service).reduce((sum, i) => sum + (i.price * i.quantity), 0);

      // Inventory decrement is moved to AFTER fiscalization for EFRIS sales
      if (!(withEfris && efrisEnabled)) {
        const physicalItems = cart.filter(i => !i.is_service).map(i => ({
          product_id: i.product_id,
          quantity: i.quantity
        }));
        
        if (physicalItems.length > 0) {
          const { data: avcoResults } = await supabase.rpc('decrement_inventory_batch', {
            p_branch_id: currentBranch.id,
            p_items: physicalItems
          });
          if (avcoResults) {
            avcoResults.forEach((res: any) => {
              const item = cart.find(i => i.product_id === res.product_id);
              if (item) actualCOGS += (Number(res.avco) || 0) * Number(item.quantity);
            });
          }
        }
      }

      postSaleEntry({
        businessId: business.id,
        branchId: currentBranch.id,
        saleId: sale.id,
        subtotal: subtotalAmount / exchangeRate,
        taxAmount: Math.round(taxAmount / exchangeRate),
        totalAmount: Math.round(totalAmount / exchangeRate),
        costOfGoods: actualCOGS,
        goodsRevenue: goodsRevenue / exchangeRate,
        serviceRevenue: serviceRevenue / exchangeRate,
        discountAmount: discountAmount / exchangeRate,
        paymentMethod: salePayMethod,
        userId: profile.id,
        currencyCode: saleCurrency,
        exchangeRate: 1 / exchangeRate,
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

              try {
                await supabase.rpc('increment_loyalty_points', {
                  p_customer_id: creditCustomer.id,
                  p_points: pointsEarned,
                });
              } catch (e) {
                // Fallback if RPC doesn't exist: direct update
                const { data } = await supabase
                  .from('customers')
                  .select('loyalty_points')
                  .eq('id', creditCustomer.id)
                  .single();
                
                if (data) {
                  await supabase
                    .from('customers')
                    .update({ loyalty_points: (data.loyalty_points || 0) + pointsEarned })
                    .eq('id', creditCustomer.id);
                }
              }
            }
          }
        } catch (_) { /* loyalty is non-critical */ }
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      if (withEfris && efrisEnabled) {
        setLastSaleId(sale.id);
        setLastSaleTotal(Math.round(totalAmount));
        setLastSaleDiscount(Math.round(globalDiscountAmount)); // only global (extra) discount
        setPaymentMethod('102'); // Force Cash (102) for EFRIS by default
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
      setSalePayMethod('cash'); // Force back to cash for next sale
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

      console.log('Attempting to fiscalize sale:', lastSaleId);
      
      // Get sale items with product EFRIS data
      let { data: saleItems, error: fetchError } = await supabase
        .from('sale_items')
        .select(`*, products:product_id(efris_product_code, efris_item_code, commodity_code, tax_category_code, unit)`)
        .eq('sale_id', lastSaleId);
      
      if (fetchError) console.error('Fetch sale items error:', fetchError.message);

      if (!saleItems || saleItems.length === 0) {
        // One quick retry
        const { data: retryItems } = await supabase
          .from('sale_items')
          .select(`*, products:product_id(efris_product_code, efris_item_code, commodity_code, tax_category_code, unit)`)
          .eq('sale_id', lastSaleId);
        saleItems = retryItems;
      }

      if (!saleItems || saleItems.length === 0) { 
        Alert.alert('Error', 'No sale items found for this record. Try again or skip to print receipt.'); 
        setFiscalizing(false); 
        return; 
      }

      // Warn about unregistered items
      const unregistered = saleItems.filter((si: any) => !si.products?.efris_product_code);
      if (unregistered.length > 0) {
        const names = unregistered.map((si: any) => si.product_name).join(', ');
        Alert.alert('EFRIS Registration Required', `The following items are not registered with EFRIS: ${names}. Please register them in the product form before fiscalizing.`);
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
        const { error: updateErr } = await supabase.from('sales').update({
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

        if (updateErr) throw updateErr;

        // NOW DECREMENT INVENTORY after successful fiscalization
        const physicalItems = saleItems.filter((si: any) => !si.products?.is_service).map((si: any) => ({
          product_id: si.product_id,
          quantity: si.quantity
        }));
        if (physicalItems.length > 0) {
          await supabase.rpc('decrement_inventory_batch', {
            p_branch_id: currentBranch.id,
            p_items: physicalItems
          });
        }

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

  const skipFiscalize = async () => {
    // If skipping, we still need to decrement inventory for the items already saved in completeSale
    if (lastSaleId && currentBranch) {
      const { data: saleItems } = await supabase.from('sale_items').select('product_id, quantity').eq('sale_id', lastSaleId);
      if (saleItems && saleItems.length > 0) {
        await supabase.rpc('decrement_inventory_batch', {
          p_branch_id: currentBranch.id,
          p_items: saleItems
        });
      }
    }
    
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
              <View key={item.id} style={styles.cartItem}>
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
                          {taxes.map(tax => (
                            <TouchableOpacity
                              key={tax.code}
                              style={[styles.taxChip, item.tax_code === tax.code && styles.taxChipActive]}
                              onPress={() => updateItemTax(item.id, tax.code, tax.rate)}
                            >
                              <Text style={[styles.taxChipText, item.tax_code === tax.code && styles.taxChipTextActive]}>
                                {tax.name}
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
                      <TextInput
                        style={[styles.qtyText, { backgroundColor: '#0f3460', borderRadius: 4, minWidth: 40, textAlign: 'center' }]}
                        value={item.quantity.toString()}
                        onChangeText={(v) => setCartQuantity(item.id, v)}
                        keyboardType="decimal-pad"
                        selectTextOnFocus
                      />
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
          <View style={[styles.totalRow, styles.grandTotalRow, { borderBottomWidth: 0 }]}>
            <Text style={styles.grandTotalLabel}>TOTAL</Text>
            <Text style={styles.grandTotalValue}>{fmt(Math.round(totalAmount))}</Text>
          </View>

          {/* Currency Selection */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: '#0f3460' }}>
             <Text style={{ color: '#aaa', fontSize: 13 }}>Display Currency</Text>
             <View style={{ flexDirection: 'row', gap: 6 }}>
               {availableCurrencies.map(c => (
                 <TouchableOpacity
                   key={c.code}
                   onPress={() => setSaleCurrency(c.code)}
                   style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: saleCurrency === c.code ? '#4CAF50' : '#16213e', borderWidth: 1, borderColor: saleCurrency === c.code ? '#4CAF50' : '#0f3460' }}
                 >
                   <Text style={{ color: '#fff', fontSize: 11, fontWeight: 'bold' }}>{c.code}</Text>
                 </TouchableOpacity>
               ))}
             </View>
          </View>
          
          {saleCurrency !== business?.default_currency && (
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10 }}>
               <Text style={{ color: '#4CAF50', fontSize: 14, fontWeight: 'bold' }}>Converted Total</Text>
               <View style={{ alignItems: 'flex-end' }}>
                 <Text style={{ color: '#4CAF50', fontSize: 18, fontWeight: 'bold' }}>
                   {isConverting ? '...' : `${getCurrency(saleCurrency).symbol} ${Math.round(totalAmount * exchangeRate).toLocaleString()}`}
                 </Text>
                 <Text style={{ color: '#666', fontSize: 10 }}>Rate: 1 {business?.default_currency} = {exchangeRate.toFixed(2)} {saleCurrency}</Text>
               </View>
            </View>
          )}
        </View>
      )}

      {/* Payment Method Picker */}
      {cart.length > 0 && (
        <View style={{ paddingHorizontal: 16, paddingTop: 8, backgroundColor: 'transparent' }}>
          <Text style={{ color: '#aaa', fontSize: 12, marginBottom: 6 }}>Payment Method</Text>
          <ScrollView 
            horizontal 
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 6 }}
            style={{ backgroundColor: 'transparent' }}
          >
            {PAYMENT_METHODS.map((pm: any) => (
              <TouchableOpacity
                key={pm.value}
                onPress={() => setSalePayMethod(pm.value)}
                style={{ paddingVertical: 8, paddingHorizontal: 16, borderRadius: 10, backgroundColor: salePayMethod === pm.value ? '#e94560' : '#16213e', borderWidth: 1, borderColor: salePayMethod === pm.value ? '#e94560' : '#0f3460', alignItems: 'center', minWidth: 90 }}
              >
                <Text style={{ color: salePayMethod === pm.value ? '#fff' : '#aaa', fontSize: 11, fontWeight: salePayMethod === pm.value ? 'bold' : 'normal' }}>{pm.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
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

      {/* Upfront Payment for Credit Sales */}
      {cart.length > 0 && salePayMethod === 'credit' && creditCustomer && (
        <View style={{ paddingHorizontal: 16, paddingTop: 12, backgroundColor: 'transparent' }}>
          <View style={{ backgroundColor: '#16213e', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#0f3460' }}>
             <Text style={{ color: '#aaa', fontSize: 13, marginBottom: 8 }}>Partial Payment (Optional)</Text>
             <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#0f3460', borderRadius: 8, paddingHorizontal: 10 }}>
               <Text style={{ color: '#666', fontSize: 16, marginRight: 4 }}>UGX</Text>
               <TextInput
                 style={{ flex: 1, color: '#fff', fontSize: 16, height: 44, fontWeight: 'bold' }}
                 placeholder="0"
                 placeholderTextColor="#555"
                 keyboardType="numeric"
                 value={upfrontAmount}
                 onChangeText={setUpfrontAmount}
               />
             </View>
             
             {Number(upfrontAmount) > 0 && (
               <>
                 <Text style={{ color: '#aaa', fontSize: 11, marginTop: 12, marginBottom: 6 }}>Paid via:</Text>
                 <View style={{ flexDirection: 'row', gap: 6 }}>
                   {['cash', 'mobile_money', 'card'].map((m: any) => (
                     <TouchableOpacity
                       key={m}
                       onPress={() => setUpfrontMethod(m)}
                       style={{ flex: 1, paddingVertical: 6, borderRadius: 8, backgroundColor: upfrontMethod === m ? '#4CAF50' : '#0f3460', alignItems: 'center' }}
                     >
                       <Text style={{ color: upfrontMethod === m ? '#fff' : '#aaa', fontSize: 10, fontWeight: 'bold' }}>
                         {PAYMENT_METHODS.find((p: any) => p.value === m)?.label || m}
                       </Text>
                     </TouchableOpacity>
                   ))}
                 </View>
                 <Text style={{ color: '#4CAF50', fontSize: 12, marginTop: 10, textAlign: 'right' }}>
                    Balance to Debt: {fmt(totalAmount - (Number(upfrontAmount) || 0))}
                 </Text>
               </>
             )}
          </View>
        </View>
      )}

      {/* Complete Sale */}
      {cart.length > 0 && (
        (efrisEnabled && hasFeature('efris')) ? (
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
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
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

            <TouchableOpacity 
              style={styles.quickAddButtonShort}
              onPress={() => {
                setQuickAddSource('credit');
                setQuickAddName(creditCustomerSearch);
                setShowQuickAddCustomer(true);
              }}
            >
              <FontAwesome name="user-plus" size={14} color="#fff" />
              <Text style={{ color: '#fff', fontWeight: 'bold', marginLeft: 8 }}>
                {creditCustomerSearch.trim() ? `Quick Add "${creditCustomerSearch}"` : 'Add New Customer'}
              </Text>
            </TouchableOpacity>
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
                <View style={{ alignItems: 'center', marginTop: 20, backgroundColor: 'transparent' }}>
                  <Text style={{ color: '#555', textAlign: 'center', marginBottom: 16 }}>
                    {customersList.length === 0 ? 'No customers added yet.' : 'No matching customers'}
                  </Text>
                  {creditCustomerSearch.trim().length > 0 && (
                    <TouchableOpacity 
                      style={styles.quickAddButton}
                      onPress={() => {
                        setQuickAddName(creditCustomerSearch);
                        setShowQuickAddCustomer(true);
                      }}
                    >
                      <FontAwesome name="user-plus" size={16} color="#fff" />
                      <Text style={styles.quickAddText}>Add "{creditCustomerSearch}" as new customer</Text>
                    </TouchableOpacity>
                  )}
                </View>
              }
            />
          </View>
        </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Search Modal */}
      <Modal visible={showSearch} animationType="slide" transparent>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
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
        </KeyboardAvoidingView>
      </Modal>

      {/* EFRIS Fiscalize Modal */}
      <Modal visible={showFiscalize} animationType="slide" transparent>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
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
                  <View style={{ flexDirection: 'row', gap: 6, marginBottom: 8, backgroundColor: 'transparent' }}>
                    <TextInput
                      style={[styles.searchInput, { flex: 1, marginBottom: 0 }]}
                      placeholder="Search saved customers..."
                      placeholderTextColor="#666"
                      value={customerSearch}
                      onChangeText={setCustomerSearch}
                    />
                    <TouchableOpacity 
                      style={{ backgroundColor: '#e94560', width: 44, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center' }}
                      onPress={() => {
                        setQuickAddSource('efris');
                        setQuickAddName(customerSearch);
                        setShowQuickAddCustomer(true);
                      }}
                    >
                      <FontAwesome name="user-plus" size={18} color="#fff" />
                    </TouchableOpacity>
                  </View>
                  
                  {/* Manual Name Entry if no customer selected */}
                  {!customerSearch && (
                    <TextInput
                      style={[styles.searchInput, { marginBottom: filteredCustomers.length > 0 ? 8 : 4 }]}
                      placeholder="Or type customer name manually..."
                      placeholderTextColor="#555"
                      value={customerName}
                      onChangeText={setCustomerName}
                    />
                  )}
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
        </KeyboardAvoidingView>
      </Modal>

      {/* Quick Add Customer Modal */}
      <Modal visible={showQuickAddCustomer} animationType="fade" transparent>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalContent, { maxHeight: '50%' }]}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Quick Add Customer</Text>
                <TouchableOpacity onPress={() => setShowQuickAddCustomer(false)}>
                  <FontAwesome name="times" size={24} color="#fff" />
                </TouchableOpacity>
              </View>

              <Text style={styles.fiscalizeLabel}>Full Name</Text>
              <TextInput
                style={styles.searchInput}
                placeholder="Customer or Plate Name"
                placeholderTextColor="#666"
                value={quickAddName}
                onChangeText={setQuickAddName}
                autoFocus
              />

              <Text style={styles.fiscalizeLabel}>Phone Number (Optional)</Text>
              <TextInput
                style={styles.searchInput}
                placeholder="+256..."
                placeholderTextColor="#666"
                value={quickAddPhone}
                onChangeText={setQuickAddPhone}
                keyboardType="phone-pad"
              />

              <TouchableOpacity
                style={[styles.quickAddButton, { marginTop: 10, width: '100%', justifyContent: 'center' }]}
                onPress={handleQuickAddSave}
                disabled={isSavingCustomer}
              >
                {isSavingCustomer ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <FontAwesome name="save" size={16} color="#fff" />
                    <Text style={styles.quickAddText}>Save & Select</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
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
  productRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#16213e', borderRadius: 10, padding: 14, marginBottom: 8 },
  resultImage: { width: 44, height: 44, borderRadius: 8, marginRight: 12 },
  resultImagePlaceholder: { width: 44, height: 44, borderRadius: 8, backgroundColor: '#0f3460', justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  searchResultInfo: { flex: 1, backgroundColor: 'transparent' },
  searchResultName: { fontSize: 16, fontWeight: 'bold', color: '#fff' },
  searchResultPrice: { fontSize: 13, color: '#aaa', marginTop: 2 },
  noResults: { textAlign: 'center', color: '#666', marginTop: 20, fontSize: 14 },
  emptySearchContainer: { alignItems: 'center', paddingTop: 20, backgroundColor: 'transparent' },
  quickAddButton: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#e94560', borderRadius: 12, paddingHorizontal: 20, paddingVertical: 14, marginTop: 16 },
  quickAddButtonShort: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#e94560', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 12 },
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
