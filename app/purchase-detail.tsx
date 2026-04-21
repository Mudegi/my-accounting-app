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
import { submitStockIncrease, type EfrisConfig } from '@/lib/efris';
import { Alert } from 'react-native';

type PurchaseDetail = {
  id: string;
  supplier_name: string | null;
  supplier_tin: string | null;
  total_amount: number;
  subtotal_amount: number;
  vat_amount: number;
  notes: string | null;
  efris_submitted: boolean;
  efris_submitted_at: string | null;
  created_at: string;
  created_by_name: string;
  branch_name: string;
};

type PurchaseItemRow = {
  id: string;
  product_name: string;
  quantity: number;
  unit_cost: number;
  line_total: number;
  tax_rate: number;
  tax_amount: number;
  tax_category: string;
  efris_product_code?: string | null;
};

export default function PurchaseDetailScreen() {
  const { purchaseId } = useLocalSearchParams<{ purchaseId: string }>();
  const { business, profile, fmt } = useAuth();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [purchase, setPurchase] = useState<PurchaseDetail | null>(null);
  const [items, setItems] = useState<PurchaseItemRow[]>([]);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    if (purchaseId) loadPurchase();
  }, [purchaseId]);

  const loadPurchase = async () => {
    try {
      const { data, error } = await supabase
        .from('purchases')
        .select('*')
        .eq('id', purchaseId)
        .single();

      if (error) throw error;

      // Fetch creator name separately (FK points to auth.users, not profiles)
      let createdByName = '?';
      if ((data as any).created_by) {
        const { data: creator } = await supabase
          .from('profiles')
          .select('full_name')
          .eq('id', (data as any).created_by)
          .single();
        if (creator) createdByName = creator.full_name;
      }

      // Fetch branch name separately
      let branchName = '?';
      if (data.branch_id) {
        const { data: branch } = await supabase
          .from('branches')
          .select('name')
          .eq('id', data.branch_id)
          .single();
        if (branch) branchName = branch.name;
      }

      setPurchase({
        id: data.id,
        supplier_name: data.supplier_name || null,
        supplier_tin: (data as any).supplier_tin || null,
        total_amount: Number(data.total_amount),
        subtotal_amount: Number(data.subtotal_amount || data.total_amount),
        vat_amount: Number(data.vat_amount || 0),
        notes: data.notes || null,
        efris_submitted: (data as any).efris_submitted || false,
        efris_submitted_at: (data as any).efris_submitted_at || null,
        created_at: data.created_at,
        created_by_name: createdByName,
        branch_name: branchName,
      });

      // Load items with product info via join
      const { data: itemsData } = await supabase
        .from('purchase_items')
        .select(`
          id, quantity, unit_cost, line_total, product_id,
          tax_rate, tax_amount, tax_category_code,
          products(name, efris_product_code)
        `)
        .eq('purchase_id', purchaseId)
        .order('created_at');

      if (itemsData) {
        setItems(itemsData.map((i: any) => ({
          id: i.id,
          product_id: i.product_id,
          product_name: i.products?.name || 'Unknown Product',
          efris_product_code: i.products?.efris_product_code || null,
          quantity: i.quantity,
          unit_cost: Number(i.unit_cost),
          line_total: Number(i.line_total),
          tax_rate: i.tax_rate || 0,
          tax_amount: i.tax_amount || 0,
          tax_category: i.tax_category_code || '01',
        })));
      }
    } catch (e: any) {
      console.error('Error loading purchase:', e);
    } finally {
      setLoading(false);
    }
  };

  const syncToEfris = async () => {
    if (!purchase || !business || !business.efris_api_key) {
      Alert.alert('Configuration Missing', 'EFRIS is not configured for this business.');
      return;
    }
    const unregistered = items.filter(i => !i.efris_product_code);
    if (unregistered.length > 0) {
      Alert.alert('Registration Needed', `Some products are not registered with EFRIS: ${unregistered.map(u => u.product_name).join(', ')}. Register them first.`);
      return;
    }

    setSyncing(true);
    try {
      const config: EfrisConfig = {
        apiKey: business.efris_api_key,
        apiUrl: business.efris_api_url || '',
        testMode: business.efris_test_mode ?? true,
      };

      const today = new Date().toISOString().split('T')[0];
      const result = await submitStockIncrease(config, {
        goodsStockIn: {
          operationType: '101',
          supplierName: purchase.supplier_name || 'Unknown',
          supplierTin: purchase.supplier_tin || '',
          stockInType: '101',
          stockInDate: today,
          remarks: `Manual Sync of Purchase: ${purchase.id}`,
          goodsTypeCode: '101',
        },
        goodsStockInItem: items.map(i => ({
          goodsCode: i.efris_product_code!,
          quantity: i.quantity.toString(),
          unitPrice: i.unit_cost.toString(),
        })),
      });

      if (result.success) {
        await supabase.from('purchases').update({
          efris_submitted: true,
          efris_submitted_at: new Date().toISOString(),
        }).eq('id', purchase.id);
        
        Alert.alert('✅ Success', 'Stock increase successfully submitted to EFRIS.');
        loadPurchase();
      } else {
        Alert.alert('EFRIS Error', result.error || 'Failed to sync with EFRIS.');
      }
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Something went wrong during EFRIS sync.');
    } finally {
      setSyncing(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator color="#e94560" size="large" style={{ marginTop: 60 }} />
      </View>
    );
  }

  if (!purchase) {
    return (
      <View style={styles.container}>
        <View style={styles.empty}>
          <FontAwesome name="exclamation-triangle" size={48} color="#e94560" />
          <Text style={styles.emptyText}>Purchase not found</Text>
        </View>
      </View>
    );
  }

  const isAdmin = profile?.role === 'admin';
  const formatDate = (d: string) => new Date(d).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  return (
    <ScrollView style={styles.container}>
      {/* Header Card */}
      <View style={styles.headerCard}>
        <View style={styles.headerTop}>
          <Text style={styles.totalAmount}>{fmt(purchase.total_amount)}</Text>
          {purchase.efris_submitted && (
            <View style={styles.efrisBadge}>
              <Text style={styles.efrisBadgeText}>✅ EFRIS</Text>
            </View>
          )}
        </View>
        <Text style={styles.headerDate}>{formatDate(purchase.created_at)}</Text>
        <Text style={styles.headerMeta}>📍 {purchase.branch_name} · 👤 {purchase.created_by_name}</Text>
      </View>

      {/* Supplier Info */}
      <View style={styles.supplierCard}>
        <FontAwesome name="truck" size={18} color="#2196F3" />
        <View style={{ marginLeft: 12, flex: 1, backgroundColor: 'transparent' }}>
          <Text style={styles.supplierName}>{purchase.supplier_name || 'Unknown Supplier'}</Text>
          {purchase.supplier_tin ? (
            <Text style={styles.supplierTin}>TIN: {purchase.supplier_tin}</Text>
          ) : null}
        </View>
      </View>

      {/* EFRIS Info */}
      {purchase.efris_submitted && (
        <View style={styles.efrisCard}>
          <Text style={styles.efrisTitle}>EFRIS Stock Increase</Text>
          <Text style={styles.efrisRow}>Submitted: {purchase.efris_submitted_at ? formatDate(purchase.efris_submitted_at) : 'Yes'}</Text>
          {purchase.supplier_tin && <Text style={styles.efrisRow}>Supplier TIN: {purchase.supplier_tin}</Text>}
        </View>
      )}

      {/* Notes */}
      {purchase.notes && (
        <View style={styles.notesCard}>
          <Text style={styles.notesLabel}>Notes</Text>
          <Text style={styles.notesText}>{purchase.notes}</Text>
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
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4, backgroundColor: 'transparent' }}>
            <Text style={styles.itemDetails}>
              {item.quantity} × {fmt(item.unit_cost)}
            </Text>
            {item.tax_amount > 0 && (
              <Text style={{ fontSize: 11, color: '#aaa' }}>VAT: {fmt(item.tax_amount)} ({item.tax_rate}%)</Text>
            )}
          </View>
        </View>
      ))}

      {/* Totals */}
      <View style={styles.totalsCard}>
        <Text style={styles.sectionTitle}>Summary</Text>
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Subtotal</Text>
          <Text style={styles.totalValue}>{fmt(purchase.subtotal_amount)}</Text>
        </View>
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Total VAT</Text>
          <Text style={styles.totalValue}>{fmt(purchase.vat_amount)}</Text>
        </View>
        <View style={[styles.totalRow, styles.totalRowFinal]}>
          <Text style={styles.totalFinalLabel}>Grand Total</Text>
          <Text style={styles.totalFinalValue}>{fmt(purchase.total_amount)}</Text>
        </View>
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Items Purchased</Text>
          <Text style={styles.totalValue}>{items.reduce((s, i) => s + i.quantity, 0)} units</Text>
        </View>
      </View>

      {/* Actions */}
      <View style={styles.actions}>
        {!purchase.efris_submitted && business?.is_efris_enabled && (
           <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: '#7C3AED' }]}
            onPress={syncToEfris}
            disabled={syncing}
          >
            {syncing ? <ActivityIndicator color="#fff" size="small" /> : (
              <>
                <FontAwesome name="cloud-upload" size={16} color="#fff" />
                <Text style={styles.actionText}>Sync Stock to EFRIS</Text>
              </>
            )}
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={styles.actionBtn}
          onPress={() => router.push('/purchase-history' as any)}
        >
          <FontAwesome name="list" size={16} color="#fff" />
          <Text style={styles.actionText}>All Purchases</Text>
        </TouchableOpacity>
      </View>

      {/* Purchase ID */}
      <Text style={styles.purchaseIdText}>Purchase ID: {purchase.id}</Text>

      <View style={{ height: 32 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  headerCard: { backgroundColor: '#16213e', margin: 16, borderRadius: 16, padding: 18 },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'transparent' },
  totalAmount: { color: '#fff', fontSize: 28, fontWeight: 'bold' },
  efrisBadge: { backgroundColor: '#4CAF5020', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  efrisBadgeText: { color: '#4CAF50', fontSize: 12, fontWeight: 'bold' },
  headerDate: { color: '#aaa', fontSize: 14, marginTop: 8 },
  headerMeta: { color: '#888', fontSize: 13, marginTop: 4 },
  supplierCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#16213e', marginHorizontal: 16, marginBottom: 12,
    borderRadius: 12, padding: 14,
  },
  supplierName: { color: '#fff', fontSize: 15, fontWeight: 'bold' },
  supplierTin: { color: '#aaa', fontSize: 12, marginTop: 2 },
  efrisCard: {
    backgroundColor: '#4CAF5015', marginHorizontal: 16, marginBottom: 12,
    borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#4CAF5033',
  },
  efrisTitle: { color: '#4CAF50', fontSize: 15, fontWeight: 'bold', marginBottom: 6 },
  efrisRow: { color: '#ccc', fontSize: 13, marginTop: 2 },
  notesCard: { backgroundColor: '#16213e', marginHorizontal: 16, marginBottom: 12, borderRadius: 12, padding: 14 },
  notesLabel: { color: '#aaa', fontSize: 12, marginBottom: 4 },
  notesText: { color: '#fff', fontSize: 14 },
  sectionTitle: { color: '#fff', fontSize: 16, fontWeight: 'bold', paddingHorizontal: 16, paddingBottom: 10 },
  itemCard: { backgroundColor: '#16213e', marginHorizontal: 16, marginBottom: 8, borderRadius: 12, padding: 14 },
  itemHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'transparent' },
  itemName: { color: '#fff', fontSize: 15, fontWeight: '600', flex: 1, marginRight: 8 },
  itemTotal: { color: '#4CAF50', fontSize: 15, fontWeight: 'bold' },
  itemDetails: { color: '#aaa', fontSize: 13, marginTop: 4 },
  totalsCard: { backgroundColor: '#16213e', marginHorizontal: 16, marginTop: 8, marginBottom: 16, borderRadius: 14, padding: 16 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: 'transparent', paddingVertical: 4 },
  totalLabel: { color: '#aaa', fontSize: 14, flex: 1, marginRight: 8 },
  totalValue: { color: '#fff', fontSize: 14 },
  totalRowFinal: { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#0f3460' },
  totalFinalLabel: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  totalFinalValue: { color: '#e94560', fontSize: 16, fontWeight: 'bold' },
  actions: { flexDirection: 'row', gap: 12, paddingHorizontal: 16, marginBottom: 16, backgroundColor: 'transparent' },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#e94560', borderRadius: 12, padding: 14, gap: 8 },
  actionText: { color: '#fff', fontWeight: 'bold', fontSize: 14 },
  purchaseIdText: { color: '#555', fontSize: 11, textAlign: 'center', marginBottom: 8 },
  empty: { alignItems: 'center', paddingTop: 60 },
  emptyText: { color: '#555', fontSize: 16, marginTop: 12 },
});
