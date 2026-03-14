import React, { useState, useCallback } from 'react';
import {
  StyleSheet,
  TouchableOpacity,
  FlatList,
  TextInput,
  Alert,
  ActivityIndicator,
  Modal,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Linking,
} from 'react-native';
import { Text, View } from '@/components/Themed';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useFocusEffect } from 'expo-router';

type FieldCustomer = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  created_by: string | null;
  created_by_name: string;
  created_at: string;
};

export default function FieldCustomersScreen() {
  const { business, profile } = useAuth();
  const isAdmin = profile?.role === 'admin' || profile?.role === 'branch_manager';
  const [customers, setCustomers] = useState<FieldCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Form fields
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');

  const load = useCallback(async () => {
    if (!business || !profile) return;
    setLoading(true);
    let query = supabase
      .from('customers')
      .select('id, name, phone, email, address, created_by, created_at')
      .eq('business_id', business.id)
      .eq('source', 'field')
      .order('created_at', { ascending: false });

    // Non-admins see only their own field customers
    if (!isAdmin) {
      query = query.eq('created_by', profile.id);
    }

    const { data } = await query.limit(200);

    if (data) {
      // Get creator names
      const creatorIds = [...new Set((data as any[]).map(c => c.created_by).filter(Boolean))];
      const creatorMap: Record<string, string> = {};
      if (creatorIds.length > 0) {
        const { data: creators } = await supabase
          .from('profiles')
          .select('id, full_name')
          .in('id', creatorIds);
        creators?.forEach((p: any) => { creatorMap[p.id] = p.full_name; });
      }

      setCustomers(data.map((c: any) => ({
        id: c.id,
        name: c.name,
        phone: c.phone,
        email: c.email,
        address: c.address,
        created_by: c.created_by,
        created_by_name: creatorMap[c.created_by] || '?',
        created_at: c.created_at,
      })));
    }
    setLoading(false);
  }, [business, profile, isAdmin]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const resetForm = () => {
    setName(''); setPhone(''); setEmail(''); setAddress(''); setEditingId(null);
  };

  const openNew = () => { resetForm(); setShowForm(true); };

  const openEdit = (c: FieldCustomer) => {
    setEditingId(c.id);
    setName(c.name);
    setPhone(c.phone || '');
    setEmail(c.email || '');
    setAddress(c.address || '');
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!name.trim()) { Alert.alert('Error', 'Customer name is required'); return; }
    if (!phone.trim()) { Alert.alert('Error', 'Phone number is required for field customers'); return; }
    if (!business || !profile) return;

    setSaving(true);
    const payload = {
      business_id: business.id,
      name: name.trim(),
      phone: phone.trim(),
      email: email.trim() || null,
      address: address.trim() || null,
      source: 'field' as const,
      created_by: profile.id,
      buyer_type: '1',
    };

    if (editingId) {
      const { error } = await supabase.from('customers').update(payload).eq('id', editingId);
      if (error) { Alert.alert('Error', error.message); setSaving(false); return; }
    } else {
      const { error } = await supabase.from('customers').insert(payload);
      if (error) { Alert.alert('Error', error.message); setSaving(false); return; }
    }

    setSaving(false);
    setShowForm(false);
    resetForm();
    load();
  };

  const handleDelete = (c: FieldCustomer) => {
    Alert.alert('Delete Customer', `Remove "${c.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          await supabase.from('customers').delete().eq('id', c.id);
          load();
        },
      },
    ]);
  };

  const callCustomer = (phone: string) => {
    Linking.openURL(`tel:${phone}`);
  };

  const filtered = searchQuery.trim()
    ? customers.filter(c =>
        c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (c.phone && c.phone.includes(searchQuery))
      )
    : customers;

  return (
    <View style={styles.container}>
      {/* Search + Add */}
      <View style={styles.searchRow}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search by name or phone..."
          placeholderTextColor="#666"
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
        <TouchableOpacity style={styles.addBtn} onPress={openNew}>
          <FontAwesome name="plus" size={16} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* Stats */}
      <View style={styles.statsBar}>
        <Text style={styles.statsText}>{customers.length} field customer{customers.length !== 1 ? 's' : ''}</Text>
      </View>

      {/* List */}
      {loading ? (
        <ActivityIndicator color="#e94560" style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={c => c.id}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.card} onPress={() => openEdit(item)}>
              <View style={styles.cardHeader}>
                <View style={{ flex: 1, backgroundColor: 'transparent' }}>
                  <Text style={styles.cardName}>{item.name}</Text>
                  <TouchableOpacity
                    onPress={() => item.phone && callCustomer(item.phone)}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4, backgroundColor: 'transparent' }}
                  >
                    <FontAwesome name="phone" size={14} color="#4CAF50" />
                    <Text style={styles.cardPhone}>{item.phone || 'No phone'}</Text>
                  </TouchableOpacity>
                  {item.email && <Text style={styles.cardSub}>✉️ {item.email}</Text>}
                  {isAdmin && (
                    <Text style={styles.cardCreator}>Added by {item.created_by_name}</Text>
                  )}
                </View>
                <TouchableOpacity onPress={() => handleDelete(item)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <FontAwesome name="trash" size={16} color="#e94560" />
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <FontAwesome name="users" size={48} color="#333" />
              <Text style={styles.emptyText}>No field customers yet</Text>
              <Text style={styles.emptyHint}>Customers are added automatically during field sales</Text>
            </View>
          }
        />
      )}

      {/* Add/Edit Modal */}
      <Modal visible={showForm} animationType="slide" transparent>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <ScrollView>
              <Text style={styles.formTitle}>{editingId ? 'Edit Customer' : 'New Field Customer'}</Text>

              <Text style={styles.label}>Name *</Text>
              <TextInput style={styles.input} placeholder="Customer name" placeholderTextColor="#555" value={name} onChangeText={setName} />

              <Text style={styles.label}>Phone Number *</Text>
              <TextInput style={styles.input} placeholder="+256 700 123456" placeholderTextColor="#555" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />

              <Text style={styles.label}>Email</Text>
              <TextInput style={styles.input} placeholder="email@example.com" placeholderTextColor="#555" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />

              <Text style={styles.label}>Address</Text>
              <TextInput style={styles.input} placeholder="Physical address" placeholderTextColor="#555" value={address} onChangeText={setAddress} />

              <TouchableOpacity
                style={[styles.saveBtn, saving && { opacity: 0.6 }]}
                onPress={handleSave}
                disabled={saving}
              >
                {saving ? <ActivityIndicator color="#fff" /> : (
                  <Text style={styles.saveBtnText}>{editingId ? 'Update Customer' : 'Add Customer'}</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity style={styles.cancelBtn} onPress={() => { setShowForm(false); resetForm(); }}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  searchRow: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 12, gap: 10, backgroundColor: 'transparent', alignItems: 'center' },
  searchInput: { flex: 1, backgroundColor: '#16213e', borderRadius: 10, padding: 12, color: '#fff', fontSize: 15, borderWidth: 1, borderColor: '#0f3460' },
  addBtn: { backgroundColor: '#e94560', width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  statsBar: { paddingHorizontal: 16, marginBottom: 8, backgroundColor: 'transparent' },
  statsText: { color: '#666', fontSize: 12 },
  card: { backgroundColor: '#16213e', marginHorizontal: 16, marginBottom: 10, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#0f3460' },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', backgroundColor: 'transparent' },
  cardName: { fontSize: 16, fontWeight: 'bold', color: '#fff' },
  cardPhone: { fontSize: 14, color: '#4CAF50', fontWeight: '600' },
  cardSub: { fontSize: 13, color: '#aaa', marginTop: 3 },
  cardCreator: { fontSize: 11, color: '#666', marginTop: 4, fontStyle: 'italic' },
  empty: { alignItems: 'center', paddingTop: 60, backgroundColor: 'transparent' },
  emptyText: { color: '#555', fontSize: 16, marginTop: 12 },
  emptyHint: { color: '#444', fontSize: 13, marginTop: 4 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#1a1a2e', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: '90%' },
  formTitle: { fontSize: 20, fontWeight: 'bold', color: '#fff', marginBottom: 16 },
  label: { fontSize: 13, color: '#aaa', marginBottom: 4, marginTop: 10 },
  input: { backgroundColor: '#16213e', borderRadius: 10, padding: 12, color: '#fff', fontSize: 15, borderWidth: 1, borderColor: '#0f3460' },
  saveBtn: { backgroundColor: '#4CAF50', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 20 },
  saveBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  cancelBtn: { padding: 14, alignItems: 'center', marginTop: 8 },
  cancelBtnText: { color: '#aaa', fontSize: 15 },
});
