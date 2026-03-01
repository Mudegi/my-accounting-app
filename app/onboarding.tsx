import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Alert,
  ActivityIndicator,
  FlatList,
} from 'react-native';
import { Text, View } from '@/components/Themed';
import { useAuth } from '@/lib/auth';
import { useRouter } from 'expo-router';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { loadCurrencies, POPULAR_CURRENCIES, type Currency } from '@/lib/currency';
import { getPlans, type SubscriptionPlan } from '@/lib/subscription';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/currency';

type Step = 'business' | 'currency' | 'plan';

export default function OnboardingScreen() {
  const { business, refreshBusiness, refreshSubscription, reloadUserData } = useAuth();
  const router = useRouter();

  const [step, setStep] = useState<Step>('business');
  const [saving, setSaving] = useState(false);

  // Step 1: Business details
  const [bizName, setBizName] = useState(business?.name || '');
  const [bizPhone, setBizPhone] = useState('');
  const [bizAddress, setBizAddress] = useState('');
  const [bizTin, setBizTin] = useState('');

  // Step 2: Currency
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [selectedCurrency, setSelectedCurrency] = useState('UGX');

  // Step 3: Plan
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);

  useEffect(() => {
    loadCurrencies().then(setCurrencies);
    getPlans().then((p) => {
      setPlans(p);
      // Auto-select free trial
      const trial = p.find((pl) => pl.name === 'free_trial');
      if (trial) setSelectedPlan(trial.id);
    });
  }, []);

  // Group currencies: popular first, then rest
  const popularCurrencies = currencies.filter((c) => POPULAR_CURRENCIES.includes(c.code));
  const otherCurrencies = currencies.filter((c) => !POPULAR_CURRENCIES.includes(c.code));

  const saveBusinessDetails = async () => {
    if (!bizName.trim()) {
      Alert.alert('Required', 'Please enter your business name');
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from('businesses')
      .update({
        name: bizName.trim(),
        phone: bizPhone.trim() || null,
        address: bizAddress.trim() || null,
        tin: bizTin.trim() || null,
      })
      .eq('id', business!.id);

    if (error) {
      Alert.alert('Error', error.message);
    } else {
      setStep('currency');
    }
    setSaving(false);
  };

  const saveCurrency = async () => {
    setSaving(true);
    const { error } = await supabase
      .from('businesses')
      .update({ default_currency: selectedCurrency })
      .eq('id', business!.id);

    if (error) {
      Alert.alert('Error', error.message);
    } else {
      setStep('plan');
    }
    setSaving(false);
  };

  const activateTrialAndFinish = async () => {
    if (!selectedPlan) {
      Alert.alert('Required', 'Please select a plan');
      return;
    }
    setSaving(true);
    try {
      // Create subscription (trial)
      const plan = plans.find((p) => p.id === selectedPlan);
      const trialDays = plan?.trial_days || 14;
      const periodEnd = new Date();
      periodEnd.setDate(periodEnd.getDate() + (trialDays > 0 ? trialDays : 30));

      const status = trialDays > 0 ? 'trial' : 'active';

      await supabase.from('subscriptions').insert({
        business_id: business!.id,
        plan_id: selectedPlan,
        status,
        billing_cycle: 'monthly',
        current_period_start: new Date().toISOString(),
        current_period_end: periodEnd.toISOString(),
        trial_ends_at: trialDays > 0 ? periodEnd.toISOString() : null,
      });

      await supabase
        .from('businesses')
        .update({
          subscription_status: status,
          subscription_ends_at: periodEnd.toISOString(),
        })
        .eq('id', business!.id);

      await refreshBusiness();
      await refreshSubscription();
      await reloadUserData();
      router.replace('/(tabs)');
    } catch (e: any) {
      Alert.alert('Error', e.message);
    }
    setSaving(false);
  };

  const renderStepIndicator = () => (
    <View style={styles.stepIndicator}>
      {(['business', 'currency', 'plan'] as Step[]).map((s, i) => (
        <View key={s} style={styles.stepRow}>
          <View style={[styles.stepDot, step === s && styles.stepDotActive, (['business', 'currency', 'plan'].indexOf(step) > i) && styles.stepDotDone]}>
            <Text style={styles.stepDotText}>{i + 1}</Text>
          </View>
          {i < 2 && <View style={[styles.stepLine, (['business', 'currency', 'plan'].indexOf(step) > i) && styles.stepLineDone]} />}
        </View>
      ))}
    </View>
  );

  return (
    <View style={styles.container}>
      {renderStepIndicator()}

      <ScrollView contentContainerStyle={styles.content}>
        {/* STEP 1: Business Info */}
        {step === 'business' && (
          <>
            <Text style={styles.title}>Set Up Your Business</Text>
            <Text style={styles.subtitle}>Tell us about your business</Text>

            <Text style={styles.label}>Business Name *</Text>
            <TextInput style={styles.input} value={bizName} onChangeText={setBizName} placeholder="e.g. Kampala Hardware Store" placeholderTextColor="#555" />

            <Text style={styles.label}>Phone Number</Text>
            <TextInput style={styles.input} value={bizPhone} onChangeText={setBizPhone} placeholder="+256 7XX XXX XXX" placeholderTextColor="#555" keyboardType="phone-pad" />

            <Text style={styles.label}>Address</Text>
            <TextInput style={styles.input} value={bizAddress} onChangeText={setBizAddress} placeholder="e.g. Plot 5, Luwum St, Kampala" placeholderTextColor="#555" />

            {business?.is_efris_enabled && (
              <>
                <Text style={styles.label}>TIN (Tax ID - optional)</Text>
                <TextInput style={styles.input} value={bizTin} onChangeText={setBizTin} placeholder="Tax Identification Number" placeholderTextColor="#555" />
              </>
            )}

            <TouchableOpacity style={styles.primaryButton} onPress={saveBusinessDetails} disabled={saving}>
              {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>Next →</Text>}
            </TouchableOpacity>
          </>
        )}

        {/* STEP 2: Currency */}
        {step === 'currency' && (
          <>
            <Text style={styles.title}>Select Your Currency</Text>
            <Text style={styles.subtitle}>Choose the main currency for your business</Text>

            <Text style={styles.sectionLabel}>Popular</Text>
            <View style={styles.currencyGrid}>
              {popularCurrencies.map((c) => (
                <TouchableOpacity
                  key={c.code}
                  style={[styles.currencyCard, selectedCurrency === c.code && styles.currencyCardActive]}
                  onPress={() => setSelectedCurrency(c.code)}
                >
                  <Text style={[styles.currencySymbol, selectedCurrency === c.code && styles.currencyTextActive]}>{c.symbol}</Text>
                  <Text style={[styles.currencyCode, selectedCurrency === c.code && styles.currencyTextActive]}>{c.code}</Text>
                  <Text style={styles.currencyName} numberOfLines={1}>{c.name}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {otherCurrencies.length > 0 && (
              <>
                <Text style={styles.sectionLabel}>Other</Text>
                <View style={styles.currencyGrid}>
                  {otherCurrencies.map((c) => (
                    <TouchableOpacity
                      key={c.code}
                      style={[styles.currencyCard, selectedCurrency === c.code && styles.currencyCardActive]}
                      onPress={() => setSelectedCurrency(c.code)}
                    >
                      <Text style={[styles.currencySymbol, selectedCurrency === c.code && styles.currencyTextActive]}>{c.symbol}</Text>
                      <Text style={[styles.currencyCode, selectedCurrency === c.code && styles.currencyTextActive]}>{c.code}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}

            <View style={styles.buttonRow}>
              <TouchableOpacity style={styles.backButton} onPress={() => setStep('business')}>
                <Text style={styles.backButtonText}>← Back</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.primaryButton, { flex: 1 }]} onPress={saveCurrency} disabled={saving}>
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>Next →</Text>}
              </TouchableOpacity>
            </View>
          </>
        )}

        {/* STEP 3: Choose Plan */}
        {step === 'plan' && (
          <>
            <Text style={styles.title}>Choose a Plan</Text>
            <Text style={styles.subtitle}>Start with a free trial, upgrade anytime</Text>

            {plans.map((plan) => {
              const isSelected = selectedPlan === plan.id;
              const isTrial = plan.name === 'free_trial';
              return (
                <TouchableOpacity
                  key={plan.id}
                  style={[styles.planCard, isSelected && styles.planCardActive]}
                  onPress={() => setSelectedPlan(plan.id)}
                >
                  <View style={styles.planHeader}>
                    <View style={{ backgroundColor: 'transparent' }}>
                      <Text style={[styles.planName, isSelected && { color: '#e94560' }]}>{plan.display_name}</Text>
                      <Text style={styles.planDesc}>{plan.description}</Text>
                    </View>
                    {isSelected && (
                      <FontAwesome name="check-circle" size={24} color="#e94560" />
                    )}
                  </View>
                  <View style={styles.planPricing}>
                    {isTrial ? (
                      <Text style={styles.planPrice}>FREE for {plan.trial_days} days</Text>
                    ) : (
                      <>
                        <Text style={styles.planPrice}>
                          {formatCurrency(plan.price_monthly, plan.currency)}/mo
                        </Text>
                        <Text style={styles.planYearly}>
                          or {formatCurrency(plan.price_yearly, plan.currency)}/yr (save {formatCurrency(plan.price_monthly * 12 - plan.price_yearly, plan.currency)})
                        </Text>
                      </>
                    )}
                  </View>
                  <View style={styles.planFeatures}>
                    <Text style={styles.featureItem}>✓ Unlimited branches, users & products</Text>
                    <Text style={styles.featureItem}>✓ POS, Inventory & Receipts</Text>
                    <Text style={styles.featureItem}>✓ Reports, Expenses & Accounting</Text>
                    <Text style={styles.featureItem}>✓ Multi-branch support</Text>
                    <Text style={styles.featureItem}>✓ Credit Notes & Returns</Text>
                    {Array.isArray(plan.features) && plan.features.includes('efris') && plan.name !== 'free_trial' && (
                      <Text style={[styles.featureItem, { color: '#4CAF50', fontWeight: '600' }]}>✓ EFRIS / URA Integration</Text>
                    )}
                    {plan.name !== 'free_trial' && !Array.isArray(plan.features) || (Array.isArray(plan.features) && !plan.features.includes('efris')) ? null : null}
                  </View>
                </TouchableOpacity>
              );
            })}

            <View style={styles.buttonRow}>
              <TouchableOpacity style={styles.backButton} onPress={() => setStep('currency')}>
                <Text style={styles.backButtonText}>← Back</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.primaryButton, { flex: 1 }]} onPress={activateTrialAndFinish} disabled={saving}>
                {saving ? <ActivityIndicator color="#fff" /> : (
                  <Text style={styles.primaryButtonText}>
                    {plans.find((p) => p.id === selectedPlan)?.name === 'free_trial' ? 'Start Free Trial' : 'Continue to Payment'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  content: { padding: 20, paddingBottom: 40 },
  stepIndicator: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', paddingVertical: 20, backgroundColor: '#16213e', borderBottomWidth: 1, borderBottomColor: '#0f3460' },
  stepRow: { flexDirection: 'row', alignItems: 'center' },
  stepDot: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#0f3460', justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#0f3460' },
  stepDotActive: { borderColor: '#e94560', backgroundColor: '#e94560' },
  stepDotDone: { borderColor: '#4CAF50', backgroundColor: '#4CAF50' },
  stepDotText: { color: '#fff', fontWeight: 'bold', fontSize: 14 },
  stepLine: { width: 40, height: 2, backgroundColor: '#0f3460', marginHorizontal: 4 },
  stepLineDone: { backgroundColor: '#4CAF50' },

  title: { fontSize: 24, fontWeight: 'bold', color: '#fff', marginBottom: 6 },
  subtitle: { fontSize: 14, color: '#888', marginBottom: 24 },
  label: { fontSize: 13, color: '#aaa', marginBottom: 6, marginTop: 12 },
  sectionLabel: { fontSize: 14, color: '#aaa', fontWeight: '600', marginTop: 16, marginBottom: 8 },
  input: { backgroundColor: '#16213e', borderRadius: 12, padding: 14, fontSize: 15, color: '#fff', borderWidth: 1, borderColor: '#0f3460' },

  primaryButton: { backgroundColor: '#e94560', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 24 },
  primaryButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  backButton: { borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 24, borderWidth: 1, borderColor: '#0f3460', marginRight: 12 },
  backButtonText: { color: '#aaa', fontSize: 15 },
  buttonRow: { flexDirection: 'row', alignItems: 'center' },

  // Currency grid
  currencyGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  currencyCard: { width: '30%', backgroundColor: '#16213e', borderRadius: 12, padding: 12, alignItems: 'center', borderWidth: 1.5, borderColor: '#0f3460' },
  currencyCardActive: { borderColor: '#e94560', backgroundColor: '#e9456015' },
  currencySymbol: { fontSize: 18, fontWeight: 'bold', color: '#fff' },
  currencyCode: { fontSize: 13, fontWeight: '600', color: '#aaa', marginTop: 2 },
  currencyName: { fontSize: 10, color: '#666', marginTop: 2, textAlign: 'center' },
  currencyTextActive: { color: '#e94560' },

  // Plan cards
  planCard: { backgroundColor: '#16213e', borderRadius: 14, padding: 16, marginBottom: 12, borderWidth: 1.5, borderColor: '#0f3460' },
  planCardActive: { borderColor: '#e94560', backgroundColor: '#e9456010' },
  planHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', backgroundColor: 'transparent' },
  planName: { fontSize: 18, fontWeight: 'bold', color: '#fff' },
  planDesc: { fontSize: 12, color: '#888', marginTop: 2 },
  planPricing: { marginTop: 10, backgroundColor: 'transparent' },
  planPrice: { fontSize: 16, fontWeight: 'bold', color: '#4CAF50' },
  planYearly: { fontSize: 12, color: '#888', marginTop: 2 },
  planFeatures: { marginTop: 10, backgroundColor: 'transparent' },
  featureItem: { fontSize: 12, color: '#aaa', marginBottom: 3 },
  planLimits: { flexDirection: 'row', gap: 16, marginTop: 10, backgroundColor: 'transparent' },
  planLimit: { fontSize: 12, color: '#aaa' },
});
