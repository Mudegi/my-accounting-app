import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Linking,
} from 'react-native';
import { Text, View } from '@/components/Themed';
import { useAuth } from '@/lib/auth';
import { useRouter } from 'expo-router';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { formatCurrency } from '@/lib/currency';
import {
  getPlans,
  getCurrentSubscription,
  getPaymentHistory,
  trialDaysRemaining,
  statusLabel,
  statusColor,
  PAYMENT_METHOD_OPTIONS,
  type SubscriptionPlan,
  type Subscription,
  type Payment,
} from '@/lib/subscription';
import { getPlatformContacts, type PlatformContacts } from '@/lib/platform-settings';

type Tab = 'plans' | 'payment' | 'history';

export default function SubscriptionScreen() {
  const { business, refreshBusiness, refreshSubscription, subscriptionStatus } = useAuth();
  const router = useRouter();

  const [tab, setTab] = useState<Tab>('plans');
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [currentSub, setCurrentSub] = useState<Subscription | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);

  // Payment form
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');
  const [processing, setProcessing] = useState(false);
  const [contacts, setContacts] = useState<PlatformContacts>({ contact_phone: '', contact_whatsapp: '', contact_email: '' });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    if (!business) return;
    setLoading(true);
    const [plansData, subData, payData, contactsData] = await Promise.all([
      getPlans(),
      getCurrentSubscription(business.id),
      getPaymentHistory(business.id),
      getPlatformContacts(),
    ]);
    setPlans(plansData);
    setCurrentSub(subData);
    setPayments(payData);
    setContacts(contactsData);
    setLoading(false);
  };

  const handleSelectPlan = (planId: string) => {
    const plan = plans.find((p) => p.id === planId);
    if (plan?.name === 'free_trial') {
      Alert.alert('Already on Trial', 'You are already on a free trial. Choose a paid plan to upgrade.');
      return;
    }
    setSelectedPlan(planId);
    setTab('payment');
  };

  const handlePayment = () => {
    if (!selectedPlan) return;
    const plan = plans.find((p) => p.id === selectedPlan);
    if (!plan) return;
    const amount = billingCycle === 'yearly' ? plan.price_yearly : plan.price_monthly;

    Alert.alert(
      'Contact Sales Team',
      `To subscribe to ${plan.display_name} (${formatCurrency(amount, plan.currency)}/${billingCycle === 'yearly' ? 'year' : 'month'}), please contact our YourBooks sales team.\n\nYour account will be activated once payment is confirmed.` +
        (contacts.contact_phone ? `\n\n📞 ${contacts.contact_phone}` : '') +
        (contacts.contact_whatsapp ? `\n💬 WhatsApp: ${contacts.contact_whatsapp}` : '') +
        (contacts.contact_email ? `\n✉️ ${contacts.contact_email}` : ''),
      [{ text: 'OK' }]
    );
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#e94560" style={{ marginTop: 60 }} />
      </View>
    );
  }

  const currentPlan = plans.find((p) => p.id === currentSub?.plan_id);
  const trialDays = trialDaysRemaining(currentSub?.trial_ends_at);
  const subStatus = subscriptionStatus?.status || currentSub?.status || 'unknown';

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
    <View style={styles.container}>
      {/* Current Plan Banner */}
      <View style={[styles.statusBanner, { borderColor: statusColor(subStatus) }]}>
        <View style={styles.statusRow}>
          <View style={{ backgroundColor: 'transparent', flex: 1 }}>
            <Text style={styles.statusPlan}>{currentPlan?.display_name || 'No Plan'}</Text>
            <Text style={[styles.statusBadge, { color: statusColor(subStatus) }]}>
              {statusLabel(subStatus)}
              {subStatus === 'trial' && trialDays > 0 ? ` — ${trialDays} days left` : ''}
            </Text>
          </View>
          {(subStatus === 'expired' || subStatus === 'trial') && (
            <FontAwesome name="exclamation-triangle" size={24} color={statusColor(subStatus)} />
          )}
        </View>
      </View>

      {/* Tabs */}
      <View style={styles.tabBar}>
        {(['plans', 'payment', 'history'] as Tab[]).map((t) => (
          <TouchableOpacity
            key={t}
            style={[styles.tab, tab === t && styles.tabActive]}
            onPress={() => setTab(t)}
          >
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
              {t === 'plans' ? 'Plans' : t === 'payment' ? 'Pay' : 'History'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* PLANS TAB */}
        {tab === 'plans' && plans.map((plan) => {
          const isCurrent = plan.id === currentSub?.plan_id;
          return (
            <View key={plan.id} style={[styles.planCard, isCurrent && styles.planCardCurrent]}>
              <View style={styles.planTop}>
                <View style={{ backgroundColor: 'transparent' }}>
                  <Text style={styles.planName}>{plan.display_name}</Text>
                  <Text style={styles.planDesc}>{plan.description}</Text>
                </View>
                {isCurrent && (
                  <View style={styles.currentBadge}>
                    <Text style={styles.currentBadgeText}>Current</Text>
                  </View>
                )}
              </View>

              <View style={styles.planPricing}>
                {plan.name === 'free_trial' ? (
                  <Text style={styles.planPrice}>FREE</Text>
                ) : (
                  <>
                    <Text style={styles.planPrice}>{formatCurrency(plan.price_monthly, plan.currency)}/mo</Text>
                    <Text style={styles.planYearly}>{formatCurrency(plan.price_yearly, plan.currency)}/yr</Text>
                  </>
                )}
              </View>

              <View style={styles.featureList}>
                {plan.name === 'free_trial' ? (
                  <>
                    <Text style={styles.featureItem}>✓ Full access to all features</Text>
                    <Text style={styles.featureItem}>✓ POS, Inventory & Receipts</Text>
                    <Text style={styles.featureItem}>✓ Reports, Accounting & Export</Text>
                    <Text style={styles.featureItem}>✓ Unlimited branches & users</Text>
                  </>
                ) : plan.name === 'starter' ? (
                  <>
                    <Text style={styles.featureItem}>✓ POS & Sales</Text>
                    <Text style={styles.featureItem}>✓ Basic Inventory</Text>
                    <Text style={styles.featureItem}>✓ Digital Receipts</Text>
                    <Text style={styles.featureItem}>✓ 1 Branch · 2 Users · 100 Products</Text>
                  </>
                ) : plan.name === 'basic' ? (
                  <>
                    <Text style={styles.featureItem}>✓ Everything in Starter</Text>
                    <Text style={styles.featureItem}>✓ Reports & Expenses</Text>
                    <Text style={styles.featureItem}>✓ Multi-branch support</Text>
                    <Text style={styles.featureItem}>✓ Credit Notes & Returns</Text>
                    <Text style={styles.featureItem}>✓ Unlimited branches, users & products</Text>
                  </>
                ) : (
                  <>
                    <Text style={styles.featureItem}>✓ Everything in Basic</Text>
                    <Text style={styles.featureItem}>✓ Full Accounting (GL, P&L, Balance Sheet)</Text>
                    <Text style={styles.featureItem}>✓ Tax Center & Data Export</Text>
                    <Text style={styles.featureItem}>✓ Sales Targets & Analytics</Text>
                    <Text style={styles.featureItem}>✓ Unlimited everything</Text>
                  </>
                )}
              </View>

              {!isCurrent && plan.name !== 'free_trial' && (
                <TouchableOpacity style={styles.selectPlanBtn} onPress={() => handleSelectPlan(plan.id)}>
                  <Text style={styles.selectPlanText}>
                    {(subStatus === 'active' || subStatus === 'approved') ? 'Switch Plan' : 'Subscribe'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          );
        })}

        {/* PAYMENT TAB */}
        {tab === 'payment' && selectedPlan && (() => {
          const plan = plans.find((p) => p.id === selectedPlan);
          if (!plan) return <Text style={styles.emptyText}>Select a plan first</Text>;
          const amount = billingCycle === 'yearly' ? plan.price_yearly : plan.price_monthly;

          return (
            <>
              <Text style={styles.sectionTitle}>Subscribing to: {plan.display_name}</Text>

              {/* Billing Cycle Toggle */}
              <Text style={styles.label}>Billing Cycle</Text>
              <View style={styles.cycleRow}>
                <TouchableOpacity
                  style={[styles.cycleBtn, billingCycle === 'monthly' && styles.cycleBtnActive]}
                  onPress={() => setBillingCycle('monthly')}
                >
                  <Text style={[styles.cycleBtnText, billingCycle === 'monthly' && styles.cycleBtnTextActive]}>Monthly</Text>
                  <Text style={styles.cyclePrice}>{formatCurrency(plan.price_monthly, plan.currency)}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.cycleBtn, billingCycle === 'yearly' && styles.cycleBtnActive]}
                  onPress={() => setBillingCycle('yearly')}
                >
                  <Text style={[styles.cycleBtnText, billingCycle === 'yearly' && styles.cycleBtnTextActive]}>Yearly</Text>
                  <Text style={styles.cyclePrice}>{formatCurrency(plan.price_yearly, plan.currency)}</Text>
                  <Text style={styles.cycleSave}>Save {Math.round((1 - plan.price_yearly / (plan.price_monthly * 12)) * 100)}%</Text>
                </TouchableOpacity>
              </View>

              {/* How to Pay */}
              <Text style={styles.label}>How to Pay</Text>
              {/* How to Subscribe */}
              <View style={styles.sendMoneyCard}>
                <FontAwesome name="users" size={28} color="#00BCD4" style={{ marginBottom: 10 }} />
                <Text style={styles.sendMoneyTitle}>Contact Sales Team</Text>
                <Text style={styles.sendMoneyHint}>
                  To activate your subscription, contact our YourBooks sales team. They will process your payment and activate your account.
                </Text>

                {/* Contact details */}
                {contacts.contact_phone ? (
                  <TouchableOpacity
                    style={styles.phoneRow}
                    onPress={() => Linking.openURL(`tel:${contacts.contact_phone}`)}
                  >
                    <FontAwesome name="phone" size={16} color="#4CAF50" />
                    <Text style={{ color: '#4CAF50', fontSize: 14, fontWeight: '600' }}>{contacts.contact_phone}</Text>
                  </TouchableOpacity>
                ) : null}
                {contacts.contact_whatsapp ? (
                  <TouchableOpacity
                    style={styles.phoneRow}
                    onPress={() => Linking.openURL(`https://wa.me/${contacts.contact_whatsapp}`)}
                  >
                    <FontAwesome name="whatsapp" size={18} color="#25D366" />
                    <Text style={{ color: '#25D366', fontSize: 14, fontWeight: '600' }}>Chat on WhatsApp</Text>
                  </TouchableOpacity>
                ) : null}
                {contacts.contact_email ? (
                  <TouchableOpacity
                    style={styles.phoneRow}
                    onPress={() => Linking.openURL(`mailto:${contacts.contact_email}`)}
                  >
                    <FontAwesome name="envelope" size={14} color="#2196F3" />
                    <Text style={{ color: '#2196F3', fontSize: 14, fontWeight: '600' }}>{contacts.contact_email}</Text>
                  </TouchableOpacity>
                ) : null}

                <View style={[styles.phoneRow, { marginTop: 8 }]}>
                  <FontAwesome name="check-circle" size={14} color="#4CAF50" />
                  <Text style={{ color: '#aaa', fontSize: 13 }}>Payment via Mobile Money, Bank, or Cash</Text>
                </View>
                <View style={styles.phoneRow}>
                  <FontAwesome name="check-circle" size={14} color="#4CAF50" />
                  <Text style={{ color: '#aaa', fontSize: 13 }}>Instant activation after payment</Text>
                </View>
                <View style={styles.phoneRow}>
                  <FontAwesome name="check-circle" size={14} color="#4CAF50" />
                  <Text style={{ color: '#aaa', fontSize: 13 }}>Sales team available across Uganda</Text>
                </View>
              </View>

              {/* Summary */}
              <View style={styles.paymentSummary}>
                <Text style={styles.summaryLabel}>Total</Text>
                <Text style={styles.summaryAmount}>{formatCurrency(amount, plan.currency)}</Text>
              </View>

              <TouchableOpacity
                style={styles.payButton}
                onPress={handlePayment}
              >
                <Text style={styles.payButtonText}>Contact Sales Team</Text>
              </TouchableOpacity>
            </>
          );
        })()}
        {tab === 'payment' && !selectedPlan && (
          <View style={styles.emptyState}>
            <FontAwesome name="credit-card" size={48} color="#333" />
            <Text style={styles.emptyText}>Select a plan from the Plans tab first</Text>
          </View>
        )}

        {/* HISTORY TAB */}
        {tab === 'history' && (
          <>
            {payments.length === 0 ? (
              <View style={styles.emptyState}>
                <FontAwesome name="history" size={48} color="#333" />
                <Text style={styles.emptyText}>No payment history yet</Text>
              </View>
            ) : payments.map((p) => (
              <View key={p.id} style={styles.historyCard}>
                <View style={styles.historyTop}>
                  <Text style={styles.historyDate}>{new Date(p.created_at).toLocaleDateString()}</Text>
                  <View style={[styles.historyStatus, { backgroundColor: p.status === 'completed' ? '#4CAF5022' : p.status === 'failed' ? '#e9456022' : '#FF980022' }]}>
                    <Text style={[styles.historyStatusText, { color: p.status === 'completed' ? '#4CAF50' : p.status === 'failed' ? '#e94560' : '#FF9800' }]}>
                      {p.status.toUpperCase()}
                    </Text>
                  </View>
                </View>
                <Text style={styles.historyAmount}>{formatCurrency(p.amount, p.currency)}</Text>
                <Text style={styles.historyMethod}>
                  {PAYMENT_METHOD_OPTIONS.find(o => o.value === p.payment_method)?.label || p.payment_method}
                  {p.phone_number ? ` (${p.phone_number})` : ''}
                </Text>
                {p.payment_reference && (
                  <Text style={styles.historyRef}>Ref: {p.payment_reference}</Text>
                )}
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  content: { padding: 16, paddingBottom: 40 },

  statusBanner: { backgroundColor: '#16213e', padding: 16, borderLeftWidth: 4, margin: 12, marginBottom: 0, borderRadius: 12 },
  statusRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'transparent' },
  statusPlan: { fontSize: 18, fontWeight: 'bold', color: '#fff' },
  statusBadge: { fontSize: 14, fontWeight: '600', marginTop: 4 },

  tabBar: { flexDirection: 'row', padding: 12, gap: 8, backgroundColor: 'transparent' },
  tab: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 10, backgroundColor: '#16213e' },
  tabActive: { backgroundColor: '#e94560' },
  tabText: { color: '#888', fontWeight: '600', fontSize: 14 },
  tabTextActive: { color: '#fff' },

  // Plans
  planCard: { backgroundColor: '#16213e', borderRadius: 14, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: '#0f3460' },
  planCardCurrent: { borderColor: '#4CAF50' },
  planTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', backgroundColor: 'transparent' },
  planName: { fontSize: 20, fontWeight: 'bold', color: '#fff' },
  planDesc: { fontSize: 12, color: '#888', marginTop: 2 },
  planPricing: { marginTop: 10, backgroundColor: 'transparent' },
  planPrice: { fontSize: 18, fontWeight: 'bold', color: '#4CAF50' },
  planYearly: { fontSize: 13, color: '#888', marginTop: 2 },
  currentBadge: { backgroundColor: '#4CAF5022', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  currentBadgeText: { color: '#4CAF50', fontSize: 12, fontWeight: '600' },
  featureList: { marginTop: 10, backgroundColor: 'transparent' },
  featureItem: { fontSize: 13, color: '#aaa', marginTop: 3 },
  selectPlanBtn: { marginTop: 12, backgroundColor: '#e94560', borderRadius: 10, padding: 12, alignItems: 'center' },
  selectPlanText: { color: '#fff', fontWeight: 'bold', fontSize: 15 },

  // Payment form
  sectionTitle: { fontSize: 18, fontWeight: 'bold', color: '#fff', marginBottom: 16 },
  label: { fontSize: 13, color: '#aaa', marginTop: 16, marginBottom: 8 },
  input: { backgroundColor: '#16213e', borderRadius: 12, padding: 14, fontSize: 15, color: '#fff', borderWidth: 1, borderColor: '#0f3460' },

  cycleRow: { flexDirection: 'row', gap: 10 },
  cycleBtn: { flex: 1, backgroundColor: '#16213e', borderRadius: 12, padding: 14, alignItems: 'center', borderWidth: 1.5, borderColor: '#0f3460' },
  cycleBtnActive: { borderColor: '#e94560', backgroundColor: '#e9456010' },
  cycleBtnText: { color: '#888', fontWeight: '600', fontSize: 15 },
  cycleBtnTextActive: { color: '#e94560' },
  cyclePrice: { color: '#fff', fontSize: 14, fontWeight: 'bold', marginTop: 4 },
  cycleSave: { color: '#4CAF50', fontSize: 12, marginTop: 2 },

  payMethodCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#16213e', padding: 14, borderRadius: 12, marginBottom: 8, borderWidth: 1, borderColor: '#0f3460' },

  sendMoneyCard: { backgroundColor: '#0f3460', borderRadius: 14, padding: 16, borderWidth: 1, borderColor: '#0f3460' },
  sendMoneyTitle: { color: '#fff', fontSize: 16, fontWeight: 'bold', marginBottom: 8 },
  phoneRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6, backgroundColor: 'transparent' },
  sendMoneyHint: { color: '#aaa', fontSize: 13, marginBottom: 12, lineHeight: 20 },

  paymentSummary: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#16213e', padding: 16, borderRadius: 12, marginTop: 20, borderWidth: 1, borderColor: '#0f3460' },
  summaryLabel: { color: '#aaa', fontSize: 16 },
  summaryAmount: { color: '#fff', fontSize: 22, fontWeight: 'bold' },

  payButton: { backgroundColor: '#e94560', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 16 },
  payButtonText: { color: '#fff', fontSize: 17, fontWeight: 'bold' },

  // History
  historyCard: { backgroundColor: '#16213e', padding: 14, borderRadius: 12, marginBottom: 10 },
  historyTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'transparent' },
  historyDate: { color: '#aaa', fontSize: 13 },
  historyStatus: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  historyStatusText: { fontSize: 11, fontWeight: 'bold' },
  historyAmount: { fontSize: 18, fontWeight: 'bold', color: '#fff', marginTop: 6 },
  historyMethod: { fontSize: 13, color: '#888', marginTop: 4 },
  historyRef: { fontSize: 12, color: '#555', marginTop: 2 },

  emptyState: { alignItems: 'center', paddingTop: 60, backgroundColor: 'transparent' },
  emptyText: { color: '#555', fontSize: 15, marginTop: 12 },
});
