import React, { useState, useCallback } from 'react';
import {
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from 'react-native';
import { Text, View } from '@/components/Themed';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import {
  getTrialBalance,
  computePnL,
  computeVatSummary,
  type AccountBalance,
} from '@/lib/accounting';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

type TaxPeriod = 'month' | '3months' | '6months' | 'year';

export default function TaxCenterScreen() {
  const { business, currentBranch, profile, fmt, currency } = useAuth();
  const router = useRouter();
  const isAdmin = profile?.role === 'admin';
  const efrisEnabled = business?.is_efris_enabled ?? false;

  const [period, setPeriod] = useState<TaxPeriod>('month');
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Tax data
  const [trialBalance, setTrialBalance] = useState<AccountBalance[]>([]);
  const [totalSales, setTotalSales] = useState(0);
  const [totalOutputVat, setTotalOutputVat] = useState(0);
  const [totalInputVat, setTotalInputVat] = useState(0);
  const [creditNoteVat, setCreditNoteVat] = useState(0);
  const [unfiscalizedCount, setUnfiscalizedCount] = useState(0);
  const [missingTinCount, setMissingTinCount] = useState(0);
  const [filingDeadline, setFilingDeadline] = useState('');
  const [vatReturnMonth, setVatReturnMonth] = useState('');

  const getDateRange = () => {
    const now = new Date();
    switch (period) {
      case 'month': { const d = new Date(now); d.setDate(1); return d.toISOString().split('T')[0]; }
      case '3months': { const d = new Date(now); d.setMonth(d.getMonth() - 3); return d.toISOString().split('T')[0]; }
      case '6months': { const d = new Date(now); d.setMonth(d.getMonth() - 6); return d.toISOString().split('T')[0]; }
      case 'year': { return new Date(now.getFullYear(), 0, 1).toISOString().split('T')[0]; }
    }
  };

  const load = useCallback(async () => {
    if (!business) return;
    setLoading(true);

    try {
      const fromDate = getDateRange();
      const toDate = new Date().toISOString().split('T')[0];

      // VAT filing deadline: 15th of next month
      const now = new Date();
      const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 15);
      setFilingDeadline(nextMonth.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }));
      setVatReturnMonth(now.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }));

      // Load trial balance for P&L and VAT
      const tb = await getTrialBalance({
        businessId: business.id,
        fromDate,
        toDate,
      });
      setTrialBalance(tb);

      // Total sales in period
      let salesQuery = supabase
        .from('sales')
        .select('total_amount, tax_amount, is_fiscalized, customer_tin')
        .eq('business_id', business.id)
        .eq('status', 'completed')
        .gte('created_at', fromDate + 'T00:00:00');

      if (!isAdmin && currentBranch) salesQuery = salesQuery.eq('branch_id', currentBranch.id);

      const { data: sales } = await salesQuery;

      let totalSalesAmt = 0, totalOutVat = 0, unfiscalized = 0, missingTin = 0;
      sales?.forEach((s: any) => {
        totalSalesAmt += Number(s.total_amount);
        totalOutVat += Number(s.tax_amount || 0);
        if (!s.is_fiscalized) unfiscalized++;
        if (!s.customer_tin && Number(s.tax_amount) > 0) missingTin++;
      });
      setTotalSales(totalSalesAmt);
      setTotalOutputVat(totalOutVat);
      setUnfiscalizedCount(unfiscalized);
      setMissingTinCount(missingTin);

      // Input VAT from purchases
      let purchasesQuery = supabase
        .from('purchases')
        .select('vat_amount')
        .eq('business_id', business.id)
        .gte('purchase_date', fromDate);

      if (!isAdmin && currentBranch) purchasesQuery = purchasesQuery.eq('branch_id', currentBranch.id);

      const { data: purchases } = await purchasesQuery;
      const totalInVat = purchases?.reduce((s: number, p: any) => s + Number(p.vat_amount || 0), 0) || 0;
      setTotalInputVat(totalInVat);

      // Credit note VAT adjustment
      let cnQuery = supabase
        .from('credit_notes')
        .select('total_amount, original_sale_id')
        .eq('business_id', business.id)
        .gte('created_at', fromDate + 'T00:00:00');

      const { data: creditNotes } = await cnQuery;
      // Estimate 18% VAT on credit notes (simplified)
      const estCnVat = creditNotes?.reduce((s: number, cn: any) =>
        s + Number(cn.total_amount) * 0.18 / 1.18, 0) || 0;
      setCreditNoteVat(Math.round(estCnVat));

    } catch (e) {
      console.error('Tax center load error:', e);
    }
    setLoading(false);
  }, [business, currentBranch, period, isAdmin]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const pnl = trialBalance.length > 0 ? computePnL(trialBalance) : null;
  const vat = trialBalance.length > 0 ? computeVatSummary(trialBalance) : null;
  const adjustedOutputVat = totalOutputVat - creditNoteVat;
  const netVatPayable = adjustedOutputVat - totalInputVat;
  const taxableIncome = Math.max(0, pnl?.netProfit || 0);
  const estimatedTax30 = Math.round(taxableIncome * 0.30);
  const presumptiveTax = Math.round(totalSales * 0.01);

  const periodLabels: Record<TaxPeriod, string> = {
    month: 'This Month', '3months': '3 Months', '6months': '6 Months', year: 'This Year',
  };

  // Health check items
  const healthChecks = [
    {
      label: 'Business TIN',
      ok: !!business?.tin,
      detail: business?.tin || 'Not Set — Required for URA filing',
      icon: 'id-card',
    },
    {
      label: 'EFRIS Enabled',
      ok: business?.is_efris_enabled,
      detail: business?.is_efris_enabled ? 'Connected' : 'Not enabled — Pro plan required',
      icon: 'plug',
    },
    {
      label: 'Unfiscalized Sales',
      ok: unfiscalizedCount === 0,
      detail: unfiscalizedCount === 0 ? 'All sales submitted to EFRIS' : `${unfiscalizedCount} sales not yet submitted`,
      icon: 'exclamation-circle',
    },
    {
      label: 'B2B Sales Missing TIN',
      ok: missingTinCount === 0,
      detail: missingTinCount === 0 ? 'All taxable sales have customer TIN' : `${missingTinCount} taxable sales without customer TIN`,
      icon: 'user-circle',
    },
  ];

  const complianceScore = healthChecks.filter(h => h.ok).length;
  const compliancePercent = Math.round((complianceScore / healthChecks.length) * 100);

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#e94560" />}
      >
        {/* Header */}
        <Text style={styles.heading}>🏛️ Tax Center</Text>
        <Text style={styles.subheading}>
          {efrisEnabled
            ? 'Your tax compliance dashboard for URA — VAT, Income Tax, and EFRIS'
            : 'Your tax compliance dashboard — VAT and Income Tax'}
        </Text>

        {/* Period Selector */}
        <View style={styles.periodRow}>
          {(['month', '3months', '6months', 'year'] as const).map(p => (
            <TouchableOpacity
              key={p}
              style={[styles.periodBtn, period === p && styles.periodBtnActive]}
              onPress={() => setPeriod(p)}
            >
              <Text style={[styles.periodText, period === p && { color: '#fff' }]}>
                {periodLabels[p]}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {loading ? (
          <ActivityIndicator size="large" color="#e94560" style={{ marginTop: 40 }} />
        ) : (
          <>
            {/* === Compliance Health Check === */}
            {efrisEnabled && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>📋 Tax Compliance Health</Text>
                <View style={[styles.scoreCard, {
                  backgroundColor: compliancePercent === 100 ? '#2d6a4f' : compliancePercent >= 50 ? '#E65100' : '#8B1A1A'
                }]}>
                  <Text style={styles.scoreValue}>{compliancePercent}%</Text>
                  <Text style={styles.scoreLabel}>
                    {compliancePercent === 100 ? 'Fully Compliant' : compliancePercent >= 50 ? 'Needs Attention' : 'Action Required'}
                  </Text>
                </View>

                {healthChecks.map((h, i) => (
                  <View key={i} style={styles.healthRow}>
                    <FontAwesome
                      name={h.ok ? 'check-circle' : 'times-circle'}
                      size={18}
                      color={h.ok ? '#4CAF50' : '#e94560'}
                    />
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <Text style={styles.healthLabel}>{h.label}</Text>
                      <Text style={[styles.healthDetail, !h.ok && { color: '#FF9800' }]}>{h.detail}</Text>
                    </View>
                  </View>
                ))}
              </View>
            )}

            {/* === VAT Summary === */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>💰 VAT Summary</Text>
              <View style={styles.deadlineRow}>
                <FontAwesome name="calendar" size={14} color="#FF9800" />
                <Text style={styles.deadlineText}>
                  Filing deadline for {vatReturnMonth}: <Text style={{ fontWeight: 'bold', color: '#fff' }}>{filingDeadline}</Text>
                </Text>
              </View>

              <View style={styles.vatCard}>
                <View style={styles.vatRow}>
                  <Text style={styles.vatLabel}>Output VAT (collected)</Text>
                  <Text style={styles.vatValue}>{fmt(Math.round(totalOutputVat))}</Text>
                </View>

                {creditNoteVat > 0 && (
                  <View style={styles.vatRow}>
                    <Text style={styles.vatLabel}>Less: Credit Note Adjustments</Text>
                    <Text style={[styles.vatValue, { color: '#4CAF50' }]}>-{fmt(creditNoteVat)}</Text>
                  </View>
                )}

                <View style={styles.vatRow}>
                  <Text style={styles.vatLabel}>Adjusted Output VAT</Text>
                  <Text style={styles.vatValue}>{fmt(Math.round(adjustedOutputVat))}</Text>
                </View>

                <View style={styles.vatRow}>
                  <Text style={styles.vatLabel}>Input VAT (claimable)</Text>
                  <Text style={[styles.vatValue, { color: '#4CAF50' }]}>-{fmt(Math.round(totalInputVat))}</Text>
                </View>

                <View style={[styles.vatRow, styles.netRow]}>
                  <Text style={[styles.vatLabel, { fontWeight: 'bold', color: '#fff', fontSize: 15 }]}>
                    Net VAT Payable to URA
                  </Text>
                  <Text style={[styles.vatValue, {
                    fontWeight: 'bold', fontSize: 20,
                    color: netVatPayable >= 0 ? '#e94560' : '#4CAF50'
                  }]}>
                    {fmt(Math.round(netVatPayable))}
                  </Text>
                </View>
              </View>

              {netVatPayable < 0 && (
                <View style={styles.refundNotice}>
                  <FontAwesome name="info-circle" size={14} color="#4CAF50" />
                  <Text style={styles.refundText}>You have a VAT refund claim of {fmt(Math.abs(Math.round(netVatPayable)))}</Text>
                </View>
              )}
            </View>

            {/* === Income Tax Estimate === */}
            {pnl && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>📊 Income Tax Estimate</Text>

                <View style={styles.incomeCard}>
                  <View style={styles.incomeRow}>
                    <Text style={styles.incomeLabel}>Total Revenue</Text>
                    <Text style={styles.incomeValue}>{fmt(Math.round(pnl.netRevenue))}</Text>
                  </View>
                  <View style={styles.incomeRow}>
                    <Text style={styles.incomeLabel}>Cost of Goods Sold</Text>
                    <Text style={[styles.incomeValue, { color: '#e94560' }]}>-{fmt(Math.round(pnl.cogs))}</Text>
                  </View>
                  <View style={styles.incomeRow}>
                    <Text style={styles.incomeLabel}>Operating Expenses</Text>
                    <Text style={[styles.incomeValue, { color: '#e94560' }]}>-{fmt(Math.round(pnl.totalOperatingExpenses))}</Text>
                  </View>
                  <View style={[styles.incomeRow, styles.netRow]}>
                    <Text style={[styles.incomeLabel, { fontWeight: 'bold', color: '#fff' }]}>Net Profit</Text>
                    <Text style={[styles.incomeValue, {
                      fontWeight: 'bold',
                      color: pnl.netProfit >= 0 ? '#4CAF50' : '#e94560'
                    }]}>
                      {fmt(Math.round(pnl.netProfit))}
                    </Text>
                  </View>
                </View>

                <View style={styles.taxEstCards}>
                  <View style={styles.taxEstCard}>
                    <Text style={styles.taxEstTitle}>Corporate Tax (30%)</Text>
                    <Text style={styles.taxEstAmount}>{fmt(estimatedTax30)}</Text>
                    <Text style={styles.taxEstNote}>For companies & registered businesses</Text>
                  </View>
                  <View style={styles.taxEstCard}>
                    <Text style={styles.taxEstTitle}>Presumptive Tax (1%)</Text>
                    <Text style={styles.taxEstAmount}>{fmt(presumptiveTax)}</Text>
                    <Text style={styles.taxEstNote}>For turnover below UGX 150M/year</Text>
                  </View>
                </View>
              </View>
            )}

            {/* === Quick Actions === */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>⚡ Tax Actions</Text>

              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: '#2d6a4f' }]}
                onPress={() => router.push('/export' as any)}
              >
                <FontAwesome name="file-text" size={18} color="#fff" />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={styles.actionTitle}>Export VAT Report</Text>
                  <Text style={styles.actionDesc}>CSV with {efrisEnabled ? 'TINs, ' : ''}invoice numbers, credit note adjustments — ready for your accountant</Text>
                </View>
                <FontAwesome name="chevron-right" size={14} color="#aaa" />
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: '#0f3460' }]}
                onPress={() => router.push('/export' as any)}
              >
                <FontAwesome name="university" size={18} color="#fff" />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={styles.actionTitle}>Export Income Tax Report</Text>
                  <Text style={styles.actionDesc}>P&L with estimated tax liability and quarterly installments</Text>
                </View>
                <FontAwesome name="chevron-right" size={14} color="#aaa" />
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: '#16213e' }]}
                onPress={() => router.push('/reports')}
              >
                <FontAwesome name="bar-chart" size={18} color="#fff" />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={styles.actionTitle}>Full Financial Reports</Text>
                  <Text style={styles.actionDesc}>Trial Balance, P&L, Balance Sheet, VAT Summary</Text>
                </View>
                <FontAwesome name="chevron-right" size={14} color="#aaa" />
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: '#16213e' }]}
                onPress={() => router.push('/credit-note')}
              >
                <FontAwesome name="undo" size={18} color="#fff" />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={styles.actionTitle}>Credit Notes / Returns</Text>
                  <Text style={styles.actionDesc}>Process returns — VAT is automatically reversed</Text>
                </View>
                <FontAwesome name="chevron-right" size={14} color="#aaa" />
              </TouchableOpacity>
            </View>

            {/* === URA Deadlines === */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>📅 URA Filing Deadlines</Text>
              <View style={styles.deadlineCard}>
                <View style={styles.deadlineItem}>
                  <FontAwesome name="calendar-check-o" size={16} color="#FF9800" />
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={styles.deadlineItemTitle}>VAT Return</Text>
                    <Text style={styles.deadlineItemDate}>15th of every month (for previous month)</Text>
                  </View>
                </View>
                <View style={styles.deadlineItem}>
                  <FontAwesome name="calendar-check-o" size={16} color="#FF9800" />
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={styles.deadlineItemTitle}>PAYE</Text>
                    <Text style={styles.deadlineItemDate}>15th of every month</Text>
                  </View>
                </View>
                <View style={styles.deadlineItem}>
                  <FontAwesome name="calendar-check-o" size={16} color="#FF9800" />
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={styles.deadlineItemTitle}>Quarterly Income Tax</Text>
                    <Text style={styles.deadlineItemDate}>30 Jun, 30 Sep, 31 Dec, 31 Mar</Text>
                  </View>
                </View>
                <View style={styles.deadlineItem}>
                  <FontAwesome name="calendar-check-o" size={16} color="#e94560" />
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={styles.deadlineItemTitle}>Annual Income Tax Return</Text>
                    <Text style={styles.deadlineItemDate}>30 June (for previous financial year)</Text>
                  </View>
                </View>
                <View style={styles.deadlineItem}>
                  <FontAwesome name="calendar-check-o" size={16} color="#FF9800" />
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={styles.deadlineItemTitle}>Withholding Tax</Text>
                    <Text style={styles.deadlineItemDate}>15th of the following month</Text>
                  </View>
                </View>
              </View>
            </View>

            {/* Footer tip */}
            <View style={styles.tip}>
              <FontAwesome name="lightbulb-o" size={16} color="#FFD700" />
              <Text style={styles.tipText}>
                <Text style={{ fontWeight: 'bold' }}>Tip:</Text> Export your VAT and Income Tax reports regularly. 
                Share them with your accountant via WhatsApp or Email to stay on top of your tax obligations.
                {efrisEnabled ? ' EFRIS integration (Pro plan) automatically submits invoices to URA in real-time.' : ''}
              </Text>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  scroll: { padding: 16, paddingBottom: 40 },
  heading: { fontSize: 22, fontWeight: 'bold', color: '#fff' },
  subheading: { fontSize: 14, color: '#aaa', marginTop: 4, lineHeight: 20 },

  periodRow: { flexDirection: 'row', gap: 8, marginTop: 16 },
  periodBtn: {
    flex: 1, paddingVertical: 10, borderRadius: 12, alignItems: 'center',
    backgroundColor: '#16213e', borderWidth: 1, borderColor: '#0f3460',
  },
  periodBtnActive: { backgroundColor: '#e94560', borderColor: '#e94560' },
  periodText: { fontSize: 13, color: '#aaa', fontWeight: '600' },

  section: { marginTop: 24 },
  sectionTitle: { fontSize: 16, fontWeight: 'bold', color: '#fff', marginBottom: 10 },

  // Compliance score
  scoreCard: {
    borderRadius: 12, padding: 16, alignItems: 'center', marginBottom: 12,
  },
  scoreValue: { fontSize: 36, fontWeight: 'bold', color: '#fff' },
  scoreLabel: { fontSize: 14, color: '#ddd', marginTop: 4 },

  healthRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#16213e',
    borderRadius: 10, padding: 14, marginBottom: 6,
    borderWidth: 1, borderColor: '#0f3460',
  },
  healthLabel: { fontSize: 14, fontWeight: 'bold', color: '#fff' },
  healthDetail: { fontSize: 12, color: '#aaa', marginTop: 2 },

  // VAT card
  deadlineRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#FF980015', borderRadius: 10, padding: 12, marginBottom: 12,
  },
  deadlineText: { fontSize: 13, color: '#FF9800', flex: 1 },

  vatCard: {
    backgroundColor: '#16213e', borderRadius: 12, padding: 16,
    borderWidth: 1, borderColor: '#0f3460',
  },
  vatRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 8,
  },
  vatLabel: { fontSize: 14, color: '#aaa', flex: 1 },
  vatValue: { fontSize: 16, fontWeight: 'bold', color: '#fff' },
  netRow: {
    borderTopWidth: 2, borderTopColor: '#0f3460', paddingTop: 12, marginTop: 4,
  },
  refundNotice: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#2d6a4f30', borderRadius: 10, padding: 12, marginTop: 8,
  },
  refundText: { fontSize: 13, color: '#4CAF50' },

  // Income tax
  incomeCard: {
    backgroundColor: '#16213e', borderRadius: 12, padding: 16,
    borderWidth: 1, borderColor: '#0f3460',
  },
  incomeRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 6,
  },
  incomeLabel: { fontSize: 14, color: '#aaa' },
  incomeValue: { fontSize: 15, fontWeight: 'bold', color: '#fff' },

  taxEstCards: { flexDirection: 'row', gap: 10, marginTop: 12 },
  taxEstCard: {
    flex: 1, backgroundColor: '#16213e', borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: '#0f3460', alignItems: 'center',
  },
  taxEstTitle: { fontSize: 13, fontWeight: 'bold', color: '#ccc' },
  taxEstAmount: { fontSize: 20, fontWeight: 'bold', color: '#e94560', marginTop: 6 },
  taxEstNote: { fontSize: 10, color: '#666', marginTop: 4, textAlign: 'center' },

  // Actions
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', borderRadius: 12, padding: 16,
    marginBottom: 8, borderWidth: 1, borderColor: '#0f3460',
  },
  actionTitle: { fontSize: 15, fontWeight: 'bold', color: '#fff' },
  actionDesc: { fontSize: 12, color: '#aaa', marginTop: 2, lineHeight: 16 },

  // Deadlines
  deadlineCard: {
    backgroundColor: '#16213e', borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: '#0f3460',
  },
  deadlineItem: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: '#0f346030',
  },
  deadlineItemTitle: { fontSize: 14, fontWeight: 'bold', color: '#fff' },
  deadlineItemDate: { fontSize: 12, color: '#aaa', marginTop: 2 },

  // Tip
  tip: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: '#16213e', borderRadius: 12, padding: 14, marginTop: 24,
    borderWidth: 1, borderColor: '#0f3460',
  },
  tipText: { fontSize: 13, color: '#aaa', flex: 1, lineHeight: 20 },
});
