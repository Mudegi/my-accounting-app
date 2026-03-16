import React, { useState, useCallback } from 'react';
import {
  StyleSheet,
  TouchableOpacity,
  FlatList,
  TextInput,
  Alert,
  ActivityIndicator,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Text, View } from '@/components/Themed';
import { supabase, supabaseUrl, supabaseAnonKey } from '@/lib/supabase';
import { createClient } from '@supabase/supabase-js';
import { useAuth } from '@/lib/auth';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useFocusEffect, useRouter, Redirect } from 'expo-router';

type User = {
  id: string;
  full_name: string;
  role: string;
  branch_name: string | null;
  branch_id: string | null;
  is_active: boolean;
  suspended_at: string | null;
  deleted_at: string | null;
  suspension_reason: string | null;
};

const ROLES = ['admin', 'branch_manager', 'salesperson'] as const;

export default function UsersScreen() {
  const { business, branches, profile } = useAuth();
  const router = useRouter();

  // Admin-only route guard
  if (profile && profile.role !== 'admin') {
    return <Redirect href="/" />;
  }

  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<string>('salesperson');
  const [branchId, setBranchId] = useState('');
  const [saving, setSaving] = useState(false);
  const [userLimit, setUserLimit] = useState<{ max: number; current: number } | null>(null);

  const load = useCallback(async () => {
    if (!business) return;
    setLoading(true);

    // Load user limit info
    const { data: limitData } = await supabase.rpc('check_user_limit', { p_business_id: business.id });
    if (limitData) {
      setUserLimit({ max: limitData.max_users, current: limitData.current_count ?? 0 });
    }

    const { data } = await supabase
      .from('profiles')
      .select(`id, full_name, role, branch_id, is_active, suspended_at, deleted_at, suspension_reason, branches(name)`)
      .eq('business_id', business.id)
      .is('deleted_at', null)
      .order('full_name');

    if (data) {
      setUsers(data.map((u: any) => ({
        id: u.id,
        full_name: u.full_name,
        role: u.role,
        branch_id: u.branch_id,
        branch_name: u.branches?.name || null,
        is_active: u.is_active,
        suspended_at: u.suspended_at,
        deleted_at: u.deleted_at,
        suspension_reason: u.suspension_reason,
      })));
    }
    setLoading(false);
  }, [business]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleInvite = async () => {
    if (!email.trim() || !fullName.trim()) { Alert.alert('Error', 'Enter name and email'); return; }
    if (!password.trim() || password.trim().length < 6) { Alert.alert('Error', 'Password must be at least 6 characters'); return; }
    if (!branchId) { Alert.alert('Error', 'Select a branch for this user'); return; }
    if (!business || !profile) return;

      setSaving(true);
  
      try {
        // Check user limit before creating account
        const { data: limitCheck, error: limitError } = await supabase.rpc('check_user_limit', {
          p_business_id: business.id,
        });
        
        if (limitCheck && !limitCheck.allowed) {
          Alert.alert(
            'User Limit Reached',
            `Your plan allows ${limitCheck.max_users} user${limitCheck.max_users === 1 ? '' : 's'}. You currently have ${limitCheck.current_count}.\n\nUpgrade your plan to add more users.`
          );
          setSaving(false);
          return;
        }

        // Use a temporary client with persistSession: false to avoid logging OUT the admin
        const tempSupabase = createClient(supabaseUrl, supabaseAnonKey, {
          auth: { persistSession: false }
        });

        const { data, error } = await tempSupabase.auth.signUp({
          email: email.trim(),
          password: password.trim(),
          options: {
            data: { invited_by: profile.full_name },
          },
        });

        if (error) {
          Alert.alert('Error', error.message);
          setSaving(false);
          return;
        }

      const userId = data.user?.id;
      if (!userId) { Alert.alert('Error', 'Failed to create account. The email may already be registered.'); setSaving(false); return; }

      const { error: profileError } = await supabase.from('profiles').insert({
        id: userId,
        business_id: business.id,
        branch_id: branchId,
        full_name: fullName.trim(),
        role,
      });

      if (profileError) {
        Alert.alert('Error', profileError.message);
      } else {
        Alert.alert(
          'User Created ✅',
          `Share these login credentials with ${fullName.trim()}:\n\n📧 Email: ${email.trim()}\n🔑 Password: ${password.trim()}\n\nThey can now open YourBooks and sign in immediately.`,
          [{ text: 'OK', onPress: () => { setShowInvite(false); setEmail(''); setFullName(''); setPassword(''); setRole('salesperson'); setBranchId(''); load(); } }]
        );
      }
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Something went wrong while creating the user');
    } finally {
      setSaving(false);
    }
  };

  const handleRoleChange = (userId: string, newRole: string, userName: string) => {
    Alert.alert('Change Role', `Set ${userName} as ${newRole}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Confirm',
        onPress: async () => {
          await supabase.from('profiles').update({ role: newRole }).eq('id', userId);
          load();
        }
      }
    ]);
  };

  const handleBranchChange = async (userId: string, newBranchId: string) => {
    await supabase.from('profiles').update({ branch_id: newBranchId }).eq('id', userId);
    load();
  };

  const handleRemove = (userId: string, userName: string) => {
    if (userId === profile?.id) { Alert.alert("Can't remove yourself"); return; }
    Alert.alert(
      'Delete User',
      `This will deactivate ${userName}'s account. They will no longer be able to log in. All their historical data (sales, etc.) will be preserved.\n\nContinue?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => handleSoftDelete(userId),
        }
      ]
    );
  };

  const handleSoftDelete = async (userId: string) => {
    const { error } = await supabase.rpc('soft_delete_user', {
      p_user_id: userId,
      p_reason: 'Removed by admin',
    });
    if (error) {
      Alert.alert('Error', error.message);
    } else {
      Alert.alert('Done', 'User has been removed. Their historical records are preserved.');
      load();
    }
  };

  const handleSuspend = (userId: string, userName: string) => {
    if (userId === profile?.id) { Alert.alert("Can't suspend yourself"); return; }
    Alert.alert(
      'Suspend User',
      `Suspend ${userName}? They will be logged out immediately and blocked from signing in until you reactivate them.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Suspend',
          style: 'destructive',
          onPress: async () => {
            const { error } = await supabase.rpc('suspend_user', {
              p_user_id: userId,
              p_reason: 'Suspended by admin',
            });
            if (error) {
              Alert.alert('Error', error.message);
            } else {
              Alert.alert('Suspended', `${userName} has been suspended and logged out of all devices.`);
              load();
            }
          }
        }
      ]
    );
  };

  const handleReactivate = (userId: string, userName: string) => {
    Alert.alert(
      'Reactivate User',
      `Allow ${userName} to log in again?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reactivate',
          onPress: async () => {
            const { error } = await supabase.rpc('reactivate_user', { p_user_id: userId });
            if (error) {
              Alert.alert('Error', error.message);
            } else {
              Alert.alert('Reactivated', `${userName} can now log in again.`);
              load();
            }
          }
        }
      ]
    );
  };

  const roleColor = (r: string) => {
    if (r === 'admin') return '#e94560';
    if (r === 'branch_manager') return '#FF9800';
    return '#4CAF50';
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
    <View style={styles.container}>
      <TouchableOpacity style={styles.inviteBtn} onPress={() => setShowInvite(!showInvite)}>
        <FontAwesome name="user-plus" size={16} color="#fff" />
        <Text style={styles.inviteBtnText}>Invite New User</Text>
      </TouchableOpacity>

      {userLimit && userLimit.max !== -1 && (
        <View style={{ backgroundColor: '#16213e', borderRadius: 10, padding: 10, marginBottom: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ color: '#aaa', fontSize: 13 }}>
            Users: <Text style={{ color: '#fff', fontWeight: 'bold' }}>{userLimit.current}</Text> / {userLimit.max}
          </Text>
          <View style={{ backgroundColor: userLimit.current >= userLimit.max ? '#e9456033' : '#4CAF5033', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}>
            <Text style={{ color: userLimit.current >= userLimit.max ? '#e94560' : '#4CAF50', fontSize: 11, fontWeight: '600' }}>
              {userLimit.current >= userLimit.max ? 'Limit reached' : `${userLimit.max - userLimit.current} remaining`}
            </Text>
          </View>
        </View>
      )}

      {showInvite && (
        <View style={styles.formCard}>
          <Text style={styles.formTitle}>Create User</Text>
          <TextInput style={styles.input} placeholder="Full Name" placeholderTextColor="#555" value={fullName} onChangeText={setFullName} />
          <TextInput style={styles.input} placeholder="Email Address" placeholderTextColor="#555" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
          <TextInput style={styles.input} placeholder="Password (min 6 characters)" placeholderTextColor="#555" value={password} onChangeText={setPassword} secureTextEntry />

          <Text style={styles.label}>Role</Text>
          <View style={styles.chipRow}>
            {ROLES.map((r) => (
              <TouchableOpacity key={r} style={[styles.chip, role === r && styles.chipActive]} onPress={() => setRole(r)}>
                <Text style={[styles.chipText, role === r && styles.chipTextActive]}>{r.replace('_', ' ')}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={[styles.label, { marginTop: 12 }]}>Assign to Branch</Text>
          <View style={styles.chipRow}>
            {branches.map((b) => (
              <TouchableOpacity key={b.id} style={[styles.chip, branchId === b.id && styles.chipActive]} onPress={() => setBranchId(b.id)}>
                <Text style={[styles.chipText, branchId === b.id && styles.chipTextActive]}>{b.name}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.formButtons}>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowInvite(false)}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.saveBtn} onPress={handleInvite} disabled={saving}>
              {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.saveText}>Create User</Text>}
            </TouchableOpacity>
          </View>
        </View>
      )}

      {loading ? (
        <ActivityIndicator color="#e94560" style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={users}
          keyExtractor={(u) => u.id}
          renderItem={({ item }) => (
            <View style={[styles.card, !item.is_active && { opacity: 0.6, borderLeftWidth: 3, borderLeftColor: '#e94560' }]}>
              <View style={styles.cardHeader}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{item.full_name.charAt(0).toUpperCase()}</Text>
                </View>
                <View style={styles.cardInfo}>
                  <Text style={styles.userName}>{item.full_name}</Text>
                  <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center', backgroundColor: 'transparent', flexWrap: 'wrap' }}>
                    <View style={[styles.roleBadge, { backgroundColor: roleColor(item.role) + '22', borderColor: roleColor(item.role) }]}>
                      <Text style={[styles.roleText, { color: roleColor(item.role) }]}>{item.role.replace('_', ' ')}</Text>
                    </View>
                    {!item.is_active && (
                      <View style={[styles.roleBadge, { backgroundColor: '#e9456022', borderColor: '#e94560' }]}>
                        <Text style={[styles.roleText, { color: '#e94560' }]}>SUSPENDED</Text>
                      </View>
                    )}
                  </View>
                </View>
              </View>

              {!item.is_active && item.suspension_reason && (
                <Text style={{ color: '#e94560', fontSize: 12, marginBottom: 8, fontStyle: 'italic' }}>
                  Reason: {item.suspension_reason}
                </Text>
              )}

              <Text style={styles.branchLabel}>Branch: <Text style={styles.branchValue}>{item.branch_name || 'None'}</Text></Text>

              {item.is_active && (
                <>
                  <View style={styles.actionsRow}>
                    <Text style={styles.actionLabel}>Move to:</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.branchScroll}>
                      {branches.filter((b) => b.id !== item.branch_id).map((b) => (
                        <TouchableOpacity key={b.id} style={styles.actionChip} onPress={() => handleBranchChange(item.id, b.id)}>
                          <Text style={styles.actionChipText}>{b.name}</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>

                  {item.id !== profile?.id && (
                    <View style={styles.actionsRow}>
                      <Text style={styles.actionLabel}>Role:</Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.branchScroll}>
                        {ROLES.filter((r) => r !== item.role).map((r) => (
                          <TouchableOpacity key={r} style={[styles.actionChip, { borderColor: roleColor(r) }]} onPress={() => handleRoleChange(item.id, r, item.full_name)}>
                            <Text style={[styles.actionChipText, { color: roleColor(r) }]}>{r.replace('_', ' ')}</Text>
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    </View>
                  )}
                </>
              )}

              {/* Action buttons for non-self users */}
              {item.id !== profile?.id && (
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 8, backgroundColor: 'transparent', flexWrap: 'wrap' }}>
                  {item.is_active ? (
                    <>
                      <TouchableOpacity
                        style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#FF980022', borderRadius: 8, paddingVertical: 8, borderWidth: 1, borderColor: '#FF9800' }}
                        onPress={() => handleSuspend(item.id, item.full_name)}
                      >
                        <FontAwesome name="ban" size={13} color="#FF9800" />
                        <Text style={{ color: '#FF9800', fontSize: 12, fontWeight: '600' }}>Suspend</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#2196F322', borderRadius: 8, paddingVertical: 8, borderWidth: 1, borderColor: '#2196F3' }}
                        onPress={() => router.push(`/admin/schedule?userId=${item.id}&userName=${encodeURIComponent(item.full_name)}` as any)}
                      >
                        <FontAwesome name="clock-o" size={13} color="#2196F3" />
                        <Text style={{ color: '#2196F3', fontSize: 12, fontWeight: '600' }}>Hours</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#e9456022', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12, borderWidth: 1, borderColor: '#e94560' }}
                        onPress={() => handleRemove(item.id, item.full_name)}
                      >
                        <FontAwesome name="trash" size={13} color="#e94560" />
                      </TouchableOpacity>
                    </>
                  ) : (
                    <>
                      <TouchableOpacity
                        style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#4CAF5022', borderRadius: 8, paddingVertical: 8, borderWidth: 1, borderColor: '#4CAF50' }}
                        onPress={() => handleReactivate(item.id, item.full_name)}
                      >
                        <FontAwesome name="check-circle" size={13} color="#4CAF50" />
                        <Text style={{ color: '#4CAF50', fontSize: 12, fontWeight: '600' }}>Reactivate</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#e9456022', borderRadius: 8, paddingVertical: 8, borderWidth: 1, borderColor: '#e94560' }}
                        onPress={() => handleRemove(item.id, item.full_name)}
                      >
                        <FontAwesome name="trash" size={13} color="#e94560" />
                        <Text style={{ color: '#e94560', fontSize: 12, fontWeight: '600' }}>Delete</Text>
                      </TouchableOpacity>
                    </>
                  )}
                </View>
              )}
            </View>
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <FontAwesome name="users" size={48} color="#333" />
              <Text style={styles.emptyText}>No users yet</Text>
            </View>
          }
        />
      )}
    </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e', padding: 16 },
  inviteBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#e94560', borderRadius: 12, padding: 14, marginBottom: 14, gap: 8 },
  inviteBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 15 },
  formCard: { backgroundColor: '#16213e', borderRadius: 16, padding: 16, marginBottom: 14 },
  formTitle: { color: '#fff', fontSize: 18, fontWeight: 'bold', marginBottom: 12 },
  label: { color: '#aaa', fontSize: 13, marginBottom: 6 },
  input: { backgroundColor: '#0f3460', borderRadius: 10, padding: 14, color: '#fff', fontSize: 15, marginBottom: 10 },
  chipRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 18, backgroundColor: '#0f3460', borderWidth: 1, borderColor: '#0f3460', marginBottom: 6 },
  chipActive: { backgroundColor: '#e94560', borderColor: '#e94560' },
  chipText: { color: '#aaa', fontSize: 13 },
  chipTextActive: { color: '#fff', fontWeight: 'bold' },
  formButtons: { flexDirection: 'row', gap: 10, marginTop: 6 },
  cancelBtn: { flex: 1, padding: 14, borderRadius: 10, backgroundColor: '#333', alignItems: 'center' },
  cancelText: { color: '#aaa', fontWeight: 'bold' },
  saveBtn: { flex: 1, padding: 14, borderRadius: 10, backgroundColor: '#e94560', alignItems: 'center' },
  saveText: { color: '#fff', fontWeight: 'bold' },
  card: { backgroundColor: '#16213e', borderRadius: 12, padding: 14, marginBottom: 10 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 10, backgroundColor: 'transparent' },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#0f3460', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  avatarText: { color: '#e94560', fontSize: 20, fontWeight: 'bold' },
  cardInfo: { flex: 1, backgroundColor: 'transparent' },
  userName: { color: '#fff', fontSize: 16, fontWeight: 'bold', marginBottom: 4 },
  roleBadge: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1 },
  roleText: { fontSize: 11, fontWeight: 'bold', textTransform: 'capitalize' },
  removeBtn: { padding: 8 },
  branchLabel: { color: '#aaa', fontSize: 13, marginBottom: 8 },
  branchValue: { color: '#fff' },
  actionsRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6, backgroundColor: 'transparent' },
  actionLabel: { color: '#555', fontSize: 12, marginRight: 8, minWidth: 36 },
  branchScroll: { flex: 1 },
  actionChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, borderWidth: 1, borderColor: '#0f3460', backgroundColor: '#0f3460', marginRight: 6 },
  actionChipText: { color: '#aaa', fontSize: 12 },
  empty: { alignItems: 'center', paddingTop: 40 },
  emptyText: { color: '#555', fontSize: 16, marginTop: 12 },
});
