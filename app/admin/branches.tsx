import React, { useState, useCallback } from 'react';
import {
  StyleSheet,
  TouchableOpacity,
  FlatList,
  TextInput,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Text, View } from '@/components/Themed';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useFocusEffect, Redirect } from 'expo-router';

type Branch = {
  id: string;
  name: string;
  location: string | null;
  phone: string | null;
  is_efris_enabled: boolean;
};

export default function BranchesScreen() {
  const { business, profile, subscriptionStatus } = useAuth();

  // Admin-only route guard
  if (profile && profile.role !== 'admin') {
    return <Redirect href="/" />;
  }

  const [branches, setBranches] = useState<Branch[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);

  const maxBranches = subscriptionStatus?.max_branches ?? -1; // -1 = unlimited
  const branchLimitReached = maxBranches > 0 && branches.length >= maxBranches;

  const load = useCallback(async () => {
    if (!business) return;
    const { data } = await supabase
      .from('branches')
      .select('*')
      .eq('business_id', business.id)
      .order('name');
    if (data) setBranches(data);
  }, [business]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleAdd = async () => {
    if (!name.trim()) { Alert.alert('Error', 'Branch name is required'); return; }
    if (!business) return;

    // Enforce plan branch limit
    if (branchLimitReached) {
      Alert.alert(
        'Branch Limit Reached',
        `Your ${subscriptionStatus?.display_name || 'current'} plan allows up to ${maxBranches} branch${maxBranches === 1 ? '' : 'es'}. Upgrade your plan to add more branches.`
      );
      return;
    }

    setSaving(true);
    const { error } = await supabase.from('branches').insert({
      business_id: business.id,
      name: name.trim(),
      location: location.trim() || null,
      phone: phone.trim() || null,
    });
    if (error) Alert.alert('Error', error.message);
    else {
      setName(''); setLocation(''); setPhone('');
      setShowForm(false);
      load();
    }
    setSaving(false);
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
    <View style={styles.container}>
      <FlatList
        data={branches}
        keyExtractor={(b) => b.id}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.cardLeft}>
              <Text style={styles.cardName}>{item.name}</Text>
              {item.location && <Text style={styles.cardSub}>📍 {item.location}</Text>}
              {item.phone && <Text style={styles.cardSub}>📞 {item.phone}</Text>}
              {item.is_efris_enabled && (
                <View style={styles.efrisBadge}><Text style={styles.efrisBadgeText}>EFRIS ON</Text></View>
              )}
            </View>
          </View>
        )}
        ListHeaderComponent={
          showForm ? (
            <View style={styles.formCard}>
              <Text style={styles.formTitle}>New Branch</Text>
              <TextInput style={styles.input} placeholder="Branch name *" placeholderTextColor="#555" value={name} onChangeText={setName} />
              <TextInput style={styles.input} placeholder="Location (e.g. Kampala Road)" placeholderTextColor="#555" value={location} onChangeText={setLocation} />
              <TextInput style={styles.input} placeholder="Phone number" placeholderTextColor="#555" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
              <View style={styles.formButtons}>
                <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowForm(false)}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.saveBtn} onPress={handleAdd} disabled={saving}>
                  {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.saveText}>Add Branch</Text>}
                </TouchableOpacity>
              </View>
            </View>
          ) : branchLimitReached ? (
            <View style={styles.limitBanner}>
              <FontAwesome name="lock" size={16} color="#FF9800" />
              <Text style={styles.limitText}>
                Branch limit reached ({branches.length}/{maxBranches}). Upgrade your plan to add more.
              </Text>
            </View>
          ) : (
            <TouchableOpacity style={styles.addButton} onPress={() => setShowForm(true)}>
              <FontAwesome name="plus" size={16} color="#fff" />
              <Text style={styles.addButtonText}>Add New Branch</Text>
            </TouchableOpacity>
          )
        }
        ListEmptyComponent={
          !showForm ? (
            <View style={styles.empty}>
              <FontAwesome name="building" size={48} color="#333" />
              <Text style={styles.emptyText}>No branches yet</Text>
            </View>
          ) : null
        }
      />
    </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e', padding: 16 },
  card: { backgroundColor: '#16213e', borderRadius: 12, padding: 16, marginBottom: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardLeft: { backgroundColor: 'transparent' },
  cardName: { color: '#fff', fontSize: 17, fontWeight: 'bold' },
  cardSub: { color: '#aaa', fontSize: 13, marginTop: 3 },
  efrisBadge: { backgroundColor: '#4CAF5033', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2, marginTop: 6, alignSelf: 'flex-start' },
  efrisBadgeText: { color: '#4CAF50', fontSize: 11, fontWeight: 'bold' },
  formCard: { backgroundColor: '#16213e', borderRadius: 16, padding: 16, marginBottom: 16 },
  formTitle: { color: '#fff', fontSize: 18, fontWeight: 'bold', marginBottom: 14 },
  input: { backgroundColor: '#0f3460', borderRadius: 10, padding: 14, color: '#fff', fontSize: 15, marginBottom: 10 },
  formButtons: { flexDirection: 'row', gap: 10 },
  cancelBtn: { flex: 1, padding: 14, borderRadius: 10, backgroundColor: '#333', alignItems: 'center' },
  cancelText: { color: '#aaa', fontWeight: 'bold' },
  saveBtn: { flex: 1, padding: 14, borderRadius: 10, backgroundColor: '#e94560', alignItems: 'center' },
  saveText: { color: '#fff', fontWeight: 'bold' },
  addButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#e94560', borderRadius: 12, padding: 14, marginBottom: 16, gap: 8 },
  addButtonText: { color: '#fff', fontWeight: 'bold', fontSize: 15 },
  limitBanner: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FF980022', borderRadius: 12, padding: 14, marginBottom: 16, gap: 10, borderWidth: 1, borderColor: '#FF9800' },
  limitText: { color: '#FF9800', fontSize: 13, fontWeight: '600', flex: 1 },
  empty: { alignItems: 'center', paddingTop: 60 },
  emptyText: { color: '#555', fontSize: 16, marginTop: 12 },
});
