/**
 * Platform-wide settings — contact info managed by Super Admin
 */
import { supabase } from './supabase';

export type PlatformContacts = {
  contact_phone: string;
  contact_whatsapp: string;
  contact_email: string;
  platform_announcement: string;
};

const EMPTY_CONTACTS: PlatformContacts = {
  contact_phone: '',
  contact_whatsapp: '',
  contact_email: '',
  platform_announcement: '',
};

let cached: PlatformContacts | null = null;

export async function getPlatformContacts(): Promise<PlatformContacts> {
  if (cached) return cached;
  try {
    const { data, error } = await supabase.rpc('get_platform_settings');
    if (error) throw error;
    cached = {
      contact_phone: data?.contact_phone || '',
      contact_whatsapp: data?.contact_whatsapp || '',
      contact_email: data?.contact_email || '',
      platform_announcement: data?.platform_announcement || '',
    };
    return cached;
  } catch (e) {
    console.error('Failed to load platform settings:', e);
    return EMPTY_CONTACTS;
  }
}

/** Force re-fetch on next call */
export function invalidatePlatformContacts() {
  cached = null;
}

/** Save a single setting (super admin) */
export async function updatePlatformSetting(key: string, value: string): Promise<boolean> {
  const { error } = await supabase.rpc('update_platform_setting', {
    p_key: key,
    p_value: value,
  });
  if (error) {
    console.error('Update platform setting error:', error);
    return false;
  }
  // Invalidate cache so next read gets fresh data
  invalidatePlatformContacts();
  return true;
}
