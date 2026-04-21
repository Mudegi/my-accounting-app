import React, { useEffect, useState } from 'react';
import {
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { Text, View } from '@/components/Themed';
import { useLocalSearchParams, useRouter } from 'expo-router';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';

type SaleDetail = {
  id: string;
  total_amount: number;
  subtotal: number;
  tax_amount: number;
  discount_amount: number;
  payment_method: string;
  status: string;
  is_fiscalized: boolean;
  efris_fdn: string | null;
  invoice_number: string | null;
  buyer_type: string | null;
  customer_name: string | null;
  customer_tin: string | null;
  created_at: string;
  seller_name: string;
  branch_name: string;
  efris_status: string;
  efris_error: string | null;
};

type SaleItemRow = {
  id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  cost_price: number;
  tax_rate: number;
  discount_amount: number;
  line_total: number;
};

const PAYMENT_LABELS: Record<string, string> = {
  cash: 'Cash', mobile_money: 'Mobile Money', card: 'Card', credit: 'Credit',
  '101': 'Cash', '102': 'Credit', '103': 'Cheque', '104': 'Mobile Money', '105': 'Visa/MasterCard',
};

const BUYER_LABELS: Record<string, string> = {
  '0': 'B2B', '1': 'B2C', '2': 'Foreigner', '3': 'B2G',
};

export default function SaleDetailScreen() {
  const { saleId } = useLocalSearchParams<{ saleId: string }>();
  const { business, profile, fmt } = useAuth();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [sale, setSale] = useState<SaleDetail | null>(null);
  const [items, setItems] = useState<SaleItemRow[]>([]);

  useEffect(() => {
    if (saleId) loadSale();
  }, [saleId]);

  const loadSale = async () => {
    try {
      const { data: saleData, error } = await supabase
        .from('sales')
        .select('*')
        .eq('id', saleId)
        .single();

      if (error) throw error;

      // Fetch seller name separately (FK points to auth.users, not profiles)
      let sellerName = '?';
      if (saleData.seller_id) {
        const { data: seller } = await supabase
          .from('profiles')
          .select('full_name')
          .eq('id', saleData.seller_id)
          .single();
        if (seller) sellerName = seller.full_name;
      }

      // Fetch branch name separately
      let branchName = '?';
      if (saleData.branch_id) {
        const { data: branch } = await supabase
          .from('branches')
          .select('name')
          .eq('id', saleData.branch_id)
          .single();
        if (branch) branchName = branch.name;
      }

      setSale({
        id: saleData.id,
        total_amount: Number(saleData.total_amount),
        subtotal: Number(saleData.subtotal || 0),
        tax_amount: Number(saleData.tax_amount || 0),
        discount_amount: Number(saleData.discount_amount || 0),
        payment_method: saleData.payment_method || 'cash',
        status: saleData.status,
        is_fiscalized: saleData.is_fiscalized || false,
        efris_fdn: saleData.efris_fdn || null,
        invoice_number: saleData.invoice_number || null,
        buyer_type: saleData.buyer_type || null,
        customer_name: saleData.customer_name || null,
        customer_tin: saleData.customer_tin || null,
        created_at: saleData.created_at,
        seller_name: sellerName,
        branch_name: branchName,
        efris_status: saleData.efris_status || 'not_required',
        efris_error: saleData.efris_error || null,
      });

      const { data: itemsData } = await supabase
        .from('sale_items')
        .select('id, product_name, quantity, unit_price, cost_price, tax_rate, discount_amount, line_total')
        .eq('sale_id', saleId)
        .order('created_at');

      if (itemsData) {
        setItems(itemsData.map((i: any) => ({
          id: i.id,
          product_name: i.product_name,
          quantity: i.quantity,
          unit_price: Number(i.unit_price),
          cost_price: Number(i.cost_price || 0),
          tax_rate: Number(i.tax_rate || 0),
          discount_amount: Number(i.discount_amount || 0),
          line_total: Number(i.line_total),
        })));
      }
    } catch (e: any) {
      console.error('Error loading sale:', e);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator color="#e94560" size="large" style={{ marginTop: 60 }} />
      </View>
    );
  }

  if (!sale) {
    return (
      <View style={styles.container}>
        <View style={styles.empty}>
          <FontAwesome name="exclamation-triangle" size={48} color="#e94560" />
          <Text style={styles.emptyText}>Sale not found</Text>
        </View>
      </View>
    );
  }

  const grossProfit = items.reduce((sum, i) => sum + (i.unit_price - i.cost_price) * i.quantity, 0);
  const isAdmin = profile?.role === 'admin';
  const formatDate = (d: string) => new Date(d).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  return (
    <ScrollView style={styles.container}>
      {/* Header Card */}
      <View style={styles.headerCard}>
        <View style={styles.headerTop}>
          <Text style={styles.totalAmount}>{fmt(sale.total_amount)}</Text>
          <View style={[
            styles.statusBadge,
            sale.status === 'completed' ? styles.badgeCompleted : styles.badgeVoided,
          ]}>
            <Text style={styles.statusText}>{sale.status}</Text>
          </View>
        </View>
        <Text style={styles.headerDate}>{formatDate(sale.created_at)}</Text>
        <Text style={styles.headerMeta}>📍 {sale.branch_name} · 👤 {sale.seller_name}</Text>
        {sale.customer_name && (
          <Text style={styles.headerMeta}>🧾 Customer: {sale.customer_name}{sale.customer_tin ? ` (TIN: ${sale.customer_tin})` : ''}</Text>
        )}
      </View>

      {/* EFRIS Info */}
      {sale.is_fiscalized && (
        <View style={styles.efrisCard}>
          <Text style={styles.efrisTitle}>✅ EFRIS Fiscalized</Text>
          {sale.invoice_number && <Text style={styles.efrisRow}>Invoice: {sale.invoice_number}</Text>}
          {sale.efris_fdn && <Text style={styles.efrisRow}>FDN: {sale.efris_fdn}</Text>}
          {sale.buyer_type && <Text style={styles.efrisRow}>Buyer Type: {BUYER_LABELS[sale.buyer_type] || sale.buyer_type}</Text>}
        </View>
      )}

      {/* Items */}
      <Text style={styles.sectionTitle}>Items ({items.length})</Text>
      {items.map((item, idx) => (
        <View key={item.id} style={styles.itemCard}>
          <View style={styles.itemHeader}>
            <Text style={styles.itemName}>{idx + 1}. {item.product_name}</Text>
            <Text style={styles.itemTotal}>{fmt(item.line_total)}</Text>
          </View>
          <View style={styles.itemDetails}>
            <Text style={styles.itemDetailText}>
              {item.quantity} × {fmt(item.unit_price)}
            </Text>
            {item.tax_rate > 0 && (
              <Text style={styles.itemTaxBadge}>Tax: {item.tax_rate}%</Text>
            )}
            {item.discount_amount > 0 && (
              <Text style={styles.itemDiscBadge}>-{fmt(item.discount_amount)}</Text>
            )}
          </View>
          {isAdmin && item.cost_price > 0 && (
            <Text style={styles.itemCost}>
              Cost: {fmt(item.cost_price)} · Margin: {fmt((item.unit_price - item.cost_price) * item.quantity)}
            </Text>
          )}
        </View>
      ))}

      {/* Totals Breakdown */}
      <View style={styles.totalsCard}>
        <Text style={styles.sectionTitle}>Breakdown</Text>
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Subtotal</Text>
          <Text style={styles.totalValue}>{fmt(sale.subtotal)}</Text>
        </View>
        {sale.discount_amount > 0 && (
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Discount</Text>
            <Text style={[styles.totalValue, { color: '#FF9800' }]}>-{fmt(sale.discount_amount)}</Text>
          </View>
        )}
        {sale.tax_amount > 0 && (
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Tax (VAT)</Text>
            <Text style={styles.totalValue}>{fmt(sale.tax_amount)}</Text>
          </View>
        )}
        <View style={[styles.totalRow, styles.totalRowFinal]}>
          <Text style={styles.totalFinalLabel}>Total Paid</Text>
          <Text style={styles.totalFinalValue}>{fmt(sale.total_amount)}</Text>
        </View>
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Payment</Text>
          <Text style={styles.totalValue}>{PAYMENT_LABELS[sale.payment_method] || sale.payment_method}</Text>
        </View>
        {isAdmin && (
          <View style={[styles.totalRow, { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#0f3460' }]}>
            <Text style={styles.totalLabel}>Gross Profit</Text>
            <Text style={[styles.totalValue, { color: grossProfit >= 0 ? '#4CAF50' : '#e94560', fontWeight: 'bold' }]}>
              {fmt(grossProfit)}
            </Text>
          </View>
        )}
      </View>

      {/* Actions */}
      <View style={styles.actions}>
        <TouchableOpacity 
          style={styles.actionBtn}
          onPress={() => router.push({ pathname: '/receipt', params: { saleId: sale.id } })}
        >
          <FontAwesome name="print" size={18} color="#fff" />
          <Text style={styles.actionText}>Print / Share Receipt</Text>
        </TouchableOpacity>

        {/* Fiscalize Button for non-submitted sales */}
        {sale.efris_status !== 'submitted' && business?.is_efris_enabled && (
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: '#4CAF50', marginTop: 12 }]}
            onPress={() => router.push({ pathname: '/fiscalize-sale' as any, params: { saleId: sale.id } })}
          >
            <FontAwesome name="paper-plane" size={18} color="#fff" />
            <Text style={styles.actionText}>Modify & Submit to EFRIS</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Sale ID */}
      <Text style={styles.saleIdText}>Sale ID: {sale.id}</Text>

      <View style={{ height: 32 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  headerCard: { backgroundColor: '#16213e', margin: 16, borderRadius: 16, padding: 18 },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'transparent' },
  totalAmount: { color: '#fff', fontSize: 28, fontWeight: 'bold' },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  badgeCompleted: { backgroundColor: '#2d6a4f' },
  badgeVoided: { backgroundColor: '#e94560' },
  statusText: { color: '#fff', fontSize: 12, fontWeight: 'bold', textTransform: 'capitalize' },
  headerDate: { color: '#aaa', fontSize: 14, marginTop: 8 },
  headerMeta: { color: '#888', fontSize: 13, marginTop: 4 },
  efrisCard: { backgroundColor: '#4CAF5015', marginHorizontal: 16, marginBottom: 16, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#4CAF5033' },
  efrisTitle: { color: '#4CAF50', fontSize: 15, fontWeight: 'bold', marginBottom: 6 },
  efrisRow: { color: '#ccc', fontSize: 13, marginTop: 2 },
  sectionTitle: { color: '#fff', fontSize: 16, fontWeight: 'bold', paddingHorizontal: 16, paddingBottom: 10 },
  itemCard: { backgroundColor: '#16213e', marginHorizontal: 16, marginBottom: 8, borderRadius: 12, padding: 14 },
  itemHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'transparent' },
  itemName: { color: '#fff', fontSize: 15, fontWeight: '600', flex: 1, marginRight: 8 },
  itemTotal: { color: '#4CAF50', fontSize: 15, fontWeight: 'bold' },
  itemDetails: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4, backgroundColor: 'transparent' },
  itemDetailText: { color: '#aaa', fontSize: 13 },
  itemTaxBadge: { color: '#7C3AED', fontSize: 11, backgroundColor: '#7C3AED18', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  itemDiscBadge: { color: '#FF9800', fontSize: 11, backgroundColor: '#FF980018', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  itemCost: { color: '#555', fontSize: 11, marginTop: 4 },
  totalsCard: { backgroundColor: '#16213e', marginHorizontal: 16, marginTop: 8, marginBottom: 16, borderRadius: 14, padding: 16 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: 'transparent', paddingVertical: 4 },
  totalLabel: { color: '#aaa', fontSize: 14 },
  totalValue: { color: '#fff', fontSize: 14 },
  totalRowFinal: { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#0f3460' },
  totalFinalLabel: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  totalFinalValue: { color: '#4CAF50', fontSize: 16, fontWeight: 'bold' },
  actions: { paddingHorizontal: 16, marginBottom: 16, backgroundColor: 'transparent' },
  actionBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#e94560', borderRadius: 12, padding: 14, gap: 10 },
  actionText: { color: '#fff', fontWeight: 'bold', fontSize: 15 },
  saleIdText: { color: '#555', fontSize: 11, textAlign: 'center', marginBottom: 8 },
  empty: { alignItems: 'center', paddingTop: 60 },
  emptyText: { color: '#555', fontSize: 16, marginTop: 12 },
});
