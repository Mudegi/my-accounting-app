import React, { useState, useCallback } from 'react';
import {
  StyleSheet,
  TouchableOpacity,
  FlatList,
  TextInput,
  Alert,
  Modal,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Text, View } from '@/components/Themed';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useFocusEffect } from 'expo-router';

type Supplier = {
  id: string;
  name: string;
  tin: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  contact_person: string | null;
  created_at: string;
};

export default function SuppliersScreen() {
  const { business } = useAuth();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [tin, setTin] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const load = useCallback(async () => {
    if (!business) return;
    const { data } = await supabase
      .from('suppliers')
      .select('*')
      .eq('business_id', business.id)
      .order('name');
    if (data) setSuppliers(data);
  }, [business]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const resetForm = () => {
    setName(''); setTin(''); setPhone(''); setEmail('');
    setAddress(''); setContactPerson(''); setEditingId(null);
  };

  const openNew = () => { resetForm(); setShowForm(true); };

  const openEdit = (s: Supplier) => {
    setEditingId(s.id);
    setName(s.name);
    setTin(s.tin || '');
    setPhone(s.phone || '');
    setEmail(s.email || '');
    setAddress(s.address || '');
    setContactPerson(s.contact_person || '');
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!name.trim()) { Alert.alert('Error', 'Supplier name is required'); return; }
    if (!business) return;
    setSaving(true);

    const payload = {
      business_id: business.id,
      name: name.trim(),
      tin: tin.trim() || null,
      phone: phone.trim() || null,
      email: email.trim() || null,
      address: address.trim() || null,
      contact_person: contactPerson.trim() || null,
    };

    if (editingId) {
      const { error } = await supabase.from('suppliers').update(payload).eq('id', editingId);
      if (error) { Alert.alert('Error', error.message); setSaving(false); return; }
    } else {
      const { error } = await supabase.from('suppliers').insert(payload);
      if (error) { Alert.alert('Error', error.message); setSaving(false); return; }
    }

    setSaving(false);
    setShowForm(false);
    resetForm();
    load();
  };

  const handleDelete = (s: Supplier) => {
    Alert.alert('Delete Supplier', `Remove "${s.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          await supabase.from('suppliers').delete().eq('id', s.id);
          load();
        },
      },
    ]);
  };

  const filtered = searchQuery.trim()
    ? suppliers.filter(s =>
        s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (s.tin && s.tin.includes(searchQuery))
      )
    : suppliers;

  return (
    <View style={styles.container}>
      {/* Search */}
      <View style={styles.searchRow}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search suppliers..."
          placeholderTextColor="#666"
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
        <TouchableOpacity style={styles.addBtn} onPress={openNew}>
          <FontAwesome name="plus" size={16} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* List */}
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.card} onPress={() => openEdit(item)}>
            <View style={styles.cardHeader}>
              <View style={styles.cardInfo}>
                <Text style={styles.cardName}>{item.name}</Text>
                {business?.is_efris_enabled && item.tin ? <Text style={styles.cardSub}>TIN: {item.tin}</Text> : null}
                {item.phone ? <Text style={styles.cardSub}>📱 {item.phone}</Text> : null}
                {item.contact_person ? <Text style={styles.cardSub}>👤 {item.contact_person}</Text> : null}
              </View>
              <TouchableOpacity onPress={() => handleDelete(item)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <FontAwesome name="trash" size={16} color="#e94560" />
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <FontAwesome name="truck" size={48} color="#333" />
            <Text style={styles.emptyText}>No suppliers yet</Text>
            <Text style={styles.emptyHint}>Tap + to add a supplier</Text>
          </View>
        }
      />

      {/* Add/Edit Modal */}
      <Modal visible={showForm} animationType="slide" transparent>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <ScrollView>
              <Text style={styles.formTitle}>{editingId ? 'Edit Supplier' : 'New Supplier'}</Text>

              <Text style={styles.label}>Name *</Text>
              <TextInput style={styles.input} placeholder="Supplier / Company name" placeholderTextColor="#555" value={name} onChangeText={setName} />

              {business?.is_efris_enabled && (
                <>
                  <Text style={styles.label}>TIN (Tax ID)</Text>
                  <TextInput style={styles.input} placeholder="e.g. 1000000001" placeholderTextColor="#555" value={tin} onChangeText={setTin} keyboardType="numeric" />
                </>
              )}

              <Text style={styles.label}>Phone</Text>
              <TextInput style={styles.input} placeholder="+256..." placeholderTextColor="#555" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />

              <Text style={styles.label}>Email</Text>
              <TextInput style={styles.input} placeholder="email@example.com" placeholderTextColor="#555" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />

              <Text style={styles.label}>Address</Text>
              <TextInput style={styles.input} placeholder="Physical address" placeholderTextColor="#555" value={address} onChangeText={setAddress} />

              <Text style={styles.label}>Contact Person</Text>
              <TextInput style={styles.input} placeholder="Contact name" placeholderTextColor="#555" value={contactPerson} onChangeText={setContactPerson} />

              <TouchableOpacity
                style={[styles.saveBtn, saving && { opacity: 0.6 }]}
                onPress={handleSave}
                disabled={saving}
              >
                {saving ? <ActivityIndicator color="#fff" /> : (
                  <Text style={styles.saveBtnText}>{editingId ? 'Update Supplier' : 'Add Supplier'}</Text>
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
  searchRow: {
    flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 12, gap: 10,
    backgroundColor: 'transparent', alignItems: 'center',
  },
  searchInput: {
    flex: 1, backgroundColor: '#16213e', borderRadius: 10, padding: 12,
    color: '#fff', fontSize: 15, borderWidth: 1, borderColor: '#0f3460',
  },
  addBtn: {
    backgroundColor: '#e94560', width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
  },
  card: {
    backgroundColor: '#16213e', marginHorizontal: 16, marginBottom: 10,
    borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#0f3460',
  },
  cardHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
    backgroundColor: 'transparent',
  },
  cardInfo: { flex: 1, backgroundColor: 'transparent' },
  cardName: { fontSize: 16, fontWeight: 'bold', color: '#fff' },
  cardSub: { fontSize: 13, color: '#aaa', marginTop: 3 },
  emptyState: { alignItems: 'center', paddingTop: 60, backgroundColor: 'transparent' },
  emptyText: { color: '#555', fontSize: 16, marginTop: 12 },
  emptyHint: { color: '#444', fontSize: 13, marginTop: 4 },
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#1a1a2e', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 20, maxHeight: '85%',
  },
  formTitle: { fontSize: 20, fontWeight: 'bold', color: '#fff', marginBottom: 16 },
  label: { fontSize: 13, color: '#aaa', marginBottom: 4, marginTop: 10 },
  input: {
    backgroundColor: '#16213e', borderRadius: 10, padding: 12, color: '#fff',
    fontSize: 15, borderWidth: 1, borderColor: '#0f3460',
  },
  saveBtn: {
    backgroundColor: '#4CAF50', borderRadius: 12, padding: 16, alignItems: 'center',
    marginTop: 20,
  },
  saveBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  cancelBtn: { padding: 14, alignItems: 'center', marginTop: 8 },
  cancelBtnText: { color: '#aaa', fontSize: 15 },
});
