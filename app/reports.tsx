import React, { useState, useCallback } from 'react';
import {
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  Alert,
} from 'react-native';
import { Text, View } from '@/components/Themed';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useFocusEffect } from 'expo-router';
import {
  getTrialBalance,
  computePnL,
  computeBalanceSheet,
  computeVatSummary,
  type AccountBalance,
} from '@/lib/accounting';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

type BranchReport = {
  branch_id: string;
  branch_name: string;
  revenue: number;
  cost: number;
  profit: number;
  transactions: number;
  expenses: number;
  netProfit: number;
};

type TopProduct = {
  product_name: string;
  qty_sold: number;
  revenue: number;
};

type ReportTab = 'dashboard' | 'trial_balance' | 'pnl' | 'balance_sheet' | 'vat';

export default function ReportsScreen() {
  const { business, branches, currentBranch, profile, fmt } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const canSeeAllBranches = isAdmin;
  const [period, setPeriod] = useState<'today' | 'week' | 'month' | '3months' | '6months' | 'year'>('month');
  const [branchReports, setBranchReports] = useState<BranchReport[]>([]);
  const [topProducts, setTopProducts] = useState<TopProduct[]>([]);
  const [totalRevenue, setTotalRevenue] = useState(0);
  const [totalProfit, setTotalProfit] = useState(0);
  const [totalExpenses, setTotalExpenses] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<ReportTab>('dashboard');

  // GL-based report data
  const [trialBalance, setTrialBalance] = useState<AccountBalance[]>([]);
  const [glLoading, setGlLoading] = useState(false);

  const getDateRange = () => {
    const now = new Date();
    switch (period) {
      case 'today': return now.toISOString().split('T')[0] + 'T00:00:00';
      case 'week': { const d = new Date(now); d.setDate(d.getDate() - 7); return d.toISOString(); }
      case 'month': { const d = new Date(now); d.setDate(1); return d.toISOString().split('T')[0] + 'T00:00:00'; }
      case '3months': { const d = new Date(now); d.setMonth(d.getMonth() - 3); return d.toISOString(); }
      case '6months': { const d = new Date(now); d.setMonth(d.getMonth() - 6); return d.toISOString(); }
      case 'year': { const d = new Date(now); d.setFullYear(d.getFullYear(), 0, 1); return d.toISOString().split('T')[0] + 'T00:00:00'; }
    }
  };

  const getDateOnly = () => {
    const from = getDateRange();
    return from.split('T')[0];
  };

  const loadDashboard = useCallback(async () => {
    if (!business) return;
    const from = getDateRange();

    let salesQuery = supabase
      .from('sales')
      .select(`branch_id, total_amount, sale_items(quantity, unit_price, cost_price)`)
      .eq('business_id', business.id)
      .eq('status', 'completed')
      .gte('created_at', from);

    if (!canSeeAllBranches && currentBranch) {
      salesQuery = salesQuery.eq('branch_id', currentBranch.id);
    }

    const { data: salesData } = await salesQuery;

    const branchMap: Record<string, BranchReport> = {};
    const visibleBranches = canSeeAllBranches ? branches : branches.filter(b => b.id === currentBranch?.id);
    visibleBranches.forEach((b) => {
      branchMap[b.id] = { branch_id: b.id, branch_name: b.name, revenue: 0, cost: 0, profit: 0, transactions: 0, expenses: 0, netProfit: 0 };
    });

    let totalRev = 0, totalCost = 0;
    salesData?.forEach((sale: any) => {
      const b = branchMap[sale.branch_id];
      if (b) {
        b.revenue += Number(sale.total_amount);
        b.transactions += 1;
        sale.sale_items?.forEach((item: any) => {
          b.cost += Number(item.cost_price || 0) * Number(item.quantity);
        });
        b.profit = b.revenue - b.cost;
      }
      totalRev += Number(sale.total_amount);
      sale.sale_items?.forEach((item: any) => {
        totalCost += Number(item.cost_price || 0) * Number(item.quantity);
      });
    });

    let expQuery = supabase
      .from('expenses')
      .select('branch_id, amount')
      .eq('business_id', business.id)
      .gte('date', from.split('T')[0]);

    if (!canSeeAllBranches && currentBranch) {
      expQuery = expQuery.eq('branch_id', currentBranch.id);
    }

    const { data: expData } = await expQuery;
    let totalExp = 0;
    expData?.forEach((e: any) => {
      const b = branchMap[e.branch_id];
      if (b) b.expenses += Number(e.amount);
      totalExp += Number(e.amount);
    });

    Object.values(branchMap).forEach(b => { b.netProfit = b.profit - b.expenses; });

    setBranchReports(Object.values(branchMap).filter((b) => b.transactions > 0 || b.expenses > 0));
    setTotalRevenue(totalRev);
    setTotalProfit(totalRev - totalCost);
    setTotalExpenses(totalExp);

    // Top Products
    let itemsQuery = supabase
      .from('sale_items')
      .select('product_name, quantity, line_total, sale_id, sales!inner(business_id, status, created_at, branch_id)')
      .eq('sales.business_id', business.id)
      .eq('sales.status', 'completed')
      .gte('sales.created_at', from);

    if (!canSeeAllBranches && currentBranch) {
      itemsQuery = itemsQuery.eq('sales.branch_id', currentBranch.id);
    }

    const { data: itemsData } = await itemsQuery;
    const productMap: Record<string, TopProduct> = {};
    itemsData?.forEach((item: any) => {
      const key = item.product_name;
      if (!productMap[key]) productMap[key] = { product_name: key, qty_sold: 0, revenue: 0 };
      productMap[key].qty_sold += Number(item.quantity);
      productMap[key].revenue += Number(item.line_total);
    });
    setTopProducts(Object.values(productMap).sort((a, b) => b.revenue - a.revenue).slice(0, 5));
  }, [business, branches, currentBranch, period, canSeeAllBranches]);

  const loadGL = useCallback(async () => {
    if (!business) return;
    setGlLoading(true);
    try {
      const fromDate = getDateOnly();
      const toDate = new Date().toISOString().split('T')[0];
      const tb = await getTrialBalance({
        businessId: business.id,
        branchId: canSeeAllBranches ? null : currentBranch?.id,
        fromDate,
        toDate,
      });
      setTrialBalance(tb);
    } catch (e) {
      console.error('GL load error:', e);
    }
    setGlLoading(false);
  }, [business, currentBranch, period, canSeeAllBranches]);

  const load = useCallback(async () => {
    if (activeTab === 'dashboard') {
      await loadDashboard();
    } else {
      await loadGL();
    }
  }, [activeTab, loadDashboard, loadGL]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const netProfit = totalProfit - totalExpenses;

  const periodLabels: Record<string, string> = {
    today: 'Today', week: '7 Days', month: 'Month', '3months': '3 Mo', '6months': '6 Mo', year: 'Year',
  };

  const tabs: { key: ReportTab; label: string; icon: string }[] = [
    { key: 'dashboard', label: 'Dashboard', icon: 'tachometer' },
    { key: 'trial_balance', label: 'Trial Bal.', icon: 'balance-scale' },
    { key: 'pnl', label: 'P&L', icon: 'line-chart' },
    { key: 'balance_sheet', label: 'Bal. Sheet', icon: 'building' },
    { key: 'vat', label: 'VAT', icon: 'percent' },
  ];

  // ─── Renderers ──────

  const renderDashboard = () => (
    <>
      {!canSeeAllBranches && (
        <View style={styles.roleNotice}>
          <FontAwesome name="info-circle" size={14} color="#FF9800" />
          <Text style={styles.roleNoticeText}>
            Showing data for {currentBranch?.name || 'your branch'} only
          </Text>
        </View>
      )}

      <View style={styles.summaryGrid}>
        <View style={[styles.summaryCard, { backgroundColor: '#0f3460' }]}>
          <Text style={styles.summaryValue}>{fmt(totalRevenue)}</Text>
          <Text style={styles.summaryLabel}>Total Revenue</Text>
        </View>
        <View style={[styles.summaryCard, { backgroundColor: '#533483' }]}>
          <Text style={styles.summaryValue}>{fmt(totalProfit)}</Text>
          <Text style={styles.summaryLabel}>Gross Profit</Text>
        </View>
        <View style={[styles.summaryCard, { backgroundColor: '#8B1A1A' }]}>
          <Text style={styles.summaryValue}>{fmt(totalExpenses)}</Text>
          <Text style={styles.summaryLabel}>Expenses</Text>
        </View>
        <View style={[styles.summaryCard, { backgroundColor: netProfit >= 0 ? '#2d6a4f' : '#8B1A1A' }]}>
          <Text style={styles.summaryValue}>{fmt(netProfit)}</Text>
          <Text style={styles.summaryLabel}>Net Profit</Text>
        </View>
      </View>

      {branchReports.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Branch Performance</Text>
          {branchReports.map((b) => (
            <View key={b.branch_id} style={styles.branchCard}>
              <View style={styles.branchHeader}>
                <Text style={styles.branchName}>{b.branch_name}</Text>
                <Text style={styles.branchTx}>{b.transactions} sales</Text>
              </View>
              <View style={styles.branchStats}>
                <View style={styles.branchStat}>
                  <Text style={styles.branchStatVal}>{fmt(b.revenue)}</Text>
                  <Text style={styles.branchStatLabel}>Revenue</Text>
                </View>
                <View style={styles.branchStat}>
                  <Text style={[styles.branchStatVal, { color: b.profit >= 0 ? '#4CAF50' : '#e94560' }]}>
                    {fmt(b.profit)}
                  </Text>
                  <Text style={styles.branchStatLabel}>Gross Profit</Text>
                </View>
              </View>
              <View style={styles.branchStats}>
                <View style={styles.branchStat}>
                  <Text style={[styles.branchStatVal, { color: '#e94560' }]}>{fmt(b.expenses)}</Text>
                  <Text style={styles.branchStatLabel}>Expenses</Text>
                </View>
                <View style={styles.branchStat}>
                  <Text style={[styles.branchStatVal, { color: b.netProfit >= 0 ? '#4CAF50' : '#e94560' }]}>
                    {fmt(b.netProfit)}
                  </Text>
                  <Text style={styles.branchStatLabel}>Net Profit</Text>
                </View>
              </View>
            </View>
          ))}
        </>
      )}

      {topProducts.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Top 5 Products</Text>
          {topProducts.map((p, i) => (
            <View key={p.product_name} style={styles.productRow}>
              <View style={styles.productRank}>
                <Text style={styles.rankText}>#{i + 1}</Text>
              </View>
              <View style={styles.productInfo}>
                <Text style={styles.productName}>{p.product_name}</Text>
                <Text style={styles.productQty}>{p.qty_sold} units sold</Text>
              </View>
              <Text style={styles.productRevenue}>{fmt(p.revenue)}</Text>
            </View>
          ))}
        </>
      )}

      {branchReports.length === 0 && topProducts.length === 0 && (
        <View style={styles.empty}>
          <FontAwesome name="line-chart" size={48} color="#333" />
          <Text style={styles.emptyText}>No sales data for this period</Text>
        </View>
      )}
    </>
  );

  const renderTrialBalance = () => {
    const totalDR = trialBalance.reduce((s, a) => s + a.total_debit, 0);
    const totalCR = trialBalance.reduce((s, a) => s + a.total_credit, 0);
    const balanced = Math.abs(totalDR - totalCR) < 1;

    return (
      <>
        <View style={[styles.glHeader, { backgroundColor: balanced ? '#2d6a4f' : '#8B1A1A' }]}>
          <FontAwesome name={balanced ? 'check-circle' : 'exclamation-triangle'} size={16} color="#fff" />
          <Text style={styles.glHeaderText}>
            {balanced ? 'Books are balanced' : `Imbalance: ${fmt(Math.round(totalDR - totalCR))}`}
          </Text>
        </View>

        {/* Table Header */}
        <View style={styles.tableHeader}>
          <Text style={[styles.tableHeaderText, { flex: 2 }]}>Account</Text>
          <Text style={[styles.tableHeaderText, { flex: 1, textAlign: 'right' }]}>Debit</Text>
          <Text style={[styles.tableHeaderText, { flex: 1, textAlign: 'right' }]}>Credit</Text>
        </View>

        {trialBalance.length === 0 && !glLoading && (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No journal entries for this period</Text>
          </View>
        )}

        {trialBalance.map(a => (
          <View key={a.account_id} style={styles.tableRow}>
            <View style={{ flex: 2, backgroundColor: 'transparent' }}>
              <Text style={styles.tableAccName}>{a.code} {a.name}</Text>
              <Text style={styles.tableAccType}>{a.account_type}</Text>
            </View>
            <Text style={[styles.tableAmount, { flex: 1, textAlign: 'right' }]}>
              {a.total_debit > 0 ? a.total_debit.toLocaleString() : '-'}
            </Text>
            <Text style={[styles.tableAmount, { flex: 1, textAlign: 'right' }]}>
              {a.total_credit > 0 ? a.total_credit.toLocaleString() : '-'}
            </Text>
          </View>
        ))}

        {/* Totals */}
        <View style={[styles.tableRow, { borderTopWidth: 2, borderTopColor: '#e94560' }]}>
          <Text style={[styles.tableAccName, { flex: 2, fontWeight: 'bold' }]}>TOTALS</Text>
          <Text style={[styles.tableAmount, { flex: 1, textAlign: 'right', fontWeight: 'bold' }]}>
            {Math.round(totalDR).toLocaleString()}
          </Text>
          <Text style={[styles.tableAmount, { flex: 1, textAlign: 'right', fontWeight: 'bold' }]}>
            {Math.round(totalCR).toLocaleString()}
          </Text>
        </View>
      </>
    );
  };

  const renderPnL = () => {
    const pnl = computePnL(trialBalance);

    return (
      <>
        <Text style={styles.sectionTitle}>Income Statement (P&L)</Text>

        <View style={styles.pnlSection}>
          <View style={styles.pnlRow}>
            <Text style={styles.pnlLabel}>Gross Sales Revenue</Text>
            <Text style={styles.pnlValue}>{fmt(Math.round(pnl.grossRevenue))}</Text>
          </View>
          {pnl.salesDiscount > 0 && (
            <View style={styles.pnlRow}>
              <Text style={styles.pnlLabel}>  Less: Sales Discounts</Text>
              <Text style={[styles.pnlValue, { color: '#e94560' }]}>({Math.round(pnl.salesDiscount).toLocaleString()})</Text>
            </View>
          )}
          {pnl.salesReturns > 0 && (
            <View style={styles.pnlRow}>
              <Text style={styles.pnlLabel}>  Less: Sales Returns</Text>
              <Text style={[styles.pnlValue, { color: '#e94560' }]}>({Math.round(pnl.salesReturns).toLocaleString()})</Text>
            </View>
          )}
          <View style={[styles.pnlRow, styles.pnlSubtotal]}>
            <Text style={styles.pnlBoldLabel}>Net Revenue</Text>
            <Text style={styles.pnlBoldValue}>{fmt(Math.round(pnl.netRevenue))}</Text>
          </View>
        </View>

        <View style={styles.pnlSection}>
          <View style={styles.pnlRow}>
            <Text style={styles.pnlLabel}>Cost of Goods Sold</Text>
            <Text style={[styles.pnlValue, { color: '#e94560' }]}>({Math.round(pnl.cogs).toLocaleString()})</Text>
          </View>
          <View style={[styles.pnlRow, styles.pnlSubtotal]}>
            <Text style={styles.pnlBoldLabel}>Gross Profit</Text>
            <Text style={[styles.pnlBoldValue, { color: pnl.grossProfit >= 0 ? '#4CAF50' : '#e94560' }]}>
              {fmt(Math.round(pnl.grossProfit))}
            </Text>
          </View>
        </View>

        {pnl.otherIncome > 0 && (
          <View style={styles.pnlSection}>
            <View style={styles.pnlRow}>
              <Text style={styles.pnlLabel}>Other Income</Text>
              <Text style={styles.pnlValue}>{Math.round(pnl.otherIncome).toLocaleString()}</Text>
            </View>
          </View>
        )}

        {pnl.operatingExpenses.length > 0 && (
          <View style={styles.pnlSection}>
            <Text style={[styles.pnlLabel, { marginBottom: 6, color: '#aaa' }]}>Operating Expenses</Text>
            {pnl.operatingExpenses.map((ex, i) => (
              <View key={i} style={styles.pnlRow}>
                <Text style={styles.pnlLabel}>  {ex.name}</Text>
                <Text style={[styles.pnlValue, { color: '#e94560' }]}>({Math.round(ex.amount).toLocaleString()})</Text>
              </View>
            ))}
            <View style={[styles.pnlRow, styles.pnlSubtotal]}>
              <Text style={styles.pnlBoldLabel}>Total Operating Expenses</Text>
              <Text style={[styles.pnlBoldValue, { color: '#e94560' }]}>
                ({Math.round(pnl.totalOperatingExpenses).toLocaleString()})
              </Text>
            </View>
          </View>
        )}

        <View style={[styles.netProfitCard, { backgroundColor: pnl.netProfit >= 0 ? '#2d6a4f' : '#8B1A1A' }]}>
          <Text style={styles.netProfitLabel}>NET PROFIT / (LOSS)</Text>
          <Text style={styles.netProfitValue}>{fmt(Math.round(pnl.netProfit))}</Text>
        </View>

        {trialBalance.length === 0 && !glLoading && (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No journal entries for this period</Text>
          </View>
        )}
      </>
    );
  };

  const renderBalanceSheet = () => {
    const bs = computeBalanceSheet(trialBalance);

    return (
      <>
        <Text style={styles.sectionTitle}>Balance Sheet</Text>

        <View style={[styles.glHeader, { backgroundColor: bs.isBalanced ? '#2d6a4f' : '#8B1A1A' }]}>
          <FontAwesome name={bs.isBalanced ? 'check-circle' : 'exclamation-triangle'} size={16} color="#fff" />
          <Text style={styles.glHeaderText}>
            {bs.isBalanced ? 'Assets = Liabilities + Equity' : 'Balance sheet not balancing — check entries'}
          </Text>
        </View>

        {/* Assets */}
        <View style={styles.bsSection}>
          <Text style={styles.bsSectionTitle}>ASSETS</Text>
          {bs.assets.map((a, i) => (
            <View key={i} style={styles.pnlRow}>
              <Text style={styles.pnlLabel}>{a.name}</Text>
              <Text style={styles.pnlValue}>{Math.round(a.amount).toLocaleString()}</Text>
            </View>
          ))}
          <View style={[styles.pnlRow, styles.pnlSubtotal]}>
            <Text style={styles.pnlBoldLabel}>Total Assets</Text>
            <Text style={styles.pnlBoldValue}>{fmt(bs.totalAssets)}</Text>
          </View>
        </View>

        {/* Liabilities */}
        <View style={styles.bsSection}>
          <Text style={styles.bsSectionTitle}>LIABILITIES</Text>
          {bs.liabilities.map((a, i) => (
            <View key={i} style={styles.pnlRow}>
              <Text style={styles.pnlLabel}>{a.name}</Text>
              <Text style={styles.pnlValue}>{Math.round(a.amount).toLocaleString()}</Text>
            </View>
          ))}
          <View style={[styles.pnlRow, styles.pnlSubtotal]}>
            <Text style={styles.pnlBoldLabel}>Total Liabilities</Text>
            <Text style={styles.pnlBoldValue}>{fmt(bs.totalLiabilities)}</Text>
          </View>
        </View>

        {/* Equity */}
        <View style={styles.bsSection}>
          <Text style={styles.bsSectionTitle}>EQUITY</Text>
          {bs.equity.map((a, i) => (
            <View key={i} style={styles.pnlRow}>
              <Text style={styles.pnlLabel}>{a.name}</Text>
              <Text style={styles.pnlValue}>{Math.round(a.amount).toLocaleString()}</Text>
            </View>
          ))}
          <View style={[styles.pnlRow, styles.pnlSubtotal]}>
            <Text style={styles.pnlBoldLabel}>Total Equity</Text>
            <Text style={styles.pnlBoldValue}>{fmt(bs.totalEquity)}</Text>
          </View>
        </View>

        {trialBalance.length === 0 && !glLoading && (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No journal entries for this period</Text>
          </View>
        )}
      </>
    );
  };

  const renderVatSummary = () => {
    const vat = computeVatSummary(trialBalance);

    return (
      <>
        <Text style={styles.sectionTitle}>VAT Summary</Text>

        <View style={styles.vatCard}>
          <View style={styles.vatRow}>
            <Text style={styles.vatLabel}>Output VAT (collected on sales)</Text>
            <Text style={styles.vatValue}>{fmt(Math.round(vat.outputVat))}</Text>
          </View>
          <View style={styles.vatRow}>
            <Text style={styles.vatLabel}>Input VAT (paid on purchases)</Text>
            <Text style={[styles.vatValue, { color: '#4CAF50' }]}>{fmt(Math.round(vat.inputVat))}</Text>
          </View>
          <View style={[styles.vatRow, { borderTopWidth: 2, borderTopColor: '#0f3460', paddingTop: 12, marginTop: 8 }]}>
            <Text style={[styles.vatLabel, { fontWeight: 'bold', color: '#fff' }]}>Net VAT Payable to URA</Text>
            <Text style={[styles.vatValue, { fontWeight: 'bold', fontSize: 20, color: vat.netPayable >= 0 ? '#e94560' : '#4CAF50' }]}>
              {fmt(Math.round(vat.netPayable))}
            </Text>
          </View>
        </View>

        {vat.netPayable < 0 && (
          <View style={[styles.glHeader, { backgroundColor: '#2d6a4f', marginHorizontal: 16, marginTop: 10 }]}>
            <FontAwesome name="info-circle" size={14} color="#fff" />
            <Text style={styles.glHeaderText}>
              You have a VAT refund claim of {fmt(Math.abs(Math.round(vat.netPayable)))}
            </Text>
          </View>
        )}

        {trialBalance.length === 0 && !glLoading && (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No VAT transactions for this period</Text>
          </View>
        )}
      </>
    );
  };

  const exportCurrentReport = async () => {
    if (trialBalance.length === 0) {
      Alert.alert('No Data', 'No data to export for this period');
      return;
    }

    try {
      const escapeCsv = (val: any) => {
        if (val === null || val === undefined) return '';
        const str = String(val);
        return (str.includes(',') || str.includes('"') || str.includes('\n'))
          ? `"${str.replace(/"/g, '""')}"` : str;
      };
      const toCsvStr = (headers: string[], rows: any[][]) => {
        return [headers.map(escapeCsv).join(','), ...rows.map(r => r.map(escapeCsv).join(','))].join('\n');
      };

      let csv = '';
      let type = '';

      if (activeTab === 'pnl') {
        type = 'PnL';
        const pnl = computePnL(trialBalance);
        const headers = ['Line Item', 'Amount'];
        const rows: any[][] = [
          ['Gross Sales Revenue', pnl.grossRevenue],
          ['Less: Sales Discounts', -pnl.salesDiscount],
          ['Less: Sales Returns', -pnl.salesReturns],
          ['NET REVENUE', pnl.netRevenue],
          [''],
          ['Cost of Goods Sold', -pnl.cogs],
          ['GROSS PROFIT', pnl.grossProfit],
          [''],
          ['Other Income', pnl.otherIncome],
          [''],
          ['OPERATING EXPENSES:', ''],
          ...pnl.operatingExpenses.map(e => [e.name, -e.amount]),
          ['Total Operating Expenses', -pnl.totalOperatingExpenses],
          [''],
          ['NET PROFIT / (LOSS)', pnl.netProfit],
        ];
        csv = toCsvStr(headers, rows);
      } else if (activeTab === 'balance_sheet') {
        type = 'BalanceSheet';
        const bs = computeBalanceSheet(trialBalance);
        const headers = ['Section', 'Account', 'Amount'];
        const rows: any[][] = [
          ...bs.assets.map(a => ['ASSETS', a.name, a.amount]),
          ['ASSETS', 'TOTAL ASSETS', bs.totalAssets],
          [''],
          ...bs.liabilities.map(a => ['LIABILITIES', a.name, a.amount]),
          ['LIABILITIES', 'TOTAL LIABILITIES', bs.totalLiabilities],
          [''],
          ...bs.equity.map(a => ['EQUITY', a.name, a.amount]),
          ['EQUITY', 'TOTAL EQUITY', bs.totalEquity],
          [''],
          ['', bs.isBalanced ? 'BALANCED' : 'NOT BALANCED', ''],
        ];
        csv = toCsvStr(headers, rows);
      } else if (activeTab === 'trial_balance') {
        type = 'TrialBalance';
        const headers = ['Code', 'Account', 'Type', 'Debit', 'Credit', 'Balance'];
        const rows = trialBalance.map(a => [a.code, a.name, a.account_type, a.total_debit, a.total_credit, a.balance]);
        csv = toCsvStr(headers, rows);
      } else if (activeTab === 'vat') {
        type = 'VAT';
        const vat = computeVatSummary(trialBalance);
        const headers = ['Item', 'Amount'];
        const rows: any[][] = [
          ['Output VAT (collected on sales)', vat.outputVat],
          ['Input VAT (paid on purchases)', vat.inputVat],
          ['Net VAT Payable to URA', vat.netPayable],
        ];
        csv = toCsvStr(headers, rows);
      } else {
        Alert.alert('Info', 'Switch to P&L, Balance Sheet, Trial Balance, or VAT tab to export');
        return;
      }

      const filename = `${type}_${periodLabels[period].replace(/\s/g, '_')}_${new Date().toISOString().split('T')[0]}.csv`;
      const file = new File(Paths.cache, filename);
      file.write(csv);

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, { mimeType: 'text/csv', dialogTitle: `Share ${type}` });
      } else {
        Alert.alert('Saved', filename);
      }
    } catch (e: any) {
      Alert.alert('Export Error', e.message);
    }
  };

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#e94560" />}
    >
      {/* Report Tabs */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8, maxHeight: 50 }}>
        <View style={styles.tabRow}>
          {tabs.map(tab => (
            <TouchableOpacity
              key={tab.key}
              style={[styles.tabBtn, activeTab === tab.key && styles.tabBtnActive]}
              onPress={() => setActiveTab(tab.key)}
            >
              <FontAwesome name={tab.icon as any} size={13} color={activeTab === tab.key ? '#fff' : '#aaa'} />
              <Text style={[styles.tabText, activeTab === tab.key && styles.tabTextActive]}>{tab.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      {/* Period Selector */}
      <View style={styles.periodRow}>
        {(['today', 'week', 'month', '3months', '6months', 'year'] as const).map((p) => (
          <TouchableOpacity
            key={p}
            style={[styles.periodBtn, period === p && styles.periodBtnActive]}
            onPress={() => setPeriod(p)}
          >
            <Text style={[styles.periodText, period === p && styles.periodTextActive]}>
              {periodLabels[p]}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {glLoading && activeTab !== 'dashboard' && (
        <View style={{ padding: 20, alignItems: 'center' }}>
          <Text style={{ color: '#aaa' }}>Loading from General Ledger...</Text>
        </View>
      )}

      {activeTab === 'dashboard' && renderDashboard()}
      {activeTab === 'trial_balance' && renderTrialBalance()}
      {activeTab === 'pnl' && renderPnL()}
      {activeTab === 'balance_sheet' && renderBalanceSheet()}
      {activeTab === 'vat' && renderVatSummary()}

      {/* Export button for GL reports */}
      {activeTab !== 'dashboard' && trialBalance.length > 0 && (
        <TouchableOpacity
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#2d6a4f', borderRadius: 12, padding: 14, marginHorizontal: 16, marginTop: 16 }}
          onPress={exportCurrentReport}
        >
          <FontAwesome name="download" size={16} color="#fff" />
          <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 14 }}>Export as CSV</Text>
        </TouchableOpacity>
      )}

      <View style={{ height: 32 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },

  // Tabs
  tabRow: { flexDirection: 'row', gap: 6, paddingHorizontal: 16, paddingVertical: 6, backgroundColor: 'transparent' },
  tabBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: '#16213e', borderWidth: 1, borderColor: '#0f3460' },
  tabBtnActive: { backgroundColor: '#e94560', borderColor: '#e94560' },
  tabText: { color: '#aaa', fontSize: 12, fontWeight: '600' },
  tabTextActive: { color: '#fff' },

  // Role notice
  roleNotice: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#FF980015', borderRadius: 10, marginHorizontal: 16, marginTop: 12, paddingHorizontal: 14, paddingVertical: 10 },
  roleNoticeText: { color: '#FF9800', fontSize: 13 },

  // Period
  periodRow: { flexDirection: 'row', margin: 16, gap: 6, backgroundColor: 'transparent' },
  periodBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: '#16213e', alignItems: 'center', borderWidth: 1, borderColor: '#0f3460' },
  periodBtnActive: { backgroundColor: '#e94560', borderColor: '#e94560' },
  periodText: { color: '#aaa', fontWeight: 'bold' },
  periodTextActive: { color: '#fff' },

  // Dashboard summary
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, gap: 10, backgroundColor: 'transparent' },
  summaryCard: { width: '47%', borderRadius: 14, padding: 14 },
  summaryValue: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  summaryLabel: { color: '#ccc', fontSize: 12, marginTop: 4 },

  sectionTitle: { color: '#fff', fontSize: 16, fontWeight: 'bold', paddingHorizontal: 16, paddingTop: 20, paddingBottom: 10 },

  // Branch cards
  branchCard: { backgroundColor: '#16213e', marginHorizontal: 16, marginBottom: 10, borderRadius: 14, padding: 16 },
  branchHeader: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: 'transparent', marginBottom: 10 },
  branchName: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  branchTx: { color: '#aaa', fontSize: 13 },
  branchStats: { flexDirection: 'row', backgroundColor: 'transparent' },
  branchStat: { flex: 1, backgroundColor: 'transparent' },
  branchStatVal: { color: '#4CAF50', fontSize: 15, fontWeight: 'bold' },
  branchStatLabel: { color: '#aaa', fontSize: 12, marginTop: 2 },

  // Products
  productRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#16213e', marginHorizontal: 16, marginBottom: 8, borderRadius: 12, padding: 14 },
  productRank: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#e94560', justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  rankText: { color: '#fff', fontWeight: 'bold', fontSize: 13 },
  productInfo: { flex: 1, backgroundColor: 'transparent' },
  productName: { color: '#fff', fontSize: 15, fontWeight: 'bold' },
  productQty: { color: '#aaa', fontSize: 12, marginTop: 2 },
  productRevenue: { color: '#4CAF50', fontWeight: 'bold', fontSize: 14 },

  // GL Header (balanced indicator)
  glHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 10, marginHorizontal: 16, marginBottom: 10, paddingHorizontal: 14, paddingVertical: 10 },
  glHeaderText: { color: '#fff', fontSize: 13, fontWeight: '600' },

  // Table
  tableHeader: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#0f3460', backgroundColor: 'transparent' },
  tableHeaderText: { color: '#aaa', fontSize: 12, fontWeight: 'bold' },
  tableRow: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#0f346033', backgroundColor: 'transparent', alignItems: 'center' },
  tableAccName: { color: '#fff', fontSize: 13 },
  tableAccType: { color: '#555', fontSize: 10, textTransform: 'uppercase', marginTop: 2 },
  tableAmount: { color: '#ccc', fontSize: 13 },

  // P&L
  pnlSection: { backgroundColor: '#16213e', marginHorizontal: 16, marginBottom: 10, borderRadius: 14, padding: 16 },
  pnlRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4, backgroundColor: 'transparent' },
  pnlLabel: { color: '#ccc', fontSize: 14 },
  pnlValue: { color: '#fff', fontSize: 14 },
  pnlSubtotal: { borderTopWidth: 1, borderTopColor: '#0f3460', paddingTop: 8, marginTop: 4 },
  pnlBoldLabel: { color: '#fff', fontSize: 14, fontWeight: 'bold' },
  pnlBoldValue: { color: '#fff', fontSize: 15, fontWeight: 'bold' },
  netProfitCard: { marginHorizontal: 16, borderRadius: 14, padding: 20, alignItems: 'center', marginTop: 10 },
  netProfitLabel: { color: '#ccc', fontSize: 13, marginBottom: 4 },
  netProfitValue: { color: '#fff', fontSize: 24, fontWeight: 'bold' },

  // Balance Sheet
  bsSection: { backgroundColor: '#16213e', marginHorizontal: 16, marginBottom: 10, borderRadius: 14, padding: 16 },
  bsSectionTitle: { color: '#e94560', fontSize: 14, fontWeight: 'bold', marginBottom: 8 },

  // VAT
  vatCard: { backgroundColor: '#16213e', marginHorizontal: 16, borderRadius: 14, padding: 16 },
  vatRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6, backgroundColor: 'transparent' },
  vatLabel: { color: '#ccc', fontSize: 14 },
  vatValue: { color: '#fff', fontSize: 16, fontWeight: 'bold' },

  // Empty
  empty: { alignItems: 'center', paddingTop: 60 },
  emptyText: { color: '#555', fontSize: 16, marginTop: 12 },
});
