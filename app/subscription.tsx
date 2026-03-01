import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Alert,
  ActivityIndicator,
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
  initiatePayment,
  confirmPayment,
  trialDaysRemaining,
  statusLabel,
  statusColor,
  PAYMENT_METHOD_OPTIONS,
  type SubscriptionPlan,
  type Subscription,
  type Payment,
} from '@/lib/subscription';

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
  const [payMethod, setPayMethod] = useState('mtn_momo');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    if (!business) return;
    setLoading(true);
    const [plansData, subData, payData] = await Promise.all([
      getPlans(),
      getCurrentSubscription(business.id),
      getPaymentHistory(business.id),
    ]);
    setPlans(plansData);
    setCurrentSub(subData);
    setPayments(payData);
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

  const handlePayment = async () => {
    if (!selectedPlan || !business || !currentSub) return;
    const plan = plans.find((p) => p.id === selectedPlan);
    if (!plan) return;

    if ((payMethod === 'mtn_momo' || payMethod === 'airtel_money') && !phoneNumber) {
      Alert.alert('Required', 'Please enter your mobile money number');
      return;
    }

    setProcessing(true);
    try {
      const amount = billingCycle === 'yearly' ? plan.price_yearly : plan.price_monthly;

      // 1. Create pending payment
      const { payment, error: initErr } = await initiatePayment({
        businessId: business.id,
        subscriptionId: currentSub.id,
        planId: selectedPlan,
        amount,
        currency: plan.currency,
        paymentMethod: payMethod,
        phoneNumber: phoneNumber || undefined,
        billingCycle,
      });

      if (initErr || !payment) {
        Alert.alert('Error', initErr?.message || 'Could not initiate payment');
        setProcessing(false);
        return;
      }

      // 2. Simulate payment processing
      //    In production: call Flutterwave/MTN MoMo API here, then confirm on webhook
      //    For now: auto-confirm after simulated delay
      Alert.alert(
        'Payment Initiated',
        payMethod === 'mtn_momo' || payMethod === 'airtel_money'
          ? `A payment prompt has been sent to ${phoneNumber}. Please approve it on your phone.\n\nAmount: ${formatCurrency(amount, plan.currency)}`
          : `Please complete the payment of ${formatCurrency(amount, plan.currency)} via ${PAYMENT_METHOD_OPTIONS.find(o => o.value === payMethod)?.label || payMethod}.`,
        [
          {
            text: 'I have paid',
            onPress: async () => {
              // Confirm payment
              const { error: confErr } = await confirmPayment({
                paymentId: payment.id,
                businessId: business.id,
                planId: selectedPlan,
                billingCycle,
                paymentReference: `SIM-${Date.now()}`,
              });

              if (confErr) {
                Alert.alert('Error', confErr.message || 'Payment confirmation failed');
              } else {
                await refreshBusiness();
                await refreshSubscription();
                await loadData();
                Alert.alert('Success! 🎉', `Your ${plan.display_name} plan is now active!`);
                setTab('plans');
              }
              setProcessing(false);
            },
          },
          {
            text: 'Cancel',
            style: 'cancel',
            onPress: () => setProcessing(false),
          },
        ]
      );
    } catch (e: any) {
      Alert.alert('Error', e.message);
      setProcessing(false);
    }
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
                <Text style={styles.featureItem}>✓ Unlimited branches, users & products</Text>
                <Text style={styles.featureItem}>✓ POS, Inventory & Receipts</Text>
                <Text style={styles.featureItem}>✓ Reports, Expenses & Accounting</Text>
                <Text style={styles.featureItem}>✓ Multi-branch support</Text>
                <Text style={styles.featureItem}>✓ Credit Notes & Returns</Text>
                {Array.isArray(plan.features) && plan.features.includes('efris') && plan.name !== 'free_trial' && (
                  <Text style={[styles.featureItem, { color: '#4CAF50', fontWeight: '600' }]}>✓ EFRIS / URA Integration</Text>
                )}
              </View>

              {!isCurrent && plan.name !== 'free_trial' && (
                <TouchableOpacity style={styles.selectPlanBtn} onPress={() => handleSelectPlan(plan.id)}>
                  <Text style={styles.selectPlanText}>
                    {subStatus === 'active' ? 'Switch Plan' : 'Subscribe'}
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

              {/* Payment Method */}
              <Text style={styles.label}>Payment Method</Text>
              {PAYMENT_METHOD_OPTIONS.map((opt) => (
                <TouchableOpacity
                  key={opt.value}
                  style={[styles.payMethodCard, payMethod === opt.value && styles.payMethodCardActive]}
                  onPress={() => setPayMethod(opt.value)}
                >
                  <FontAwesome name={opt.icon as any} size={20} color={payMethod === opt.value ? '#e94560' : '#888'} />
                  <Text style={[styles.payMethodText, payMethod === opt.value && { color: '#fff' }]}>{opt.label}</Text>
                  {payMethod === opt.value && <FontAwesome name="check" size={16} color="#e94560" />}
                </TouchableOpacity>
              ))}

              {/* Phone number for mobile money */}
              {(payMethod === 'mtn_momo' || payMethod === 'airtel_money') && (
                <>
                  <Text style={styles.label}>Mobile Money Number</Text>
                  <TextInput
                    style={styles.input}
                    value={phoneNumber}
                    onChangeText={setPhoneNumber}
                    placeholder="0770 XXX XXX"
                    placeholderTextColor="#555"
                    keyboardType="phone-pad"
                  />
                </>
              )}

              {/* Summary */}
              <View style={styles.paymentSummary}>
                <Text style={styles.summaryLabel}>Total</Text>
                <Text style={styles.summaryAmount}>{formatCurrency(amount, plan.currency)}</Text>
              </View>

              <TouchableOpacity
                style={[styles.payButton, processing && { opacity: 0.6 }]}
                onPress={handlePayment}
                disabled={processing}
              >
                {processing ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.payButtonText}>Pay {formatCurrency(amount, plan.currency)}</Text>
                )}
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
  payMethodCardActive: { borderColor: '#e94560' },
  payMethodText: { flex: 1, color: '#888', fontSize: 15 },

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
