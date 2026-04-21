import React, { useState, useCallback, useRef } from 'react';
import {
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Alert,
  ActivityIndicator,
  FlatList,
  Linking,
  Platform,
} from 'react-native';
import { Text, View } from '@/components/Themed';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useFocusEffect } from 'expo-router';
import { fetchCustomerBalance, fetchDetailedHistory, fetchCustomerStatement } from '@/lib/customer-utils';
import DateTimePicker from '@react-native-community/datetimepicker';
import { shareStatementPdf, printStatement, type StatementData } from '@/lib/statements';

type Customer = {
  id: string;
  name: string;
  tin: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  buyer_type: string;
  contact_person: string | null;
  credit_limit: number;
};

export default function CustomerProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { business, fmt } = useAuth();
  const router = useRouter();

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [balance, setBalance] = useState(0);
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'summary' | 'history' | 'statement'>('summary');

  // Statement states
  const [startDate, setStartDate] = useState(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [endDate, setEndDate] = useState(new Date());
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);
  const [statementLedger, setStatementLedger] = useState<any[]>([]);
  const [openingBalance, setOpeningBalance] = useState(0);
  const [loadingStatement, setLoadingStatement] = useState(false);

  const loadData = useCallback(async () => {
    if (!business || !id) return;
    setLoading(true);
    try {
      const [{ data: cust }, bal, hist] = await Promise.all([
        supabase.from('customers').select('*').eq('id', id).single(),
        fetchCustomerBalance(business.id, id, null),
        fetchDetailedHistory(business.id, id, null),
      ]);

      if (cust) setCustomer(cust);
      setBalance(bal);
      setHistory(hist);
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setLoading(false);
    }
  }, [business, id]);

  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  const loadStatement = async () => {
    if (!business || !id) return;
    setLoadingStatement(true);
    try {
      const { openingBalance: ob, ledger } = await fetchCustomerStatement(business.id, id, null, startDate, endDate);
      setOpeningBalance(ob);
      setStatementLedger(ledger);
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setLoadingStatement(false);
    }
  };

  const handleAction = (type: 'call' | 'email' | 'whatsapp') => {
    if (!customer?.phone && type !== 'email') return;
    if (!customer?.email && type === 'email') return;

    let url = '';
    if (type === 'call') url = `tel:${customer.phone}`;
    if (type === 'whatsapp') url = `whatsapp://send?phone=${customer.phone}`;
    if (type === 'email') url = `mailto:${customer.email}`;

    Linking.canOpenURL(url).then(supported => {
      if (supported) Linking.openURL(url);
      else Alert.alert('Error', 'This action is not supported on your device');
    });
  };

  const generateStatement = async (share = false) => {
    if (!customer || !business) return;
    const data: StatementData = {
      businessName: business.name,
      businessTin: business.tin,
      businessPhone: business.phone,
      businessAddress: business.address,
      businessLogo: business.logo_url,
      customerName: customer.name,
      customerPhone: customer.phone,
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

  if (loading) return <View style={styles.centered}><ActivityIndicator color="#e94560" /></View>;
  if (!customer) return <View style={styles.centered}><Text style={{ color: '#fff' }}>Customer not found</Text></View>;

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: customer.name, headerRight: () => (
        <TouchableOpacity onPress={() => router.push({ pathname: '/customers', params: { editId: id } } as any)}>
          <Text style={{ color: '#e94560', fontWeight: 'bold', marginRight: 10 }}>Edit</Text>
        </TouchableOpacity>
      )}} />

      {/* Header Profile */}
      <View style={styles.header}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{customer.name.charAt(0)}</Text>
        </View>
        <Text style={styles.customerName}>{customer.name}</Text>
        <View style={styles.actionRow}>
          <TouchableOpacity style={styles.actionBtn} onPress={() => handleAction('call')}>
            <FontAwesome name="phone" size={18} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#25D366' }]} onPress={() => handleAction('whatsapp')}>
            <FontAwesome name="whatsapp" size={18} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#2196F3' }]} onPress={() => handleAction('email')}>
            <FontAwesome name="envelope" size={18} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Tabs */}
      <View style={styles.tabBar}>
        {(['summary', 'history', 'statement'] as const).map(tab => (
          <TouchableOpacity 
            key={tab} 
            style={[styles.tab, activeTab === tab && styles.tabActive]}
            onPress={() => {
              setActiveTab(tab);
              if (tab === 'statement' && statementLedger.length === 0) loadStatement();
            }}
          >
            <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
              {tab.charAt(0) + tab.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView style={{ flex: 1 }}>
        {activeTab === 'summary' && (
          <View style={styles.tabContent}>
             <View style={styles.balanceCard}>
                <Text style={styles.cardLabel}>Outstanding Balance</Text>
                <Text style={[styles.cardValue, { color: balance > 0 ? '#e94560' : '#4CAF50' }]}>{fmt(balance)}</Text>
                {customer.credit_limit > 0 && (
                  <View style={styles.limitInfo}>
                    <Text style={styles.limitLabel}>Credit Limit: {fmt(customer.credit_limit)}</Text>
                    <View style={styles.progressBar}>
                      <View style={[styles.progressFill, { 
                        width: `${Math.min(100, (balance / customer.credit_limit) * 100)}%`,
                        backgroundColor: balance > customer.credit_limit ? '#e94560' : '#FF9800'
                      }]} />
                    </View>
                  </View>
                )}
             </View>

             <View style={styles.infoSection}>
                <InfoRow icon="id-card" label="TIN" value={customer.tin || 'N/A'} />
                <InfoRow icon="phone" label="Phone" value={customer.phone || 'N/A'} />
                <InfoRow icon="envelope" label="Email" value={customer.email || 'N/A'} />
                <InfoRow icon="map-marker" label="Address" value={customer.address || 'N/A'} />
                <InfoRow icon="user" label="Contact Person" value={customer.contact_person || 'N/A'} />
             </View>
          </View>
        )}

        {activeTab === 'history' && (
          <View style={styles.tabContent}>
            {history.length === 0 ? (
              <Text style={styles.emptyText}>No sales history found</Text>
            ) : (
              history.map(sale => (
                <View key={sale.id} style={styles.historyCard}>
                  <View style={styles.historyHeader}>
                    <Text style={styles.historyDate}>{new Date(sale.created_at).toLocaleDateString()}</Text>
                    <Text style={styles.historyTotal}>{fmt(sale.total_amount)}</Text>
                  </View>
                  <View style={styles.itemTags}>
                    {sale.sale_items?.map((item: any, idx: number) => (
                      <Text key={idx} style={styles.itemTag}>
                        {item.quantity}x {item.product_name} ({fmt(item.line_total)})
                      </Text>
                    ))}
                  </View>
                </View>
              ))
            )}
          </View>
        )}

        {activeTab === 'statement' && (
          <View style={styles.tabContent}>
            <View style={styles.dateControls}>
              <TouchableOpacity style={styles.dateBtn} onPress={() => setShowStartPicker(true)}>
                <Text style={styles.dateLabel}>From</Text>
                <Text style={styles.dateVal}>{startDate.toLocaleDateString()}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.dateBtn} onPress={() => setShowEndPicker(true)}>
                <Text style={styles.dateLabel}>To</Text>
                <Text style={styles.dateVal}>{endDate.toLocaleDateString()}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.refreshBtn} onPress={loadStatement}>
                <FontAwesome name="refresh" size={16} color="#fff" />
              </TouchableOpacity>
            </View>

            {loadingStatement ? <ActivityIndicator color="#e94560" style={{marginTop: 20}} /> : (
              <>
                <View style={styles.ledgerHeader}>
                  <Text style={styles.ledgerTitle}>Transaction Ledger</Text>
                  <Text style={styles.openingText}>Opening Balance: {fmt(openingBalance)}</Text>
                </View>

                {statementLedger.map((entry, idx) => (
                   <View key={idx} style={styles.ledgerRow}>
                      <View style={{ flex: 1, backgroundColor: 'transparent' }}>
                         <Text style={styles.entryDate}>{new Date(entry.date).toLocaleDateString()}</Text>
                         <Text style={styles.entryDesc}>{entry.description}</Text>
                      </View>
                      <View style={{ alignItems: 'flex-end', backgroundColor: 'transparent' }}>
                         <Text style={[styles.entryAmt, { color: entry.debit > 0 ? '#e94560' : '#4CAF50' }]}>
                           {entry.debit > 0 ? `+${fmt(entry.debit)}` : `−${fmt(entry.credit)}`}
                         </Text>
                         <Text style={styles.entryBal}>Bal: {fmt(entry.balance)}</Text>
                      </View>
                   </View>
                ))}

                <View style={styles.statementActions}>
                   <TouchableOpacity style={styles.printBtn} onPress={() => generateStatement(false)}>
                      <FontAwesome name="print" size={16} color="#fff" />
                      <Text style={styles.printBtnText}>Print</Text>
                   </TouchableOpacity>
                   <TouchableOpacity style={[styles.printBtn, { backgroundColor: '#533483' }]} onPress={() => generateStatement(true)}>
                      <FontAwesome name="share" size={16} color="#fff" />
                      <Text style={styles.printBtnText}>Share</Text>
                   </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        )}
      </ScrollView>

      {showStartPicker && <DateTimePicker value={startDate} mode="date" onChange={(e, d) => { setShowStartPicker(false); if(d) setStartDate(d); }} />}
      {showEndPicker && <DateTimePicker value={endDate} mode="date" onChange={(e, d) => { setShowEndPicker(false); if(d) setEndDate(d); }} />}

    </View>
  );
}

function InfoRow({ icon, label, value }: { icon: any, label: string, value?: string | null }) {
  return (
    <View style={styles.infoRow}>
      <FontAwesome name={icon} size={16} color="#e94560" style={{ width: 24 }} />
      <View style={{ backgroundColor: 'transparent', flex: 1 }}>
        <Text style={styles.infoLabel}>{label}</Text>
        <Text style={styles.infoValue}>{value || 'N/A'}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  centered: { flex: 1, backgroundColor: '#1a1a2e', justifyContent: 'center', alignItems: 'center' },
  header: { alignItems: 'center', padding: 24, backgroundColor: '#16213e' },
  avatar: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#e94560', justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
  avatarText: { fontSize: 32, fontWeight: 'bold', color: '#fff' },
  customerName: { fontSize: 24, fontWeight: 'bold', color: '#fff', marginBottom: 16 },
  actionRow: { flexDirection: 'row', gap: 15, backgroundColor: 'transparent' },
  actionBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#333', justifyContent: 'center', alignItems: 'center' },
  tabBar: { flexDirection: 'row', backgroundColor: '#0f3460', borderBottomWidth: 1, borderBottomColor: '#1a1a2e' },
  tab: { flex: 1, paddingVertical: 14, alignItems: 'center' },
  tabActive: { borderBottomWidth: 3, borderBottomColor: '#e94560' },
  tabText: { color: '#888', fontWeight: 'bold', fontSize: 13 },
  tabTextActive: { color: '#fff' },
  tabContent: { padding: 16, backgroundColor: 'transparent' },
  balanceCard: { backgroundColor: '#16213e', borderRadius: 16, padding: 20, marginBottom: 16, borderWidth: 1, borderColor: '#0f3460' },
  cardLabel: { color: '#aaa', fontSize: 14, marginBottom: 4 },
  cardValue: { fontSize: 32, fontWeight: 'bold', color: '#fff' },
  limitInfo: { marginTop: 15, backgroundColor: 'transparent' },
  limitLabel: { color: '#aaa', fontSize: 12, marginBottom: 6 },
  progressBar: { height: 6, backgroundColor: '#0f3460', borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 3 },
  infoSection: { backgroundColor: '#16213e', borderRadius: 16, padding: 8 },
  infoRow: { flexDirection: 'row', padding: 12, alignItems: 'center', backgroundColor: 'transparent' },
  infoLabel: { color: '#666', fontSize: 11, marginBottom: 2 },
  infoValue: { color: '#fff', fontSize: 14 },
  emptyText: { color: '#555', textAlign: 'center', marginTop: 40 },
  historyCard: { backgroundColor: '#16213e', borderRadius: 12, padding: 14, marginBottom: 10 },
  historyHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, backgroundColor: 'transparent' },
  historyDate: { color: '#aaa', fontSize: 12 },
  historyTotal: { color: '#fff', fontWeight: 'bold', fontSize: 15 },
  itemTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, backgroundColor: 'transparent' },
  itemTag: { backgroundColor: '#0f3460', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, color: '#ccc', fontSize: 11 },
  dateControls: { flexDirection: 'row', gap: 10, alignItems: 'center', marginBottom: 16, backgroundColor: 'transparent' },
  dateBtn: { flex: 1, backgroundColor: '#16213e', padding: 10, borderRadius: 10, borderWidth: 1, borderColor: '#0f3460' },
  dateLabel: { color: '#666', fontSize: 10 },
  dateVal: { color: '#fff', fontSize: 13, fontWeight: 'bold' },
  refreshBtn: { width: 44, height: 44, borderRadius: 12, backgroundColor: '#e94560', justifyContent: 'center', alignItems: 'center' },
  ledgerHeader: { marginBottom: 12, backgroundColor: 'transparent' },
  ledgerTitle: { color: '#aaa', fontSize: 12, fontWeight: 'bold' },
  openingText: { color: '#666', fontSize: 12, marginTop: 2 },
  ledgerRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#0f3460', backgroundColor: 'transparent' },
  entryDate: { color: '#888', fontSize: 11 },
  entryDesc: { color: '#fff', fontSize: 14, marginTop: 2 },
  entryAmt: { fontSize: 15, fontWeight: 'bold' },
  entryBal: { color: '#666', fontSize: 12, marginTop: 4 },
  statementActions: { flexDirection: 'row', gap: 12, marginTop: 20, backgroundColor: 'transparent' },
  printBtn: { flex: 1, flexDirection: 'row', gap: 8, height: 50, borderRadius: 12, backgroundColor: '#e94560', justifyContent: 'center', alignItems: 'center' },
  printBtnText: { color: '#fff', fontWeight: 'bold' },
});
