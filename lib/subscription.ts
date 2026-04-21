/**
 * Subscription & Payment management
 */
import { supabase } from './supabase';

export type SubscriptionPlan = {
  id: string;
  name: string;
  display_name: string;
  description: string | null;
  price_monthly: number;
  price_yearly: number;
  currency: string;
  trial_days: number;
  max_branches: number;     // -1 = unlimited
  max_users: number;        // -1 = unlimited
  max_products: number;     // -1 = unlimited
  features: string[];
  sort_order: number;
};

export type Subscription = {
  id: string;
  business_id: string;
  plan_id: string;
  status: 'trial' | 'active' | 'past_due' | 'cancelled' | 'expired';
  billing_cycle: 'monthly' | 'yearly';
  current_period_start: string;
  current_period_end: string;
  trial_ends_at: string | null;
  cancelled_at: string | null;
};

export type Payment = {
  id: string;
  business_id: string;
  subscription_id: string;
  amount: number;
  currency: string;
  payment_method: string;
  payment_reference: string | null;
  payment_reason: string | null;
  phone_number: string | null;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'refunded';
  paid_at: string | null;
  created_at: string;
};

export type SubscriptionStatus = {
  active: boolean;
  reason?: string;
  plan?: string;
  display_name?: string;
  status?: string;
  ends_at?: string;
  trial_ends_at?: string;
  max_branches?: number;
  max_users?: number;
  max_products?: number;
  features?: string[];
  billing_cycle?: 'monthly' | 'yearly';
};

// ── Payment method options ──

export const PAYMENT_METHOD_OPTIONS = [
  { value: 'mtn_momo',      label: 'MTN MoMo',         icon: 'mobile' },
  { value: 'airtel_money',   label: 'Airtel Money',     icon: 'mobile' },
  { value: 'bank_transfer',  label: 'Bank Transfer',    icon: 'university' },
  { value: 'visa',           label: 'Visa Card',        icon: 'cc-visa' },
  { value: 'mastercard',     label: 'Mastercard',       icon: 'cc-mastercard' },
] as const;

// ── API Functions ──

/** Fetch all available plans */
export async function getPlans(): Promise<SubscriptionPlan[]> {
  const { data } = await supabase
    .from('subscription_plans')
    .select('*')
    .eq('is_active', true)
    .order('sort_order');
  return (data || []) as SubscriptionPlan[];
}

/** Check subscription status via server-side RPC */
export async function checkSubscription(businessId: string): Promise<SubscriptionStatus> {
  const { data, error } = await supabase.rpc('check_subscription_status', {
    p_business_id: businessId,
  });
  if (error || !data) return { active: false, reason: 'error' };
  return data as SubscriptionStatus;
}

/** Get current subscription record */
export async function getCurrentSubscription(businessId: string): Promise<Subscription | null> {
  const { data } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('business_id', businessId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  return data;
}

/** Get payment history */
export async function getPaymentHistory(businessId: string): Promise<Payment[]> {
  const { data } = await supabase
    .from('payments')
    .select('*')
    .eq('business_id', businessId)
    .order('created_at', { ascending: false });
  return (data || []) as Payment[];
}

/**
 * Initiate a subscription payment.
 * Creates a pending payment record, then you call your payment provider.
 * For now this handles the DB side; provider integration is pluggable.
 */
export async function initiatePayment(params: {
  businessId: string;
  subscriptionId: string;
  planId: string;
  amount: number;
  currency: string;
  paymentMethod: string;
  phoneNumber?: string;
  billingCycle: 'monthly' | 'yearly';
  paymentReason?: string;
}): Promise<{ payment: Payment | null; error: any }> {
  // 1. Create pending payment record
  const { data: payment, error: payErr } = await supabase
    .from('payments')
    .insert({
      business_id: params.businessId,
      subscription_id: params.subscriptionId,
      amount: params.amount,
      currency: params.currency,
      payment_method: params.paymentMethod,
      phone_number: params.phoneNumber || null,
      payment_reason: params.paymentReason || null,
      status: 'pending',
    })
    .select()
    .single();

  if (payErr) return { payment: null, error: payErr };

  return { payment: payment as Payment, error: null };
}

/**
 * Confirm a payment (simulate provider callback / manual confirmation)
 * In production: this would be called by a webhook from Flutterwave/MTN etc.
 */
export async function confirmPayment(params: {
  paymentId: string;
  businessId: string;
  planId: string;
  billingCycle: 'monthly' | 'yearly';
  paymentReference?: string;
}): Promise<{ error: any }> {
  // 1. Update payment status
  const { error: payErr } = await supabase
    .from('payments')
    .update({
      status: 'completed',
      payment_reference: params.paymentReference || null,
      paid_at: new Date().toISOString(),
    })
    .eq('id', params.paymentId);

  if (payErr) return { error: payErr };

  // 2. Get plan details
  const { data: plan } = await supabase
    .from('subscription_plans')
    .select('*')
    .eq('id', params.planId)
    .single();

  if (!plan) return { error: new Error('Plan not found') };

  // 3. Calculate period
  const now = new Date();
  const periodEnd = new Date(now);
  if (params.billingCycle === 'yearly') {
    periodEnd.setFullYear(periodEnd.getFullYear() + 1);
  } else {
    periodEnd.setMonth(periodEnd.getMonth() + 1);
  }

  // 4. Upsert subscription
  const { data: existingSub } = await supabase
    .from('subscriptions')
    .select('id')
    .eq('business_id', params.businessId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (existingSub) {
    await supabase
      .from('subscriptions')
      .update({
        plan_id: params.planId,
        status: 'active',
        billing_cycle: params.billingCycle,
        current_period_start: now.toISOString(),
        current_period_end: periodEnd.toISOString(),
        updated_at: now.toISOString(),
      })
      .eq('id', existingSub.id);
  } else {
    await supabase
      .from('subscriptions')
      .insert({
        business_id: params.businessId,
        plan_id: params.planId,
        status: 'active',
        billing_cycle: params.billingCycle,
        current_period_start: now.toISOString(),
        current_period_end: periodEnd.toISOString(),
      });
  }

  // 5. Update business
  await supabase
    .from('businesses')
    .update({
      subscription_status: 'active',
      subscription_ends_at: periodEnd.toISOString(),
    })
    .eq('id', params.businessId);

  return { error: null };
}

/** Remaining trial days (returns 0 if not on trial) */
export function trialDaysRemaining(trialEndsAt: string | null | undefined): number {
  if (!trialEndsAt) return 0;
  const diff = new Date(trialEndsAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

/** Human-readable plan status label */
export function statusLabel(status: string): string {
  switch (status) {
    case 'trial': return 'Free Trial';
    case 'active': return 'Active';
    case 'approved': return '✅ Approved';
    case 'past_due': return 'Past Due';
    case 'cancelled': return 'Cancelled';
    case 'expired': return 'Expired';
    default: return status;
  }
}

/** Status color */
export function statusColor(status: string): string {
  switch (status) {
    case 'trial': return '#2196F3';
    case 'active': return '#4CAF50';
    case 'approved': return '#00BCD4';
    case 'past_due': return '#FF9800';
    case 'cancelled': return '#e94560';
    case 'expired': return '#e94560';
    default: return '#888';
  }
}
