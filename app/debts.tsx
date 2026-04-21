import React, { useState, useCallback } from 'react';
import {
  StyleSheet,
  TouchableOpacity,
  FlatList,
  TextInput,
  Alert,
  Modal,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Text, View } from '@/components/Themed';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useFocusEffect, useRouter } from 'expo-router';
import { postSaleEntry, postSupplierPaymentEntry, postCustomerPaymentEntry, PAYMENT_METHODS, ACC, PAYMENT_ACCOUNT_MAP } from '@/lib/accounting';
import { printStatement, shareStatementPdf, StatementData, StatementEntry } from '@/lib/receipt';
import DateTimePicker from '@react-native-community/datetimepicker';

type DebtCustomer = {
  id: string;
  name: string;
  phone: string | null;
  totalDebt: number;
  totalPaid: number;
  balance: number;
  salesCount: number;
};

type CreditSale = {
  id: string;
  total_amount: number;
  created_at: string;
  paid: number;
  balance: number;
  status: string;
  items?: string; // Concise list of items for the history view
};

type DebtPayment = {
  id: string;
  amount: number;
  payment_method: string;
  note: string | null;
  created_at: string;
};

// ─── Payable types (supplier debts we owe) ────

type PayableSupplier = {
  id: string;
  name: string;
  totalOwed: number;
  totalPaid: number;
  balance: number;
  purchaseCount: number;
};

type CreditPurchase = {
  id: string;
  total_amount: number;
  created_at: string;
  paid: number;
  balance: number;
};

type SupplierPayment = {
  id: string;
  amount: number;
  payment_method: string;
  note: string | null;
  created_at: string;
};

export default function DebtsScreen() {
  const { business, currentBranch, profile, fmt } = useAuth();
  const router = useRouter();
  const isAdmin = profile?.role === 'admin';

  const [customers, setCustomers] = useState<DebtCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Detail modal state
  const [selectedCustomer, setSelectedCustomer] = useState<DebtCustomer | null>(null);
  const [creditSales, setCreditSales] = useState<CreditSale[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Payment modal state
  const [showPayment, setShowPayment] = useState(false);
  const [payingSale, setPayingSale] = useState<CreditSale | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState('cash');
  const [payNote, setPayNote] = useState('');
  const [saving, setSaving] = useState(false);

  // Payment history modal
  const [showHistory, setShowHistory] = useState(false);
  const [historyPayments, setHistoryPayments] = useState<DebtPayment[]>([]);
  const [historySaleId, setHistorySaleId] = useState<string>('');

  // Account Statement states
  const [statementView, setStatementView] = useState(false);
  const [startDate, setStartDate] = useState(new Date(new Date().setDate(new Date().getDate() - 30)));
  const [endDate, setEndDate] = useState(new Date());
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);
  const [statementLedger, setStatementLedger] = useState<StatementEntry[]>([]);
  const [openingBalance, setOpeningBalance] = useState(0);
  const [loadingStatement, setLoadingStatement] = useState(false);

  // ─── Tab toggle: Receivables (customer debts) vs Payables (supplier debts) ────
  const [activeTab, setActiveTab] = useState<'receivables' | 'payables'>('receivables');

  // ─── Payables state ────
  const [suppliers, setSuppliers] = useState<PayableSupplier[]>([]);
  const [loadingPayables, setLoadingPayables] = useState(false);
  const [selectedSupplier, setSelectedSupplier] = useState<PayableSupplier | null>(null);
  const [creditPurchases, setCreditPurchases] = useState<CreditPurchase[]>([]);
  const [loadingSupplierDetail, setLoadingSupplierDetail] = useState(false);
  const [showSupplierPayment, setShowSupplierPayment] = useState(false);
  const [payingPurchase, setPayingPurchase] = useState<CreditPurchase | null>(null);
  const [supplierPayAmount, setSupplierPayAmount] = useState('');
  const [supplierPayMethod, setSupplierPayMethod] = useState('cash');
  const [supplierPayNote, setSupplierPayNote] = useState('');
  const [savingSupplierPay, setSavingSupplierPay] = useState(false);
  const [showSupplierHistory, setShowSupplierHistory] = useState(false);
  const [supplierHistoryPayments, setSupplierHistoryPayments] = useState<SupplierPayment[]>([]);
  const [supplierHistoryPurchaseId, setSupplierHistoryPurchaseId] = useState<string>('');

  const loadDebts = useCallback(async () => {
    if (!business) return;

    try {
      // Get all credit sales
      let query = supabase
        .from('sales')
        .select('id, total_amount, customer_id, customer_name, created_at, status')
        .eq('business_id', business.id)
        .eq('payment_method', 'credit')
        .eq('status', 'completed');

      if (!isAdmin && currentBranch) {
        query = query.eq('branch_id', currentBranch.id);
      }

      const { data: creditSalesData, error: salesError } = await query;

      if (salesError) {
        console.error('Debts query error:', salesError.message);
        Alert.alert('Error', salesError.message);
        setLoading(false);
        return;
      }

      if (!creditSalesData || creditSalesData.length === 0) {
        setCustomers([]);
        setLoading(false);
        return;
      }

      // Get all debt payments
      const saleIds = creditSalesData.map(s => s.id);
      const { data: paymentsData } = await supabase
        .from('debt_payments')
        .select('sale_id, amount')
        .in('sale_id', saleIds);
      // Note: if debt_payments table doesn't exist yet, paymentsData will be null — that's OK

      // Get customer details for sales that have customer_id
      const customerIds = [...new Set(creditSalesData.map(s => s.customer_id).filter(Boolean))] as string[];
      let customerMap: Record<string, { name: string; phone: string | null }> = {};
      if (customerIds.length > 0) {
        const { data: customersData } = await supabase
          .from('customers')
          .select('id, name, phone')
          .in('id', customerIds);
        customersData?.forEach(c => { customerMap[c.id] = { name: c.name, phone: c.phone }; });
      }

      // Aggregate payments per sale
      const paymentsBySale: Record<string, number> = {};
      paymentsData?.forEach(p => {
        paymentsBySale[p.sale_id] = (paymentsBySale[p.sale_id] || 0) + Number(p.amount);
      });

      // Aggregate per customer (or by customer_name for walk-in credit sales)
      const custMap: Record<string, DebtCustomer> = {};
      creditSalesData.forEach(sale => {
        // Use customer_id if available, otherwise group by customer_name
        const custId = sale.customer_id || `name:${sale.customer_name || 'Walk-in'}`;
        if (!custMap[custId]) {
          const info = sale.customer_id
            ? (customerMap[sale.customer_id] || { name: sale.customer_name || 'Unknown', phone: null })
            : { name: sale.customer_name || 'Walk-in Customer', phone: null };
          custMap[custId] = {
            id: custId,
            name: info.name,
            phone: info.phone,
            totalDebt: 0,
            totalPaid: 0,
            balance: 0,
            salesCount: 0,
          };
        }
        const paid = paymentsBySale[sale.id] || 0;
        custMap[custId].totalDebt += Number(sale.total_amount);
        custMap[custId].totalPaid += paid;
        custMap[custId].salesCount += 1;
      });

      // Compute balances
      Object.values(custMap).forEach(c => {
        c.balance = c.totalDebt - c.totalPaid;
      });

      // Sort by balance descending (most owing first), filter out fully paid
      const sorted = Object.values(custMap)
        .filter(c => c.balance > 0)
        .sort((a, b) => b.balance - a.balance);

      setCustomers(sorted);
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setLoading(false);
    }
  }, [business, currentBranch, isAdmin]);

  useFocusEffect(useCallback(() => { loadDebts(); loadPayables(); }, [loadDebts]));

  const onRefresh = async () => {
    setRefreshing(true);
    if (activeTab === 'receivables') {
      await loadDebts();
    } else {
      await loadPayables();
    }
    setRefreshing(false);
  };

  // ─── PAYABLES: Load credit purchases (business owes suppliers) ────

  const loadPayables = useCallback(async () => {
    if (!business) return;
    setLoadingPayables(true);
    try {
      let query = supabase
        .from('purchases')
        .select('id, supplier_name, supplier_id, total_amount, paid_amount, status, created_at')
        .eq('business_id', business.id)
        .eq('payment_method', 'credit');

      if (!isAdmin && currentBranch) {
        query = query.eq('branch_id', currentBranch.id);
      }

      const { data: creditPurchasesData, error: purchError } = await query;

      if (purchError) {
        console.error('Payables query error:', purchError.message);
        Alert.alert('Error', purchError.message);
        setLoadingPayables(false);
        return;
      }

      if (!creditPurchasesData || creditPurchasesData.length === 0) {
        setSuppliers([]);
        setLoadingPayables(false);
        return;
      }

      // Get supplier payments
      const purchaseIds = creditPurchasesData.map(p => p.id);
      const { data: paymentsData } = await supabase
        .from('supplier_payments')
        .select('purchase_id, amount')
        .in('purchase_id', purchaseIds);

      // Aggregate payments per purchase
      const paymentsByPurchase: Record<string, number> = {};
      paymentsData?.forEach(p => {
        paymentsByPurchase[p.purchase_id] = (paymentsByPurchase[p.purchase_id] || 0) + Number(p.amount);
      });

      // Aggregate per supplier
      const supplierMap: Record<string, PayableSupplier> = {};
      creditPurchasesData.forEach(purchase => {
        const suppKey = purchase.supplier_id || `name:${purchase.supplier_name || 'Unknown Supplier'}`;
        if (!supplierMap[suppKey]) {
          supplierMap[suppKey] = {
            id: suppKey,
            name: purchase.supplier_name || 'Unknown Supplier',
            totalOwed: 0,
            totalPaid: 0,
            balance: 0,
            purchaseCount: 0,
          };
        }
        const paidFromPayments = paymentsByPurchase[purchase.id] || 0;
        const paidFromRecord = Number(purchase.paid_amount) || 0;
        const actualPaid = Math.max(paidFromPayments, paidFromRecord);
        supplierMap[suppKey].totalOwed += Number(purchase.total_amount);
        supplierMap[suppKey].totalPaid += actualPaid;
        supplierMap[suppKey].purchaseCount += 1;
      });

      // Compute balances
      Object.values(supplierMap).forEach(s => {
        s.balance = s.totalOwed - s.totalPaid;
      });

      const sorted = Object.values(supplierMap)
        .filter(s => s.balance > 0)
        .sort((a, b) => b.balance - a.balance);

      setSuppliers(sorted);
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setLoadingPayables(false);
    }
  }, [business, currentBranch, isAdmin]);

  // Open supplier detail (show their credit purchases)
  const openSupplierDetail = async (supplier: PayableSupplier) => {
    setSelectedSupplier(supplier);
    setLoadingSupplierDetail(true);

    try {
      let query = supabase
        .from('purchases')
        .select('id, total_amount, paid_amount, created_at')
        .eq('business_id', business!.id)
        .eq('payment_method', 'credit')
        .order('created_at', { ascending: false });

      if (supplier.id.startsWith('name:')) {
        const suppName = supplier.id.replace('name:', '');
        query = query.is('supplier_id', null).eq('supplier_name', suppName);
      } else {
        query = query.eq('supplier_id', supplier.id);
      }

      if (!isAdmin && currentBranch) {
        query = query.eq('branch_id', currentBranch.id);
      }

      const { data: purchases } = await query;

      if (purchases) {
        const purchaseIds = purchases.map(p => p.id);
        const { data: payments } = await supabase
          .from('supplier_payments')
          .select('purchase_id, amount')
          .in('purchase_id', purchaseIds);

        const paymentsByPurchase: Record<string, number> = {};
        payments?.forEach(p => {
          paymentsByPurchase[p.purchase_id] = (paymentsByPurchase[p.purchase_id] || 0) + Number(p.amount);
        });

        const enriched: CreditPurchase[] = purchases.map(p => {
          const paidFromPayments = paymentsByPurchase[p.id] || 0;
          const paidFromRecord = Number(p.paid_amount) || 0;
          const actualPaid = Math.max(paidFromPayments, paidFromRecord);
          return {
            id: p.id,
            total_amount: Number(p.total_amount),
            created_at: p.created_at,
            paid: actualPaid,
            balance: Number(p.total_amount) - actualPaid,
          };
        });

        setCreditPurchases(enriched);
      }
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setLoadingSupplierDetail(false);
    }
  };

  // Record payment to supplier
  const openSupplierPaymentModal = (purchase: CreditPurchase) => {
    setPayingPurchase(purchase);
    setSupplierPayAmount(purchase.balance.toString());
    setSupplierPayMethod('cash');
    setSupplierPayNote('');
    setShowSupplierPayment(true);
  };

  const handleRecordSupplierPayment = async () => {
    if (!payingPurchase || !business || !profile) return;
    const amount = parseFloat(supplierPayAmount);
    if (!amount || amount <= 0) {
      Alert.alert('Error', 'Enter a valid payment amount');
      return;
    }
    if (amount > payingPurchase.balance) {
      Alert.alert('Error', `Amount exceeds outstanding balance of ${fmt(payingPurchase.balance)}`);
      return;
    }

    setSavingSupplierPay(true);
    try {
      // Insert supplier payment record
      const { error } = await supabase
        .from('supplier_payments')
        .insert({
          business_id: business.id,
          purchase_id: payingPurchase.id,
          supplier_id: selectedSupplier && !selectedSupplier.id.startsWith('name:') ? selectedSupplier.id : null,
          supplier_name: selectedSupplier?.name || 'Unknown',
          amount,
          payment_method: supplierPayMethod,
          note: supplierPayNote.trim() || null,
          paid_by: profile.id,
        });

      if (error) throw error;

      // Update purchase paid_amount and status
      const newPaid = payingPurchase.paid + amount;
      const newStatus = newPaid >= payingPurchase.total_amount ? 'paid' : 'partial';
      await supabase
        .from('purchases')
        .update({ paid_amount: newPaid, status: newStatus })
        .eq('id', payingPurchase.id);

      // Post accounting entry: DR Accounts Payable, CR Cash/MoMo/Bank
      await postSupplierPaymentEntry({
        businessId: business.id,
        branchId: currentBranch?.id || null,
        paymentId: payingPurchase.id,
        amount,
        supplierName: selectedSupplier?.name || 'Supplier',
        paymentMethod: supplierPayMethod,
        userId: profile.id,
      });

      Alert.alert('Success', `Payment of ${fmt(amount)} to supplier recorded`);
      setShowSupplierPayment(false);

      // Refresh
      if (selectedSupplier) {
        await openSupplierDetail(selectedSupplier);
      }
      await loadPayables();
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setSavingSupplierPay(false);
    }
  };

  // View supplier payment history for a purchase
  const viewSupplierPaymentHistory = async (purchaseId: string) => {
    setSupplierHistoryPurchaseId(purchaseId);
    const { data } = await supabase
      .from('supplier_payments')
      .select('id, amount, payment_method, note, created_at')
      .eq('purchase_id', purchaseId)
      .order('created_at', { ascending: false });

    setSupplierHistoryPayments(data || []);
    setShowSupplierHistory(true);
  };

  const openCustomerDetail = async (customer: DebtCustomer) => {
    setSelectedCustomer(customer);
    setLoadingDetail(true);
    setStatementView(false); // Default to history

    try {
      let query = supabase
        .from('sales')
        .select('id, total_amount, created_at, status')
        .eq('business_id', business!.id)
        .eq('payment_method', 'credit')
        .eq('status', 'completed')
        .order('created_at', { ascending: false });

      if (customer.id.startsWith('name:')) {
        const custName = customer.id.replace('name:', '');
        query = query.is('customer_id', null).eq('customer_name', custName);
      } else {
        query = query.eq('customer_id', customer.id);
      }

      if (!isAdmin && currentBranch) {
        query = query.eq('branch_id', currentBranch.id);
      }

      const { data: sales } = await query;

      if (sales && sales.length > 0) {
        const saleIds = sales.map(s => s.id);
        
        const [{ data: itemData }, { data: payments }] = await Promise.all([
          supabase.from('sale_items').select('sale_id, product_name, quantity').in('sale_id', saleIds),
          supabase.from('debt_payments').select('sale_id, amount').in('sale_id', saleIds)
        ]);

        const itemsBySale: Record<string, string> = {};
        itemData?.forEach(it => {
          const summary = `${it.quantity}x ${it.product_name}`;
          itemsBySale[it.sale_id] = itemsBySale[it.sale_id] ? `${itemsBySale[it.sale_id]}, ${summary}` : summary;
        });

        const paymentsBySale: Record<string, number> = {};
        payments?.forEach(p => {
          paymentsBySale[p.sale_id] = (paymentsBySale[p.sale_id] || 0) + Number(p.amount);
        });

        const enriched: CreditSale[] = sales.map(s => {
          const paid = paymentsBySale[s.id] || 0;
          return {
            id: s.id,
            total_amount: Number(s.total_amount),
            created_at: s.created_at,
            paid,
            balance: Number(s.total_amount) - paid,
            status: s.status,
            items: itemsBySale[s.id] || 'Items not found',
          };
        });

        setCreditSales(enriched);
      } else {
        setCreditSales([]);
      }
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setLoadingDetail(false);
    }
  };

  const loadStatement = async () => {
    if (!selectedCustomer || !business) return;
    setLoadingStatement(true);
    try {
      const isWalkin = selectedCustomer.id.startsWith('name:');
      const startISO = startDate.toISOString();
      const endISO = endDate.toISOString();

      // Opening Balance
      let salesBeforeQuery = supabase.from('sales').select('total_amount').eq('business_id', business.id).eq('payment_method', 'credit').eq('status', 'completed').lt('created_at', startISO);
      let payBeforeQuery = supabase.from('debt_payments').select('amount').eq('business_id', business.id).lt('created_at', startISO);

      if (isWalkin) {
        salesBeforeQuery = salesBeforeQuery.is('customer_id', null).eq('customer_name', selectedCustomer.id.replace('name:', ''));
        payBeforeQuery = payBeforeQuery.is('customer_id', null);
      } else {
        salesBeforeQuery = salesBeforeQuery.eq('customer_id', selectedCustomer.id);
        payBeforeQuery = payBeforeQuery.eq('customer_id', selectedCustomer.id);
      }

      const [{ data: oldSales }, { data: oldPays }] = await Promise.all([salesBeforeQuery, payBeforeQuery]);
      const openBal = (oldSales || []).reduce((s, x) => s + Number(x.total_amount), 0) - (oldPays || []).reduce((s, x) => s + Number(x.amount), 0);
      setOpeningBalance(openBal);

      // Period Transactions
      let salesPeriodQuery = supabase.from('sales').select('id, total_amount, created_at, sale_items(product_name, quantity)').eq('business_id', business.id).eq('payment_method', 'credit').eq('status', 'completed').gte('created_at', startISO).lte('created_at', endISO);
      let payPeriodQuery = supabase.from('debt_payments').select('id, amount, created_at, note').eq('business_id', business.id).gte('created_at', startISO).lte('created_at', endISO);

      if (isWalkin) {
        salesPeriodQuery = salesPeriodQuery.is('customer_id', null).eq('customer_name', selectedCustomer.id.replace('name:', ''));
        payPeriodQuery = payPeriodQuery.is('customer_id', null);
      } else {
        salesPeriodQuery = salesPeriodQuery.eq('customer_id', selectedCustomer.id);
        payPeriodQuery = payPeriodQuery.eq('customer_id', selectedCustomer.id);
      }

      const [{ data: periodSales }, { data: periodPays }] = await Promise.all([salesPeriodQuery, payPeriodQuery]);

      const ledger: StatementEntry[] = [
        ...(periodSales || []).map(s => ({
          date: s.created_at,
          type: 'sale' as const,
          description: `Credit Sale #${s.id.slice(0, 8)}`,
          debit: Number(s.total_amount),
          credit: 0,
          balance: 0,
          items: (s.sale_items as any[] || []).map(i => `${i.quantity}x ${i.product_name}`).join(', '),
        })),
        ...(periodPays || []).map(p => ({
          date: p.created_at,
          type: 'payment' as const,
          description: p.note ? `Payment: ${p.note}` : 'Debt Payment',
          debit: 0,
          credit: Number(p.amount),
          balance: 0,
        }))
      ].sort((a, b) => a.date.localeCompare(b.date));

      let current = openBal;
      ledger.forEach(entry => {
        current = current + entry.debit - entry.credit;
        entry.balance = current;
      });

      setStatementLedger(ledger);
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setLoadingStatement(false);
    }
  };

  const handlePrintStatement = async (share = false) => {
    if (!selectedCustomer || !business) return;
    const data: StatementData = {
      businessName: business.name,
      businessTin: business.tin,
      businessPhone: business.phone,
      businessAddress: business.address,
      customerName: selectedCustomer.name,
      customerPhone: selectedCustomer.phone,
      startDate: startDate.toLocaleDateString(),
      endDate: endDate.toLocaleDateString(),
      openingBalance: openingBalance,
      entries: statementLedger,
      closingBalance: statementLedger.length > 0 ? statementLedger[statementLedger.length - 1].balance : openingBalance,
      currencySymbol: 'UGX',
    };
    if (share) await shareStatementPdf(data);
    else await printStatement(data);
  };

  // Record a payment
  const openPaymentModal = (sale: CreditSale) => {
    setPayingSale(sale);
    setPayAmount(sale.balance.toString());
    setPayMethod('cash');
    setPayNote('');
    setShowPayment(true);
  };

  const handleRecordPayment = async () => {
    if (!payingSale || !business || !profile) return;
    const amount = parseFloat(payAmount);
    if (!amount || amount <= 0) {
      Alert.alert('Error', 'Enter a valid payment amount');
      return;
    }
    if (amount > payingSale.balance) {
      Alert.alert('Error', `Amount exceeds outstanding balance of ${fmt(payingSale.balance)}`);
      return;
    }

    setSaving(true);
    try {
      // Insert debt payment record
      const isWalkin = selectedCustomer!.id.startsWith('name:');
      if (isWalkin) {
        // Walk-in credit sales can't have debt_payments (no customer record)
        // Just update the sale directly
        Alert.alert('Note', 'Walk-in credit sale — payment noted but no customer record linked.');
      }

      const { error } = await supabase
        .from('debt_payments')
        .insert({
          business_id: business.id,
          sale_id: payingSale.id,
          customer_id: isWalkin ? undefined : selectedCustomer!.id,
          amount,
          payment_method: payMethod,
          note: payNote.trim() || null,
          received_by: profile.id,
        });

      if (error) throw error;

      if (error) throw error;
      
      // Post accounting entry via helper
      await postCustomerPaymentEntry({
        businessId: business.id,
        branchId: currentBranch?.id || null,
        paymentId: payingSale.id, // Linking to the sale for reference
        amount,
        customerName: selectedCustomer!.name,
        paymentMethod: payMethod,
        userId: profile.id,
      });

      Alert.alert('Success', `Payment of ${fmt(amount)} recorded`);
      setShowPayment(false);

      // Refresh
      if (selectedCustomer) {
        await openCustomerDetail(selectedCustomer);
      }
      await loadDebts();
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setSaving(false);
    }
  };

  // View payment history for a sale
  const viewPaymentHistory = async (saleId: string) => {
    setHistorySaleId(saleId);
    const { data } = await supabase
      .from('debt_payments')
      .select('id, amount, payment_method, note, created_at')
      .eq('sale_id', saleId)
      .order('created_at', { ascending: false });

    setHistoryPayments(data || []);
    setShowHistory(true);
  };

  const totalOutstanding = customers.reduce((sum, c) => sum + c.balance, 0);
  const totalPayables = suppliers.reduce((sum, s) => sum + s.balance, 0);

  const filtered = searchQuery.trim()
    ? customers.filter(c =>
        c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (c.phone && c.phone.includes(searchQuery))
      )
    : customers;

  const filteredSuppliers = searchQuery.trim()
    ? suppliers.filter(s => s.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : suppliers;

  const formatDate = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const formatTime = (d: string) => new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

  const payMethodLabel = (m: string) => {
    const found = PAYMENT_METHODS.find(p => p.value === m);
    return found ? found.label : m;
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#e94560" style={{ marginTop: 60 }} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Tab Toggle */}
      <View style={styles.tabRow}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'receivables' && styles.tabActive]}
          onPress={() => setActiveTab('receivables')}
        >
          <FontAwesome name="arrow-down" size={14} color={activeTab === 'receivables' ? '#fff' : '#aaa'} />
          <Text style={[styles.tabText, activeTab === 'receivables' && styles.tabTextActive]}>
            Receivables
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'payables' && styles.tabActivePayable]}
          onPress={() => { setActiveTab('payables'); if (suppliers.length === 0 && !loadingPayables) loadPayables(); }}
        >
          <FontAwesome name="arrow-up" size={14} color={activeTab === 'payables' ? '#fff' : '#aaa'} />
          <Text style={[styles.tabText, activeTab === 'payables' && styles.tabTextActive]}>
            Payables
          </Text>
        </TouchableOpacity>
      </View>

      {activeTab === 'receivables' ? (
        <>
          {/* Summary Card */}
          <View style={styles.summaryCard}>
            <View style={styles.summaryRow}>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryValue}>{fmt(totalOutstanding)}</Text>
                <Text style={styles.summaryLabel}>Owed to You</Text>
              </View>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryValue}>{customers.length}</Text>
                <Text style={styles.summaryLabel}>Debtors</Text>
              </View>
            </View>
          </View>

          {/* Search */}
          <View style={styles.searchRow}>
            <TextInput
              style={styles.searchInput}
              placeholder="Search debtors..."
              placeholderTextColor="#666"
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
          </View>

          {/* Debtor List */}
          <FlatList
            data={filtered}
            keyExtractor={(item) => item.id}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#e94560" />}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.card} onPress={() => openCustomerDetail(item)}>
                <View style={styles.cardHeader}>
                  <View style={styles.cardInfo}>
                    <Text style={styles.cardName}>{item.name}</Text>
                    {item.phone ? <Text style={styles.cardSub}>{'\u{1F4F1}'} {item.phone}</Text> : null}
                    <Text style={styles.cardSub}>
                      {item.salesCount} credit sale{item.salesCount !== 1 ? 's' : ''}
                    </Text>
                  </View>
                  <View style={styles.cardRight}>
                    <Text style={styles.debtAmount}>{fmt(item.balance)}</Text>
                    <Text style={styles.debtLabel}>owes</Text>
                  </View>
                </View>
                {item.totalPaid > 0 && (
                  <View style={styles.progressBar}>
                    <View style={[styles.progressFill, { width: `${Math.min(100, (item.totalPaid / item.totalDebt) * 100)}%` }]} />
                  </View>
                )}
              </TouchableOpacity>
            )}
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <FontAwesome name="check-circle" size={48} color="#4CAF50" />
                <Text style={styles.emptyText}>No outstanding debts!</Text>
                <Text style={styles.emptyHint}>Credit sales will appear here</Text>
              </View>
            }
          />
        </>
      ) : (
        <>
          {/* Payables Summary */}
          <View style={[styles.summaryCard, { borderColor: '#FF9800' }]}>
            <View style={styles.summaryRow}>
              <View style={styles.summaryItem}>
                <Text style={[styles.summaryValue, { color: '#FF9800' }]}>{fmt(totalPayables)}</Text>
                <Text style={styles.summaryLabel}>You Owe</Text>
              </View>
              <View style={styles.summaryItem}>
                <Text style={[styles.summaryValue, { color: '#FF9800' }]}>{suppliers.length}</Text>
                <Text style={styles.summaryLabel}>Creditors</Text>
              </View>
            </View>
          </View>

          {/* Search */}
          <View style={styles.searchRow}>
            <TextInput
              style={styles.searchInput}
              placeholder="Search suppliers..."
              placeholderTextColor="#666"
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
          </View>

          {loadingPayables ? (
            <ActivityIndicator size="large" color="#FF9800" style={{ marginTop: 40 }} />
          ) : (
            <FlatList
              data={filteredSuppliers}
              keyExtractor={(item) => item.id}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FF9800" />}
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.card} onPress={() => openSupplierDetail(item)}>
                  <View style={styles.cardHeader}>
                    <View style={styles.cardInfo}>
                      <Text style={styles.cardName}>{item.name}</Text>
                      <Text style={styles.cardSub}>
                        {item.purchaseCount} credit purchase{item.purchaseCount !== 1 ? 's' : ''}
                      </Text>
                    </View>
                    <View style={styles.cardRight}>
                      <Text style={[styles.debtAmount, { color: '#FF9800' }]}>{fmt(item.balance)}</Text>
                      <Text style={styles.debtLabel}>you owe</Text>
                    </View>
                  </View>
                  {item.totalPaid > 0 && (
                    <View style={styles.progressBar}>
                      <View style={[styles.progressFill, { width: `${Math.min(100, (item.totalPaid / item.totalOwed) * 100)}%` }]} />
                    </View>
                  )}
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <View style={styles.emptyState}>
                  <FontAwesome name="check-circle" size={48} color="#4CAF50" />
                  <Text style={styles.emptyText}>No outstanding payables!</Text>
                  <Text style={styles.emptyHint}>Credit purchases will appear here</Text>
                </View>
              }
            />
          )}
        </>
      )}

      {/* Customer Detail Modal */}
      <Modal visible={!!selectedCustomer} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{selectedCustomer?.name}</Text>
              <TouchableOpacity onPress={() => { setSelectedCustomer(null); setCreditSales([]); }}>
                <FontAwesome name="times" size={22} color="#aaa" />
              </TouchableOpacity>
            </View>

            {/* Mode Toggle */}
            <View style={[styles.tabRow, { marginBottom: 16 }]}>
              <TouchableOpacity
                style={[styles.tab, !statementView && styles.tabActive]}
                onPress={() => setStatementView(false)}
              >
                <Text style={[styles.tabText, !statementView && styles.tabTextActive]}>History</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.tab, statementView && styles.tabActive]}
                onPress={() => {
                  setStatementView(true);
                  if (statementLedger.length === 0) loadStatement();
                }}
              >
                <Text style={[styles.tabText, statementView && styles.tabTextActive]}>Statement</Text>
              </TouchableOpacity>
            </View>

            {!statementView ? (
              <>
                {selectedCustomer && (
                  <View style={styles.detailSummary}>
                    <View style={styles.detailSummaryItem}>
                      <Text style={styles.detailSummaryVal}>{fmt(selectedCustomer.totalDebt)}</Text>
                      <Text style={styles.detailSummaryLabel}>Total Debt</Text>
                    </View>
                    <View style={styles.detailSummaryItem}>
                      <Text style={[styles.detailSummaryVal, { color: '#4CAF50' }]}>{fmt(selectedCustomer.totalPaid)}</Text>
                      <Text style={styles.detailSummaryLabel}>Total Paid</Text>
                    </View>
                    <View style={styles.detailSummaryItem}>
                      <Text style={[styles.detailSummaryVal, { color: '#e94560' }]}>{fmt(selectedCustomer.balance)}</Text>
                      <Text style={styles.detailSummaryLabel}>Balance</Text>
                    </View>
                  </View>
                )}

                {loadingDetail ? (
                  <ActivityIndicator size="large" color="#e94560" style={{ marginTop: 20 }} />
                ) : (
                  <FlatList
                    data={creditSales}
                    keyExtractor={(item) => item.id}
                    style={{ maxHeight: 400 }}
                    renderItem={({ item }) => (
                      <View style={styles.saleCard}>
                        <View style={styles.saleCardHeader}>
                          <View style={{ backgroundColor: 'transparent', flex: 1 }}>
                            <Text style={styles.saleCardDate}>{formatDate(item.created_at)}</Text>
                            <Text style={styles.saleCardAmount}>Sale: {fmt(item.total_amount)}</Text>
                            <Text style={styles.itemTakenText}>Taken: {item.items}</Text>
                            <Text style={[styles.saleCardPaid, { color: item.balance > 0 ? '#e94560' : '#4CAF50', marginTop: 4 }]}>
                               Paid: {fmt(item.paid)} · Bal: {fmt(item.balance)}
                            </Text>
                          </View>
                          <View style={{ backgroundColor: 'transparent', gap: 6 }}>
                            {item.balance > 0 && (
                              <TouchableOpacity style={styles.payBtn} onPress={() => openPaymentModal(item)}>
                                <FontAwesome name="money" size={14} color="#fff" />
                                <Text style={styles.payBtnText}>Pay</Text>
                              </TouchableOpacity>
                            )}
                            <TouchableOpacity style={styles.historyBtn} onPress={() => viewPaymentHistory(item.id)}>
                              <FontAwesome name="history" size={12} color="#aaa" />
                            </TouchableOpacity>
                          </View>
                        </View>
                        {item.paid > 0 && (
                          <View style={styles.progressBar}>
                            <View style={[styles.progressFill, { width: `${Math.min(100, (item.paid / item.total_amount) * 100)}%` }]} />
                          </View>
                        )}
                      </View>
                    )}
                    ListEmptyComponent={
                      <Text style={{ color: '#666', textAlign: 'center', marginTop: 20 }}>No credit sales found</Text>
                    }
                  />
                )}
              </>
            ) : (
              <View style={{ flex: 1 }}>
                {/* Statement Controls */}
                <View style={styles.statementControls}>
                  <View style={{ flexDirection: 'row', gap: 10, flex: 1, backgroundColor: 'transparent' }}>
                    <TouchableOpacity style={styles.dateSelector} onPress={() => setShowStartPicker(true)}>
                      <Text style={styles.dateSelectorLabel}>From</Text>
                      <Text style={styles.dateSelectorVal}>{startDate.toLocaleDateString()}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.dateSelector} onPress={() => setShowEndPicker(true)}>
                      <Text style={styles.dateSelectorLabel}>To</Text>
                      <Text style={styles.dateSelectorVal}>{endDate.toLocaleDateString()}</Text>
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity style={styles.refreshBtn} onPress={loadStatement}>
                    <FontAwesome name="refresh" size={18} color="#fff" />
                  </TouchableOpacity>
                </View>

                {showStartPicker && (
                  <DateTimePicker
                    value={startDate}
                    mode="date"
                    onChange={(event, date) => {
                      setShowStartPicker(false);
                      if (date) setStartDate(date);
                    }}
                  />
                )}
                {showEndPicker && (
                  <DateTimePicker
                    value={endDate}
                    mode="date"
                    onChange={(event, date) => {
                      setShowEndPicker(false);
                      if (date) setEndDate(date);
                    }}
                  />
                )}

                {loadingStatement ? (
                  <ActivityIndicator size="large" color="#e94560" style={{ marginTop: 20 }} />
                ) : (
                  <>
                    <View style={styles.openingBalCard}>
                      <Text style={styles.openingBalLabel}>Opening Balance</Text>
                      <Text style={styles.openingBalVal}>{fmt(openingBalance)}</Text>
                    </View>

                    <FlatList
                      data={statementLedger}
                      keyExtractor={(item, index) => index.toString()}
                      style={{ flex: 1 }}
                      renderItem={({ item }) => (
                        <View style={styles.ledgerRow}>
                          <View style={{ flex: 1, backgroundColor: 'transparent' }}>
                            <Text style={styles.ledgerDate}>{formatDate(item.date)}</Text>
                            <Text style={styles.ledgerDesc}>{item.description}</Text>
                            {item.items && <Text style={styles.ledgerItems}>{item.items}</Text>}
                          </View>
                          <View style={{ alignItems: 'flex-end', backgroundColor: 'transparent' }}>
                            <Text style={[styles.ledgerAmt, { color: item.debit > 0 ? '#e94560' : '#4CAF50' }]}>
                              {item.debit > 0 ? `+${fmt(item.debit)}` : `-${fmt(item.credit)}`}
                            </Text>
                            <Text style={styles.ledgerBal}>Bal: {fmt(item.balance)}</Text>
                          </View>
                        </View>
                      )}
                      ListEmptyComponent={<Text style={styles.emptyText}>No transactions in this period</Text>}
                    />

                    <View style={styles.statementActions}>
                      <TouchableOpacity style={[styles.actionBtn, {backgroundColor: '#533483'}]} onPress={() => handlePrintStatement(true)}>
                        <FontAwesome name="share" size={16} color="#fff" />
                        <Text style={styles.actionBtnText}>Share PDF</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.actionBtn} onPress={() => handlePrintStatement(false)}>
                        <FontAwesome name="print" size={16} color="#fff" />
                        <Text style={styles.actionBtnText}>Print Statement</Text>
                      </TouchableOpacity>
                    </View>
                  </>
                )}
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* Record Payment Modal */}
      <Modal visible={showPayment} animationType="slide" transparent>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <ScrollView>
              <Text style={styles.modalTitle}>Record Payment</Text>
              {payingSale && (
                <Text style={styles.payInfo}>
                  Sale balance: {fmt(payingSale.balance)}
                </Text>
              )}

              <Text style={styles.label}>Amount *</Text>
              <TextInput
                style={styles.input}
                placeholder="Payment amount"
                placeholderTextColor="#555"
                value={payAmount}
                onChangeText={setPayAmount}
                keyboardType="numeric"
              />

              <Text style={styles.label}>Payment Method</Text>
              <ScrollView 
                horizontal 
                showsHorizontalScrollIndicator={false}
                style={{ backgroundColor: 'transparent' }}
                contentContainerStyle={{ gap: 8 }}
              >
                {PAYMENT_METHODS.filter(m => m.value !== 'credit').map((m) => (
                  <TouchableOpacity
                    key={m.value}
                    style={[styles.chip, payMethod === m.value && styles.chipActive, { minWidth: 80, alignItems: 'center' }]}
                    onPress={() => setPayMethod(m.value)}
                  >
                    <Text style={[styles.chipText, payMethod === m.value && { color: '#fff' }]}>
                      {m.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <Text style={styles.label}>Note (optional)</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. Partial payment"
                placeholderTextColor="#555"
                value={payNote}
                onChangeText={setPayNote}
              />

              <TouchableOpacity
                style={[styles.saveBtn, saving && { opacity: 0.6 }]}
                onPress={handleRecordPayment}
                disabled={saving}
              >
                {saving ? <ActivityIndicator color="#fff" /> : (
                  <Text style={styles.saveBtnText}>Record Payment</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowPayment(false)}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Payment History Modal */}
      <Modal visible={showHistory} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Payment History</Text>
              <TouchableOpacity onPress={() => setShowHistory(false)}>
                <FontAwesome name="times" size={22} color="#aaa" />
              </TouchableOpacity>
            </View>

            <FlatList
              data={historyPayments}
              keyExtractor={(item) => item.id}
              style={{ maxHeight: 400 }}
              renderItem={({ item }) => (
                <View style={styles.historyCard}>
                  <View style={{ backgroundColor: 'transparent', flex: 1 }}>
                    <Text style={{ color: '#4CAF50', fontSize: 16, fontWeight: 'bold' }}>{fmt(Number(item.amount))}</Text>
                    <Text style={{ color: '#aaa', fontSize: 12, marginTop: 2 }}>
                      {payMethodLabel(item.payment_method)} · {formatTime(item.created_at)}
                    </Text>
                    {item.note ? <Text style={{ color: '#888', fontSize: 12, marginTop: 2 }}>{item.note}</Text> : null}
                  </View>
                </View>
              )}
              ListEmptyComponent={
                <Text style={{ color: '#666', textAlign: 'center', marginTop: 20 }}>No payments recorded yet</Text>
              }
            />
          </View>
        </View>
      </Modal>

      {/* ═══ SUPPLIER DETAIL MODAL ═══ */}
      <Modal visible={!!selectedSupplier} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{selectedSupplier?.name}</Text>
              <TouchableOpacity onPress={() => { setSelectedSupplier(null); setCreditPurchases([]); }}>
                <FontAwesome name="times" size={22} color="#aaa" />
              </TouchableOpacity>
            </View>

            {selectedSupplier && (
              <View style={styles.detailSummary}>
                <View style={styles.detailSummaryItem}>
                  <Text style={styles.detailSummaryVal}>{fmt(selectedSupplier.totalOwed)}</Text>
                  <Text style={styles.detailSummaryLabel}>Total Owed</Text>
                </View>
                <View style={styles.detailSummaryItem}>
                  <Text style={[styles.detailSummaryVal, { color: '#4CAF50' }]}>{fmt(selectedSupplier.totalPaid)}</Text>
                  <Text style={styles.detailSummaryLabel}>Paid</Text>
                </View>
                <View style={styles.detailSummaryItem}>
                  <Text style={[styles.detailSummaryVal, { color: '#FF9800' }]}>{fmt(selectedSupplier.balance)}</Text>
                  <Text style={styles.detailSummaryLabel}>Balance</Text>
                </View>
              </View>
            )}

            {loadingSupplierDetail ? (
              <ActivityIndicator size="large" color="#FF9800" style={{ marginTop: 20 }} />
            ) : (
              <FlatList
                data={creditPurchases}
                keyExtractor={(item) => item.id}
                style={{ maxHeight: 400 }}
                renderItem={({ item }) => (
                  <View style={styles.saleCard}>
                    <View style={styles.saleCardHeader}>
                      <View style={{ backgroundColor: 'transparent', flex: 1 }}>
                        <Text style={styles.saleCardDate}>{formatDate(item.created_at)}</Text>
                        <Text style={styles.saleCardAmount}>Purchase: {fmt(item.total_amount)}</Text>
                        <Text style={[styles.saleCardPaid, { color: item.balance > 0 ? '#FF9800' : '#4CAF50' }]}>
                          Paid: {fmt(item.paid)} · Balance: {fmt(item.balance)}
                        </Text>
                      </View>
                      <View style={{ backgroundColor: 'transparent', gap: 6 }}>
                        {item.balance > 0 && (
                          <TouchableOpacity style={[styles.payBtn, { backgroundColor: '#FF9800' }]} onPress={() => openSupplierPaymentModal(item)}>
                            <FontAwesome name="money" size={14} color="#fff" />
                            <Text style={styles.payBtnText}>Pay</Text>
                          </TouchableOpacity>
                        )}
                        <TouchableOpacity style={styles.historyBtn} onPress={() => viewSupplierPaymentHistory(item.id)}>
                          <FontAwesome name="history" size={12} color="#aaa" />
                        </TouchableOpacity>
                      </View>
                    </View>
                    {item.paid > 0 && (
                      <View style={styles.progressBar}>
                        <View style={[styles.progressFill, { width: `${Math.min(100, (item.paid / item.total_amount) * 100)}%` }]} />
                      </View>
                    )}
                  </View>
                )}
                ListEmptyComponent={
                  <Text style={{ color: '#666', textAlign: 'center', marginTop: 20 }}>No credit purchases found</Text>
                }
              />
            )}
          </View>
        </View>
      </Modal>

      {/* ═══ SUPPLIER PAYMENT MODAL ═══ */}
      <Modal visible={showSupplierPayment} animationType="slide" transparent>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <ScrollView>
              <Text style={styles.modalTitle}>Pay Supplier</Text>
              {payingPurchase && (
                <Text style={styles.payInfo}>
                  Purchase balance: {fmt(payingPurchase.balance)}
                </Text>
              )}

              <Text style={styles.label}>Amount *</Text>
              <TextInput
                style={styles.input}
                placeholder="Payment amount"
                placeholderTextColor="#555"
                value={supplierPayAmount}
                onChangeText={setSupplierPayAmount}
                keyboardType="numeric"
              />

              <Text style={styles.label}>Payment Method</Text>
              <ScrollView 
                horizontal 
                showsHorizontalScrollIndicator={false}
                style={{ backgroundColor: 'transparent' }}
                contentContainerStyle={{ gap: 8 }}
              >
                {PAYMENT_METHODS.filter(m => m.value !== 'credit').map((m) => (
                  <TouchableOpacity
                    key={m.value}
                    style={[styles.chip, supplierPayMethod === m.value && styles.chipActive, { minWidth: 80, alignItems: 'center' }]}
                    onPress={() => setSupplierPayMethod(m.value)}
                  >
                    <Text style={[styles.chipText, supplierPayMethod === m.value && { color: '#fff' }]}>
                      {m.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <Text style={styles.label}>Note (optional)</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. Partial payment"
                placeholderTextColor="#555"
                value={supplierPayNote}
                onChangeText={setSupplierPayNote}
              />

              <TouchableOpacity
                style={[styles.saveBtn, { backgroundColor: '#FF9800' }, savingSupplierPay && { opacity: 0.6 }]}
                onPress={handleRecordSupplierPayment}
                disabled={savingSupplierPay}
              >
                {savingSupplierPay ? <ActivityIndicator color="#fff" /> : (
                  <Text style={styles.saveBtnText}>Record Payment</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowSupplierPayment(false)}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ═══ SUPPLIER PAYMENT HISTORY MODAL ═══ */}
      <Modal visible={showSupplierHistory} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Payment History</Text>
              <TouchableOpacity onPress={() => setShowSupplierHistory(false)}>
                <FontAwesome name="times" size={22} color="#aaa" />
              </TouchableOpacity>
            </View>

            <FlatList
              data={supplierHistoryPayments}
              keyExtractor={(item) => item.id}
              style={{ maxHeight: 400 }}
              renderItem={({ item }) => (
                <View style={styles.historyCard}>
                  <View style={{ backgroundColor: 'transparent', flex: 1 }}>
                    <Text style={{ color: '#FF9800', fontSize: 16, fontWeight: 'bold' }}>{fmt(Number(item.amount))}</Text>
                    <Text style={{ color: '#aaa', fontSize: 12, marginTop: 2 }}>
                      {payMethodLabel(item.payment_method)} · {formatTime(item.created_at)}
                    </Text>
                    {item.note ? <Text style={{ color: '#888', fontSize: 12, marginTop: 2 }}>{item.note}</Text> : null}
                  </View>
                </View>
              )}
              ListEmptyComponent={
                <Text style={{ color: '#666', textAlign: 'center', marginTop: 20 }}>No payments recorded yet</Text>
              }
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  tabRow: {
    flexDirection: 'row', marginHorizontal: 16, marginTop: 12, marginBottom: 4,
    backgroundColor: '#16213e', borderRadius: 12, padding: 4,
  },
  tab: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 10, borderRadius: 10,
  },
  tabActive: { backgroundColor: '#e94560' },
  tabActivePayable: { backgroundColor: '#FF9800' },
  tabText: { fontSize: 14, color: '#aaa', fontWeight: '600' },
  tabTextActive: { color: '#fff' },
  summaryCard: {
    backgroundColor: '#16213e', margin: 16, borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: '#0f3460',
  },
  summaryRow: {
    flexDirection: 'row', justifyContent: 'space-around', backgroundColor: 'transparent',
  },
  summaryItem: { alignItems: 'center', backgroundColor: 'transparent' },
  summaryValue: { fontSize: 22, fontWeight: 'bold', color: '#e94560' },
  summaryLabel: { fontSize: 12, color: '#aaa', marginTop: 4 },
  searchRow: {
    paddingHorizontal: 16, paddingBottom: 8, backgroundColor: 'transparent',
  },
  searchInput: {
    backgroundColor: '#16213e', borderRadius: 10, padding: 12,
    color: '#fff', fontSize: 15, borderWidth: 1, borderColor: '#0f3460',
  },
  card: {
    backgroundColor: '#16213e', marginHorizontal: 16, marginBottom: 10,
    borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#0f3460',
  },
  cardHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: 'transparent',
  },
  cardInfo: { flex: 1, backgroundColor: 'transparent' },
  cardRight: { alignItems: 'flex-end', backgroundColor: 'transparent' },
  cardName: { fontSize: 16, fontWeight: 'bold', color: '#fff' },
  cardSub: { fontSize: 13, color: '#aaa', marginTop: 2 },
  debtAmount: { fontSize: 18, fontWeight: 'bold', color: '#e94560' },
  debtLabel: { fontSize: 12, color: '#aaa' },
  progressBar: {
    height: 4, backgroundColor: '#0f3460', borderRadius: 2, marginTop: 10, overflow: 'hidden',
  },
  progressFill: {
    height: '100%', backgroundColor: '#4CAF50', borderRadius: 2,
  },
  emptyState: { alignItems: 'center', paddingTop: 60, backgroundColor: 'transparent' },
  emptyText: { color: '#4CAF50', fontSize: 18, marginTop: 12, fontWeight: 'bold' },
  emptyHint: { color: '#666', fontSize: 13, marginTop: 4 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalContent: {
    backgroundColor: '#1a1a2e', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 20, maxHeight: '90%',
  },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: 'transparent', marginBottom: 12,
  },
  modalTitle: { fontSize: 20, fontWeight: 'bold', color: '#fff' },
  detailSummary: {
    flexDirection: 'row', justifyContent: 'space-around',
    backgroundColor: '#16213e', borderRadius: 12, padding: 12, marginBottom: 12,
  },
  detailSummaryItem: { alignItems: 'center', backgroundColor: 'transparent' },
  detailSummaryVal: { fontSize: 16, fontWeight: 'bold', color: '#fff' },
  detailSummaryLabel: { fontSize: 11, color: '#aaa', marginTop: 2 },
  saleCard: {
    backgroundColor: '#16213e', borderRadius: 10, padding: 12, marginBottom: 8,
    borderWidth: 1, borderColor: '#0f3460',
  },
  saleCardHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: 'transparent',
  },
  saleCardDate: { fontSize: 12, color: '#aaa' },
  saleCardAmount: { fontSize: 15, fontWeight: 'bold', color: '#fff', marginTop: 2 },
  saleCardPaid: { fontSize: 13, marginTop: 2 },
  payBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#4CAF50', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6,
  },
  payBtnText: { color: '#fff', fontSize: 13, fontWeight: 'bold' },
  historyBtn: {
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#0f3460', borderRadius: 8, padding: 6,
  },
  historyCard: {
    backgroundColor: '#16213e', borderRadius: 10, padding: 12, marginBottom: 8,
    borderWidth: 1, borderColor: '#0f3460',
  },
  payInfo: { color: '#aaa', fontSize: 14, marginBottom: 12 },
  label: { fontSize: 13, color: '#aaa', marginBottom: 4, marginTop: 10 },
  input: {
    backgroundColor: '#16213e', borderRadius: 10, padding: 12, color: '#fff',
    fontSize: 15, borderWidth: 1, borderColor: '#0f3460',
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4, backgroundColor: 'transparent' },
  chip: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8,
    backgroundColor: '#16213e', borderWidth: 1, borderColor: '#0f3460',
  },
  chipActive: { backgroundColor: '#e94560', borderColor: '#e94560' },
  chipText: { fontSize: 13, color: '#aaa' },
  saveBtn: {
    backgroundColor: '#4CAF50', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 20,
  },
  saveBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  cancelBtn: { padding: 14, alignItems: 'center', marginTop: 8 },
  cancelBtnText: { color: '#aaa', fontSize: 15 },
  itemTakenText: { fontSize: 12, color: '#aaa', fontStyle: 'italic', marginTop: 2 },
  // Statement Styles
  statementControls: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12, backgroundColor: 'transparent' },
  dateSelector: { flex: 1, backgroundColor: '#16213e', borderRadius: 10, padding: 8, borderWidth: 1, borderColor: '#0f3460' },
  dateSelectorLabel: { fontSize: 10, color: '#666', marginBottom: 2 },
  dateSelectorVal: { fontSize: 13, color: '#fff', fontWeight: 'bold' },
  refreshBtn: { backgroundColor: '#e94560', width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  openingBalCard: { backgroundColor: '#16213e', borderRadius: 12, padding: 12, marginBottom: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  openingBalLabel: { color: '#aaa', fontSize: 13 },
  openingBalVal: { color: '#fff', fontSize: 15, fontWeight: 'bold' },
  ledgerRow: { backgroundColor: '#16213e', borderRadius: 12, padding: 12, marginBottom: 8, flexDirection: 'row', justifyContent: 'space-between' },
  ledgerDate: { fontSize: 10, color: '#666' },
  ledgerDesc: { fontSize: 14, color: '#fff', fontWeight: 'bold', marginTop: 2 },
  ledgerItems: { fontSize: 11, color: '#aaa', fontStyle: 'italic' },
  ledgerAmt: { fontSize: 14, fontWeight: 'bold' },
  ledgerBal: { fontSize: 11, color: '#888', marginTop: 4 },
  statementActions: { flexDirection: 'row', gap: 10, marginTop: 16, backgroundColor: 'transparent' },
  actionBtn: { flex: 1, backgroundColor: '#e94560', borderRadius: 12, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  actionBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 14 },
});
