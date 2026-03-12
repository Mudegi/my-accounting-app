/**
 * Device session management — track & enforce per-plan device limits
 */
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

const DEVICE_ID_KEY = '@yourbooks_device_id';

// ── Generate or retrieve a stable device ID ──
let cachedDeviceId: string | null = null;

export async function getDeviceId(): Promise<string> {
  if (cachedDeviceId) return cachedDeviceId;
  try {
    const stored = await AsyncStorage.getItem(DEVICE_ID_KEY);
    if (stored) {
      cachedDeviceId = stored;
      return stored;
    }
  } catch {}
  // Generate a new UUID-like ID
  const id = 'dev_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  try {
    await AsyncStorage.setItem(DEVICE_ID_KEY, id);
  } catch {}
  cachedDeviceId = id;
  return id;
}

function getDeviceName(): string {
  const os = Platform.OS;
  if (os === 'ios') return 'iPhone / iPad';
  if (os === 'android') return 'Android Phone';
  if (os === 'web') return 'Web Browser';
  return 'Unknown Device';
}

// ── Register session on login ──
export async function registerDeviceSession(businessId: string): Promise<{
  allowed: boolean;
  maxDevices?: number;
  activeCount?: number;
  reason?: string;
}> {
  const deviceId = await getDeviceId();
  const deviceName = getDeviceName();
  const platform = Platform.OS;

  const { data, error } = await supabase.rpc('register_device_session', {
    p_business_id: businessId,
    p_device_id: deviceId,
    p_device_name: deviceName,
    p_platform: platform,
  });

  if (error) {
    console.error('Register device session error:', error);
    // Allow on error to not block users due to RPC issues
    return { allowed: true };
  }

  return {
    allowed: data?.allowed ?? true,
    maxDevices: data?.max_devices,
    activeCount: data?.active_count,
    reason: data?.reason,
  };
}

// ── Heartbeat: call on app foreground ──
export async function heartbeatSession(): Promise<{ allowed: boolean; reason?: string }> {
  try {
    const deviceId = await getDeviceId();
    const { data } = await supabase.rpc('heartbeat_device_session', { p_device_id: deviceId });
    if (data && data.allowed === false) {
      return { allowed: false, reason: data.reason };
    }
  } catch {}
  return { allowed: true };
}

// ── Remove session on logout ──
export async function removeDeviceSession(): Promise<void> {
  try {
    const deviceId = await getDeviceId();
    await supabase.rpc('remove_device_session', { p_device_id: deviceId });
  } catch {}
}

// ── Get active sessions for current business (settings) ──
export type DeviceSession = {
  id: string;
  user_id: string;
  user_name: string;
  device_id: string;
  device_name: string;
  platform: string;
  last_active_at: string;
  created_at: string;
  is_current: boolean;
};

export async function getBusinessSessions(businessId: string): Promise<DeviceSession[]> {
  const { data, error } = await supabase.rpc('get_business_device_sessions', {
    p_business_id: businessId,
  });
  if (error) {
    console.error('Get business sessions error:', error);
    return [];
  }
  // Mark current device
  const deviceId = await getDeviceId();
  return (data || []).map((s: any) => ({
    ...s,
    is_current: s.device_id === deviceId && s.user_id === (supabase as any).auth?.currentUser?.id,
  }));
}

// ── Remote logout: admin removes another session ──
export async function removeOtherSession(sessionId: string, businessId: string): Promise<boolean> {
  const { error } = await supabase.rpc('admin_remove_device_session', {
    p_session_id: sessionId,
    p_business_id: businessId,
  });
  if (error) {
    console.error('Remove other session error:', error);
    return false;
  }
  return true;
}
