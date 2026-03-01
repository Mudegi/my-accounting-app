import React, { useState } from 'react';
import {
  StyleSheet,
  TouchableOpacity,
  Alert,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { Text, View } from '@/components/Themed';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { getTrialBalance, computePnL } from '@/lib/accounting';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

type ExportType = 'sales' | 'expenses' | 'inventory' | 'customers' | 'purchases' | 'debts' | 'vat' | 'income_tax';
type DateRange = 'today' | 'week' | 'month' | '3months' | '6months' | 'year' | 'all';

export default function ExportScreen() {
  const { business, currentBranch, profile, fmt, currency } = useAuth();
  const isAdmin = profile?.role === 'admin';

  const [exportType, setExportType] = useState<ExportType>('sales');
  const [dateRange, setDateRange] = useState<DateRange>('month');
  const [exporting, setExporting] = useState(false);

  const getDateFrom = (range: DateRange): string | null => {
    const now = new Date();
    switch (range) {
      case 'today': return now.toISOString().split('T')[0] + 'T00:00:00';
      case 'week': { const d = new Date(now); d.setDate(d.getDate() - 7); return d.toISOString(); }
      case 'month': { const d = new Date(now); d.setDate(1); return d.toISOString().split('T')[0] + 'T00:00:00'; }
      case '3months': { const d = new Date(now); d.setMonth(d.getMonth() - 3); return d.toISOString(); }
      case '6months': { const d = new Date(now); d.setMonth(d.getMonth() - 6); return d.toISOString(); }
      case 'year': { const d = new Date(now); d.setFullYear(d.getFullYear(), 0, 1); return d.toISOString().split('T')[0] + 'T00:00:00'; }
      case 'all': return null;
    }
  };

  const escapeCsv = (val: any): string => {
    if (val === null || val === undefined) return '';
    const str = String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const toCsv = (headers: string[], rows: any[][]): string => {
    const lines = [headers.map(escapeCsv).join(',')];
    rows.forEach(row => {
      lines.push(row.map(escapeCsv).join(','));
    });
    return lines.join('\n');
  };

  const exportSales = async (dateFrom: string | null) => {
    let query = supabase
      .from('sales')
      .select('id, total_amount, subtotal, tax_amount, discount_amount, payment_method, customer_name, status, created_at, sale_items(product_name, quantity, unit_price, cost_price, tax_rate, discount_amount, line_total)')
      .eq('business_id', business!.id)
      .eq('status', 'completed')
      .order('created_at', { ascending: false });

    if (!isAdmin && currentBranch) query = query.eq('branch_id', currentBranch.id);
    if (dateFrom) query = query.gte('created_at', dateFrom);

    const { data, error } = await query;
    if (error) throw error;
    if (!data || data.length === 0) throw new Error('No sales data to export');

    // Flatten: one row per sale item
    const headers = ['Date', 'Sale ID', 'Customer', 'Product', 'Qty', 'Unit Price', 'Cost Price', 'Tax Rate(%)', 'Item Discount', 'Line Total', 'Payment Method', 'Sale Subtotal', 'Sale Tax', 'Sale Discount', 'Sale Total'];
    const rows: any[][] = [];

    data.forEach((sale: any) => {
      const date = new Date(sale.created_at).toLocaleDateString('en-GB');
      const saleId = sale.id.slice(0, 8);
      const items = sale.sale_items || [];

      if (items.length === 0) {
        rows.push([date, saleId, sale.customer_name || '', '', '', '', '', '', '', '', sale.payment_method, sale.subtotal, sale.tax_amount, sale.discount_amount, sale.total_amount]);
      } else {
        items.forEach((item: any) => {
          rows.push([
            date, saleId, sale.customer_name || '', item.product_name,
            item.quantity, item.unit_price, item.cost_price,
            ((item.tax_rate || 0) * 100).toFixed(0),
            item.discount_amount || 0, item.line_total,
            sale.payment_method, sale.subtotal, sale.tax_amount,
            sale.discount_amount, sale.total_amount,
          ]);
        });
      }
    });

    return toCsv(headers, rows);
  };

  const exportExpenses = async (dateFrom: string | null) => {
    let query = supabase
      .from('expenses')
      .select('id, amount, category, description, payment_method, date, created_at')
      .eq('business_id', business!.id)
      .order('date', { ascending: false });

    if (!isAdmin && currentBranch) query = query.eq('branch_id', currentBranch.id);
    if (dateFrom) query = query.gte('date', dateFrom.split('T')[0]);

    const { data, error } = await query;
    if (error) throw error;
    if (!data || data.length === 0) throw new Error('No expenses to export');

    const headers = ['Date', 'Category', 'Description', 'Amount', 'Payment Method'];
    const rows = data.map((e: any) => [
      new Date(e.date).toLocaleDateString('en-GB'),
      e.category, e.description, e.amount, e.payment_method || 'cash',
    ]);

    return toCsv(headers, rows);
  };

  const exportInventory = async () => {
    let query = supabase
      .from('inventory')
      .select('quantity, selling_price, avg_cost_price, reorder_level, products(name, barcode, sku), branches(name)')
      .eq('branches.business_id', business!.id);

    if (!isAdmin && currentBranch) query = query.eq('branch_id', currentBranch.id);

    const { data, error } = await query;
    if (error) throw error;
    if (!data || data.length === 0) throw new Error('No inventory data');

    const headers = ['Product', 'Barcode', 'SKU', 'Branch', 'Qty', 'Selling Price', 'Avg Cost', 'Reorder Level', 'Stock Value'];
    const rows = data.map((inv: any) => [
      inv.products?.name, inv.products?.barcode || '', inv.products?.sku || '',
      inv.branches?.name || '', inv.quantity, inv.selling_price, inv.avg_cost_price,
      inv.reorder_level || 5,
      (inv.quantity * (inv.avg_cost_price || 0)).toFixed(0),
    ]);

    return toCsv(headers, rows);
  };

  const exportCustomers = async () => {
    const { data, error } = await supabase
      .from('customers')
      .select('name, tin, phone, email, address, buyer_type, contact_person, created_at')
      .eq('business_id', business!.id)
      .order('name');

    if (error) throw error;
    if (!data || data.length === 0) throw new Error('No customers to export');

    const buyerTypes: Record<string, string> = { '0': 'B2B', '1': 'B2C', '2': 'Foreigner', '3': 'B2G' };
    const headers = ['Name', 'TIN', 'Phone', 'Email', 'Address', 'Buyer Type', 'Contact Person', 'Added'];
    const rows = data.map((c: any) => [
      c.name, c.tin || '', c.phone || '', c.email || '', c.address || '',
      buyerTypes[c.buyer_type] || c.buyer_type, c.contact_person || '',
      new Date(c.created_at).toLocaleDateString('en-GB'),
    ]);

    return toCsv(headers, rows);
  };

  const exportPurchases = async (dateFrom: string | null) => {
    let query = supabase
      .from('purchases')
      .select('id, supplier_name, total_cost, vat_amount, payment_method, purchase_date, created_at, purchase_items(product_name, quantity, unit_cost, total)')
      .eq('business_id', business!.id)
      .order('purchase_date', { ascending: false });

    if (!isAdmin && currentBranch) query = query.eq('branch_id', currentBranch.id);
    if (dateFrom) query = query.gte('purchase_date', dateFrom.split('T')[0]);

    const { data, error } = await query;
    if (error) throw error;
    if (!data || data.length === 0) throw new Error('No purchases to export');

    const headers = ['Date', 'Purchase ID', 'Supplier', 'Product', 'Qty', 'Unit Cost', 'Line Total', 'VAT', 'Total Cost', 'Payment Method'];
    const rows: any[][] = [];

    data.forEach((p: any) => {
      const date = new Date(p.purchase_date).toLocaleDateString('en-GB');
      const items = p.purchase_items || [];
      if (items.length === 0) {
        rows.push([date, p.id.slice(0, 8), p.supplier_name || '', '', '', '', '', p.vat_amount || 0, p.total_cost, p.payment_method]);
      } else {
        items.forEach((item: any) => {
          rows.push([date, p.id.slice(0, 8), p.supplier_name || '', item.product_name, item.quantity, item.unit_cost, item.total, p.vat_amount || 0, p.total_cost, p.payment_method]);
        });
      }
    });

    return toCsv(headers, rows);
  };

  const exportDebts = async () => {
    // Credit sales with payment status
    const { data: sales, error } = await supabase
      .from('sales')
      .select('id, total_amount, customer_name, created_at')
      .eq('business_id', business!.id)
      .eq('payment_method', 'credit')
      .eq('status', 'completed')
      .order('created_at', { ascending: false });

    if (error) throw error;
    if (!sales || sales.length === 0) throw new Error('No credit sales');

    // Get all debt payments for these sales
    const saleIds = sales.map(s => s.id);
    const { data: payments } = await supabase
      .from('debt_payments')
      .select('sale_id, amount, payment_method, created_at')
      .in('sale_id', saleIds)
      .order('created_at');

    const paymentsBySale: Record<string, number> = {};
    payments?.forEach(p => {
      paymentsBySale[p.sale_id] = (paymentsBySale[p.sale_id] || 0) + Number(p.amount);
    });

    const headers = ['Date', 'Customer', 'Sale Amount', 'Paid', 'Balance', 'Status'];
    const rows = sales.map((s: any) => {
      const paid = paymentsBySale[s.id] || 0;
      const balance = Number(s.total_amount) - paid;
      return [
        new Date(s.created_at).toLocaleDateString('en-GB'),
        s.customer_name || '', s.total_amount, paid, balance,
        balance <= 0 ? 'Paid' : 'Outstanding',
      ];
    });

    return toCsv(headers, rows);
  };

  const exportVat = async (dateFrom: string | null) => {
    // Determine tax period label
    const periodEnd = new Date();
    const periodStart = dateFrom ? new Date(dateFrom) : null;
    const taxPeriodLabel = periodStart
      ? `${periodStart.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })} - ${periodEnd.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}`
      : 'All Time';

    // OUTPUT VAT (from sales)
    let salesQuery = supabase
      .from('sales')
      .select('id, subtotal, tax_amount, total_amount, created_at, customer_name, customer_tin, invoice_number, sale_items(product_name, quantity, unit_price, tax_rate, line_total)')
      .eq('business_id', business!.id)
      .eq('status', 'completed')
      .gt('tax_amount', 0)
      .order('created_at', { ascending: false });

    if (dateFrom) salesQuery = salesQuery.gte('created_at', dateFrom);

    const { data: sales } = await salesQuery;

    // INPUT VAT (from purchases)
    let purchasesQuery = supabase
      .from('purchases')
      .select('id, total_cost, vat_amount, supplier_name, supplier_tin, purchase_date')
      .eq('business_id', business!.id)
      .gt('vat_amount', 0)
      .order('purchase_date', { ascending: false });

    if (dateFrom) purchasesQuery = purchasesQuery.gte('purchase_date', dateFrom.split('T')[0]);

    const { data: purchases } = await purchasesQuery;

    // CREDIT NOTES (reduce output VAT)
    let cnQuery = supabase
      .from('credit_notes')
      .select('id, total_amount, created_at, original_sale_id, credit_note_items(quantity, unit_price)')
      .eq('business_id', business!.id)
      .order('created_at', { ascending: false });

    if (dateFrom) cnQuery = cnQuery.gte('created_at', dateFrom);

    const { data: creditNotes } = await cnQuery;

    // Get original sale tax info for credit notes
    let cnSaleTaxMap: Record<string, number> = {};
    if (creditNotes && creditNotes.length > 0) {
      const saleIds = [...new Set(creditNotes.map((cn: any) => cn.original_sale_id).filter(Boolean))];
      if (saleIds.length > 0) {
        const { data: cnSales } = await supabase
          .from('sales')
          .select('id, tax_amount, subtotal')
          .in('id', saleIds);
        cnSales?.forEach((s: any) => {
          // Effective tax rate on original sale
          cnSaleTaxMap[s.id] = s.subtotal > 0 ? Number(s.tax_amount) / Number(s.subtotal) : 0;
        });
      }
    }

    const outputVat = sales?.reduce((s: number, sale: any) => s + Number(sale.tax_amount), 0) || 0;
    const inputVat = purchases?.reduce((s: number, p: any) => s + Number(p.vat_amount), 0) || 0;
    const cnVat = creditNotes?.reduce((s: number, cn: any) => {
      const taxRate = cnSaleTaxMap[cn.original_sale_id] || 0;
      return s + Number(cn.total_amount) * taxRate;
    }, 0) || 0;

    const rows: any[][] = [];

    // Header info rows
    const headers = ['Type', 'Date', 'Invoice/Ref No.', 'TIN', 'Name', 'Taxable Amount', 'VAT Amount', 'Total', 'VAT Rate'];
    
    // Business info header
    rows.push(['BUSINESS:', '', business!.name, business!.tin || 'N/A', '', '', '', '', '']);
    rows.push(['TAX PERIOD:', '', taxPeriodLabel, '', '', '', '', '', '']);
    rows.push(['CURRENCY:', '', currency || 'UGX', '', '', '', '', '', '']);
    rows.push([]);

    // Section: OUTPUT VAT (sales)
    rows.push(['=== OUTPUT VAT (Collected on Sales) ===', '', '', '', '', '', '', '', '']);

    // Standard-rated sales (18%)
    let stdRatedOutput = 0, stdRatedTaxableOutput = 0;
    let zeroRatedOutput = 0;
    let exemptOutput = 0;

    sales?.forEach((sale: any) => {
      const invoiceNo = sale.invoice_number || `INV-${sale.id.slice(0, 8)}`;
      const taxRate = Number(sale.subtotal) > 0 ? (Number(sale.tax_amount) / Number(sale.subtotal) * 100).toFixed(0) + '%' : '18%';

      rows.push([
        'OUTPUT', new Date(sale.created_at).toLocaleDateString('en-GB'),
        invoiceNo,
        sale.customer_tin || '',
        sale.customer_name || 'Walk-in Customer',
        sale.subtotal, sale.tax_amount, sale.total_amount,
        taxRate,
      ]);

      // Classify
      const rate = Number(sale.subtotal) > 0 ? Number(sale.tax_amount) / Number(sale.subtotal) : 0;
      if (rate > 0.01) {
        stdRatedOutput += Number(sale.tax_amount);
        stdRatedTaxableOutput += Number(sale.subtotal);
      } else if (rate === 0) {
        // Check if it's zero-rated or exempt based on items
        const hasZeroRated = sale.sale_items?.some((item: any) => (item.tax_rate || 0) === 0);
        if (hasZeroRated) zeroRatedOutput += Number(sale.subtotal);
        else exemptOutput += Number(sale.subtotal);
      }
    });

    // Credit note deductions
    if (creditNotes && creditNotes.length > 0) {
      rows.push([]);
      rows.push(['--- Credit Notes / Returns (Reducing Output VAT) ---', '', '', '', '', '', '', '', '']);

      creditNotes.forEach((cn: any) => {
        const taxRate = cnSaleTaxMap[cn.original_sale_id] || 0;
        const vatOnReturn = Math.round(Number(cn.total_amount) * taxRate * 100) / 100;
        const netReturn = Number(cn.total_amount) - vatOnReturn;

        rows.push([
          'CREDIT NOTE', new Date(cn.created_at).toLocaleDateString('en-GB'),
          `CN-${cn.id.slice(0, 8)}`,
          '', 'Customer Return',
          -netReturn, -vatOnReturn, -Number(cn.total_amount),
          taxRate > 0 ? (taxRate * 100).toFixed(0) + '%' : '0%',
        ]);
      });
    }

    rows.push([]);

    // Section: INPUT VAT (purchases)
    rows.push(['=== INPUT VAT (Paid on Purchases) ===', '', '', '', '', '', '', '', '']);

    purchases?.forEach((p: any) => {
      const net = Number(p.total_cost) - Number(p.vat_amount);
      rows.push([
        'INPUT', new Date(p.purchase_date).toLocaleDateString('en-GB'),
        `PUR-${p.id.slice(0, 8)}`,
        p.supplier_tin || '',
        p.supplier_name || 'Unknown Supplier',
        net, p.vat_amount, p.total_cost,
        net > 0 ? ((Number(p.vat_amount) / net) * 100).toFixed(0) + '%' : '18%',
      ]);
    });

    // Summary section
    rows.push([]);
    rows.push(['═══════════════════════════════════════', '', '', '', '', '', '', '', '']);
    rows.push(['SUMMARY', '', '', '', '', '', '', '', '']);
    rows.push(['', '', '', '', 'Standard Rated Sales (18%)', stdRatedTaxableOutput, stdRatedOutput, '', '18%']);
    if (zeroRatedOutput > 0) {
      rows.push(['', '', '', '', 'Zero-Rated Sales', zeroRatedOutput, 0, '', '0%']);
    }
    if (exemptOutput > 0) {
      rows.push(['', '', '', '', 'Exempt Sales', exemptOutput, 0, '', 'Exempt']);
    }
    rows.push([]);
    rows.push(['', '', '', '', 'Total Output VAT (Collected)', '', outputVat, '', '']);
    rows.push(['', '', '', '', 'Less: Credit Note VAT Adjustments', '', -Math.round(cnVat * 100) / 100, '', '']);
    rows.push(['', '', '', '', 'Adjusted Output VAT', '', Math.round((outputVat - cnVat) * 100) / 100, '', '']);
    rows.push(['', '', '', '', 'Total Input VAT (Paid)', '', inputVat, '', '']);
    rows.push([]);
    rows.push(['', '', '', '', 'NET VAT PAYABLE TO URA', '', Math.round((outputVat - cnVat - inputVat) * 100) / 100, '', '']);

    // Filing note
    rows.push([]);
    rows.push(['NOTE:', '', 'This report is for reference. File your official return on the URA web portal (https://efris.ura.go.ug)', '', '', '', '', '', '']);
    rows.push(['', '', `Generated by YourBooks Lite on ${new Date().toLocaleDateString('en-GB')} at ${new Date().toLocaleTimeString('en-GB')}`, '', '', '', '', '', '']);

    if (rows.length <= 8) throw new Error('No VAT data to export');

    return toCsv(headers, rows);
  };

  const exportIncomeTax = async (dateFrom: string | null) => {
    // Generate P&L-based income tax preparation report
    const fromDate = dateFrom ? dateFrom.split('T')[0] : new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0];
    const toDate = new Date().toISOString().split('T')[0];

    const tb = await getTrialBalance({
      businessId: business!.id,
      fromDate,
      toDate,
    });

    if (tb.length === 0) throw new Error('No accounting data for this period');

    const pnl = computePnL(tb);

    const periodLabel = `${new Date(fromDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })} to ${new Date(toDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })}`;

    const rows: any[][] = [];
    const headers = ['Category', 'Item', 'Amount (' + (currency || 'UGX') + ')'];

    // Header
    rows.push(['INCOME TAX PREPARATION REPORT', '', '']);
    rows.push(['Business:', business!.name, '']);
    rows.push(['TIN:', business!.tin || 'Not Set', '']);
    rows.push(['Period:', periodLabel, '']);
    rows.push(['Currency:', currency || 'UGX', '']);
    rows.push([]);

    // Revenue
    rows.push(['REVENUE', '', '']);
    rows.push(['', 'Gross Sales Revenue', pnl.grossRevenue]);
    rows.push(['', 'Less: Sales Discounts', -pnl.salesDiscount]);
    rows.push(['', 'Less: Sales Returns', -pnl.salesReturns]);
    rows.push(['', 'NET REVENUE', pnl.netRevenue]);
    rows.push([]);

    // Cost of Sales
    rows.push(['COST OF SALES', '', '']);
    rows.push(['', 'Cost of Goods Sold', -pnl.cogs]);
    rows.push(['', 'GROSS PROFIT', pnl.grossProfit]);
    rows.push([]);

    // Other Income
    if (pnl.otherIncome > 0) {
      rows.push(['OTHER INCOME', '', '']);
      rows.push(['', 'Other Income', pnl.otherIncome]);
      rows.push([]);
    }

    // Operating Expenses
    rows.push(['OPERATING EXPENSES', '', '']);
    pnl.operatingExpenses.forEach(e => {
      rows.push(['', e.name, -e.amount]);
    });
    rows.push(['', 'TOTAL OPERATING EXPENSES', -pnl.totalOperatingExpenses]);
    rows.push([]);

    // Net Profit
    rows.push(['', 'NET PROFIT / (LOSS) BEFORE TAX', pnl.netProfit]);
    rows.push([]);

    // Tax Computation
    const taxableIncome = Math.max(0, pnl.netProfit);
    const corporateTax = Math.round(taxableIncome * 0.30); // 30% Uganda corporate tax
    const smallBizTax = Math.round(taxableIncome * 0.01);   // 1% presumptive for turnover < 150M

    rows.push(['TAX COMPUTATION', '', '']);
    rows.push(['', 'Taxable Income', taxableIncome]);
    rows.push([]);
    rows.push(['', 'Option A: Corporate Income Tax (30%)', corporateTax]);
    rows.push(['', 'Option B: Presumptive Tax (1% of turnover)', Math.round(pnl.grossRevenue * 0.01)]);
    rows.push(['', 'Note: Small businesses (turnover < UGX 150M) may use presumptive tax', '']);
    rows.push([]);

    // Quarterly installments
    const quarterlyInstallment = Math.round(corporateTax / 4);
    rows.push(['QUARTERLY TAX INSTALLMENTS (if corporate rate)', '', '']);
    rows.push(['', 'Q1 (by June 30)', quarterlyInstallment]);
    rows.push(['', 'Q2 (by September 30)', quarterlyInstallment]);
    rows.push(['', 'Q3 (by December 31)', quarterlyInstallment]);
    rows.push(['', 'Q4 (by March 31)', corporateTax - quarterlyInstallment * 3]);
    rows.push([]);

    rows.push(['NOTE:', '', '']);
    rows.push(['', 'This is a PREPARATION report for your accountant.', '']);
    rows.push(['', 'File your official return on URA portal (https://ura.go.ug)', '']);
    rows.push(['', `Generated by YourBooks Lite on ${new Date().toLocaleDateString('en-GB')}`, '']);

    return toCsv(headers, rows);
  };

  const handleExport = async () => {
    if (!business) return;

    setExporting(true);
    try {
      const dateFrom = getDateFrom(dateRange);
      let csv: string;

      switch (exportType) {
        case 'sales': csv = await exportSales(dateFrom); break;
        case 'expenses': csv = await exportExpenses(dateFrom); break;
        case 'inventory': csv = await exportInventory(); break;
        case 'customers': csv = await exportCustomers(); break;
        case 'purchases': csv = await exportPurchases(dateFrom); break;
        case 'debts': csv = await exportDebts(); break;
        case 'vat': csv = await exportVat(dateFrom); break;
        case 'income_tax': csv = await exportIncomeTax(dateFrom); break;
        default: throw new Error('Unknown export type');
      }

      // Save to file and share
      const filename = `${business.name.replace(/[^a-zA-Z0-9]/g, '_')}_${exportType}_${new Date().toISOString().split('T')[0]}.csv`;
      const file = new File(Paths.cache, filename);
      file.write(csv);
      const fileUri = file.uri;

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(fileUri, {
          mimeType: 'text/csv',
          dialogTitle: `Share ${exportType} data`,
          UTI: 'public.comma-separated-values-text',
        });
      } else {
        Alert.alert('Saved', `File saved to: ${filename}`);
      }
    } catch (err: any) {
      Alert.alert('Export Error', err.message);
    } finally {
      setExporting(false);
    }
  };

  const exportOptions: { type: ExportType; label: string; icon: string; desc: string }[] = [
    { type: 'sales', label: 'Sales', icon: 'shopping-cart', desc: 'All sales with item details' },
    { type: 'expenses', label: 'Expenses', icon: 'money', desc: 'Categorized expenses for tax filing' },
    { type: 'purchases', label: 'Purchases', icon: 'shopping-basket', desc: 'Stock purchases with costs' },
    { type: 'inventory', label: 'Inventory', icon: 'cubes', desc: 'Current stock levels & values' },
    { type: 'customers', label: 'Customers', icon: 'users', desc: 'Customer directory with TINs' },
    { type: 'debts', label: 'Debts', icon: 'credit-card', desc: 'Outstanding credit sales' },
    { type: 'vat', label: 'VAT Report', icon: 'file-text', desc: 'Input/Output VAT for URA filing' },
    { type: 'income_tax', label: 'Income Tax', icon: 'university', desc: 'P&L summary for income tax filing' },
  ];

  const dateRangeOptions: { value: DateRange; label: string }[] = [
    { value: 'today', label: 'Today' },
    { value: 'week', label: '7 Days' },
    { value: 'month', label: 'This Month' },
    { value: '3months', label: '3 Months' },
    { value: '6months', label: '6 Months' },
    { value: 'year', label: 'This Year' },
    { value: 'all', label: 'All Time' },
  ];

  const needsDateRange = ['sales', 'expenses', 'purchases', 'vat', 'income_tax'].includes(exportType);

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.heading}>📊 Export Data</Text>
        <Text style={styles.subheading}>
          Export your business data to CSV for accountants, tax filing, or analysis in Excel
        </Text>

        {/* Export Type Selector */}
        <Text style={styles.sectionLabel}>What to export</Text>
        <View style={styles.optionsGrid}>
          {exportOptions.map((opt) => (
            <TouchableOpacity
              key={opt.type}
              style={[styles.optionCard, exportType === opt.type && styles.optionCardActive]}
              onPress={() => setExportType(opt.type)}
            >
              <FontAwesome
                name={opt.icon as any}
                size={20}
                color={exportType === opt.type ? '#fff' : '#aaa'}
              />
              <Text style={[styles.optionLabel, exportType === opt.type && { color: '#fff' }]}>
                {opt.label}
              </Text>
              <Text style={[styles.optionDesc, exportType === opt.type && { color: '#ddd' }]}>
                {opt.desc}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Date Range */}
        {needsDateRange && (
          <>
            <Text style={styles.sectionLabel}>Date range</Text>
            <View style={styles.chipRow}>
              {dateRangeOptions.map((r) => (
                <TouchableOpacity
                  key={r.value}
                  style={[styles.chip, dateRange === r.value && styles.chipActive]}
                  onPress={() => setDateRange(r.value)}
                >
                  <Text style={[styles.chipText, dateRange === r.value && { color: '#fff' }]}>
                    {r.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}

        {/* Export Button */}
        <TouchableOpacity
          style={[styles.exportBtn, exporting && { opacity: 0.6 }]}
          onPress={handleExport}
          disabled={exporting}
        >
          {exporting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <FontAwesome name="download" size={18} color="#fff" />
              <Text style={styles.exportBtnText}>
                Export {exportOptions.find(o => o.type === exportType)?.label} as CSV
              </Text>
            </>
          )}
        </TouchableOpacity>

        <Text style={styles.hint}>
          📱 The CSV file will open your share menu — send via WhatsApp, Email, or save to cloud storage.
          {'\n\n'}📋 CSV files can be opened in Excel, Google Sheets, or any spreadsheet program.
          {'\n\n'}🏛️ The VAT report includes Output VAT, Input VAT, credit note adjustments, customer/supplier TINs, and invoice numbers — ready to help your accountant file with URA.
          {'\n\n'}💰 The Income Tax report gives a complete P&L with estimated tax liability at 30% corporate rate and 1% presumptive rate, plus quarterly installment amounts.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  scrollContent: { padding: 16, paddingBottom: 40 },
  heading: { fontSize: 22, fontWeight: 'bold', color: '#fff' },
  subheading: { fontSize: 14, color: '#aaa', marginTop: 6, lineHeight: 20 },
  sectionLabel: { fontSize: 15, fontWeight: 'bold', color: '#ccc', marginTop: 20, marginBottom: 8 },
  optionsGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 10,
  },
  optionCard: {
    width: '47%', backgroundColor: '#16213e', borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: '#0f3460', alignItems: 'center',
  },
  optionCardActive: { backgroundColor: '#e94560', borderColor: '#e94560' },
  optionLabel: { fontSize: 14, fontWeight: 'bold', color: '#ccc', marginTop: 6 },
  optionDesc: { fontSize: 11, color: '#777', marginTop: 4, textAlign: 'center' },
  chipRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8,
  },
  chip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16,
    backgroundColor: '#16213e', borderWidth: 1, borderColor: '#0f3460',
  },
  chipActive: { backgroundColor: '#e94560', borderColor: '#e94560' },
  chipText: { fontSize: 13, color: '#aaa' },
  exportBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: '#4CAF50', borderRadius: 12, padding: 18, marginTop: 24,
  },
  exportBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  hint: {
    color: '#666', fontSize: 13, marginTop: 20, lineHeight: 20,
    backgroundColor: '#16213e', borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: '#0f3460',
  },
});
