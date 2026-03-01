import React, { useState, useCallback } from 'react';
import {
  StyleSheet,
  TouchableOpacity,
  FlatList,
  TextInput,
  Alert,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { Text, View } from '@/components/Themed';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useFocusEffect, useRouter, Redirect } from 'expo-router';

type User = {
  id: string;
  full_name: string;
  role: string;
  branch_name: string | null;
  branch_id: string | null;
};

const ROLES = ['admin', 'branch_manager', 'salesperson'] as const;

export default function UsersScreen() {
  const { business, branches, profile } = useAuth();

  // Admin-only route guard
  if (profile && profile.role !== 'admin') {
    return <Redirect href="/" />;
  }

  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<string>('salesperson');
  const [branchId, setBranchId] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!business) return;
    setLoading(true);
    const { data } = await supabase
      .from('profiles')
      .select(`id, full_name, role, branch_id, branches(name)`)
      .eq('business_id', business.id)
      .order('full_name');

    if (data) {
      setUsers(data.map((u: any) => ({
        id: u.id,
        full_name: u.full_name,
        role: u.role,
        branch_id: u.branch_id,
        branch_name: u.branches?.name || null,
      })));
    }
    setLoading(false);
  }, [business]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleInvite = async () => {
    if (!email.trim() || !fullName.trim()) { Alert.alert('Error', 'Enter name and email'); return; }
    if (!branchId) { Alert.alert('Error', 'Select a branch for this user'); return; }
    if (!business || !profile) return;

    setSaving(true);
    const tempPassword = Math.random().toString(36).slice(-8) + 'A1!';

    // Save admin session before creating new user (signUp may auto-sign-in the new user)
    const { data: { session: adminSession } } = await supabase.auth.getSession();

    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password: tempPassword,
      options: { data: { needs_password_change: true, invited_by: profile.full_name } },
    });

    if (error) {
      // Restore admin session if needed
      if (adminSession) {
        await supabase.auth.setSession({ access_token: adminSession.access_token, refresh_token: adminSession.refresh_token });
      }
      Alert.alert('Error', error.message); setSaving(false); return;
    }

    // Restore the admin's session immediately (signUp may have replaced it)
    if (adminSession) {
      await supabase.auth.setSession({ access_token: adminSession.access_token, refresh_token: adminSession.refresh_token });
    }

    const userId = data.user?.id;
    if (!userId) { Alert.alert('Error', 'Failed to create account'); setSaving(false); return; }

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
        'User Invited',
        `Account created!\n\nShare these credentials with ${fullName.trim()}:\n\nEmail: ${email.trim()}\nTemp Password: ${tempPassword}\n\nSteps for the new user:\n1. Open YourBooks and sign in with these credentials\n2. If asked, confirm their email first\n3. Go to Settings → Change Password\n4. Set a personal password`,
        [{ text: 'OK', onPress: () => { setShowInvite(false); setEmail(''); setFullName(''); setRole('salesperson'); setBranchId(''); load(); } }]
      );
    }
    setSaving(false);
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
    Alert.alert('Remove User', `Remove ${userName} from this business?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          await supabase.from('profiles').delete().eq('id', userId);
          load();
        }
      }
    ]);
  };

  const roleColor = (r: string) => {
    if (r === 'admin') return '#e94560';
    if (r === 'branch_manager') return '#FF9800';
    return '#4CAF50';
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.inviteBtn} onPress={() => setShowInvite(!showInvite)}>
        <FontAwesome name="user-plus" size={16} color="#fff" />
        <Text style={styles.inviteBtnText}>Invite New User</Text>
      </TouchableOpacity>

      {showInvite && (
        <View style={styles.formCard}>
          <Text style={styles.formTitle}>Invite User</Text>
          <TextInput style={styles.input} placeholder="Full Name" placeholderTextColor="#555" value={fullName} onChangeText={setFullName} />
          <TextInput style={styles.input} placeholder="Email Address" placeholderTextColor="#555" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />

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
              {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.saveText}>Send Invite</Text>}
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
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{item.full_name.charAt(0).toUpperCase()}</Text>
                </View>
                <View style={styles.cardInfo}>
                  <Text style={styles.userName}>{item.full_name}</Text>
                  <View style={[styles.roleBadge, { backgroundColor: roleColor(item.role) + '22', borderColor: roleColor(item.role) }]}>
                    <Text style={[styles.roleText, { color: roleColor(item.role) }]}>{item.role.replace('_', ' ')}</Text>
                  </View>
                </View>
                {item.id !== profile?.id && (
                  <TouchableOpacity onPress={() => handleRemove(item.id, item.full_name)} style={styles.removeBtn}>
                    <FontAwesome name="trash" size={16} color="#e94560" />
                  </TouchableOpacity>
                )}
              </View>

              <Text style={styles.branchLabel}>Branch: <Text style={styles.branchValue}>{item.branch_name || 'None'}</Text></Text>

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
