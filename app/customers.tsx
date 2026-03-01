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
} from 'react-native';
import { Text, View } from '@/components/Themed';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useFocusEffect } from 'expo-router';

const BUYER_TYPES = [
  { code: '0', label: 'B2B (Business)' },
  { code: '1', label: 'B2C (Walk-in)' },
  { code: '2', label: 'Foreigner' },
  { code: '3', label: 'B2G (Government)' },
];

type Customer = {
  id: string;
  name: string;
  tin: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  buyer_type: string;
  contact_person: string | null;
  created_at: string;
};

export default function CustomersScreen() {
  const { business } = useAuth();
  const efrisEnabled = business?.is_efris_enabled ?? false;
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [tin, setTin] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [buyerType, setBuyerType] = useState('1'); // B2C default
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const load = useCallback(async () => {
    if (!business) return;
    const { data } = await supabase
      .from('customers')
      .select('*')
      .eq('business_id', business.id)
      .order('name');
    if (data) setCustomers(data);
  }, [business]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const resetForm = () => {
    setName(''); setTin(''); setPhone(''); setEmail('');
    setAddress(''); setContactPerson(''); setBuyerType('1'); setEditingId(null);
  };

  const openNew = () => { resetForm(); setShowForm(true); };

  const openEdit = (c: Customer) => {
    setEditingId(c.id);
    setName(c.name);
    setTin(c.tin || '');
    setPhone(c.phone || '');
    setEmail(c.email || '');
    setAddress(c.address || '');
    setContactPerson(c.contact_person || '');
    setBuyerType(c.buyer_type || '1');
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!name.trim()) { Alert.alert('Error', 'Customer name is required'); return; }
    if (efrisEnabled && buyerType === '0' && !tin.trim()) { Alert.alert('Error', 'TIN is required for B2B customers'); return; }
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
      buyer_type: buyerType,
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

  const handleDelete = (c: Customer) => {
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

  const getBuyerLabel = (code: string) => BUYER_TYPES.find(b => b.code === code)?.label || code;

  const filtered = searchQuery.trim()
    ? customers.filter(c =>
        c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (c.tin && c.tin.includes(searchQuery)) ||
        (c.phone && c.phone.includes(searchQuery))
      )
    : customers;

  return (
    <View style={styles.container}>
      {/* Search */}
      <View style={styles.searchRow}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search customers..."
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
                {efrisEnabled && (
                  <View style={[styles.buyerBadge, item.buyer_type === '0' ? styles.badgeB2B : item.buyer_type === '3' ? styles.badgeB2G : item.buyer_type === '2' ? styles.badgeForeign : styles.badgeB2C]}>
                    <Text style={styles.buyerBadgeText}>{getBuyerLabel(item.buyer_type)}</Text>
                  </View>
                )}
                {efrisEnabled && item.tin ? <Text style={styles.cardSub}>TIN: {item.tin}</Text> : null}
                {item.phone ? <Text style={styles.cardSub}>📱 {item.phone}</Text> : null}
              </View>
              <TouchableOpacity onPress={() => handleDelete(item)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <FontAwesome name="trash" size={16} color="#e94560" />
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <FontAwesome name="users" size={48} color="#333" />
            <Text style={styles.emptyText}>No customers yet</Text>
            <Text style={styles.emptyHint}>Tap + to add a customer</Text>
          </View>
        }
      />

      {/* Add/Edit Modal */}
      <Modal visible={showForm} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <ScrollView>
              <Text style={styles.formTitle}>{editingId ? 'Edit Customer' : 'New Customer'}</Text>

              {efrisEnabled && (
                <>
                  <Text style={styles.label}>Buyer Type</Text>
                  <View style={styles.chipRow}>
                    {BUYER_TYPES.map((bt) => (
                      <TouchableOpacity
                        key={bt.code}
                        style={[styles.chip, buyerType === bt.code && styles.chipActive]}
                        onPress={() => setBuyerType(bt.code)}
                      >
                        <Text style={[styles.chipText, buyerType === bt.code && { color: '#fff' }]}>{bt.label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              )}

              <Text style={styles.label}>Name *</Text>
              <TextInput style={styles.input} placeholder="Customer / Company name" placeholderTextColor="#555" value={name} onChangeText={setName} />

              {efrisEnabled && (buyerType === '0' || buyerType === '3') && (
                <>
                  <Text style={styles.label}>TIN (Tax ID) *</Text>
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
                  <Text style={styles.saveBtnText}>{editingId ? 'Update Customer' : 'Add Customer'}</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity style={styles.cancelBtn} onPress={() => { setShowForm(false); resetForm(); }}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
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
  buyerBadge: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, marginTop: 4 },
  badgeB2B: { backgroundColor: '#0f3460' },
  badgeB2C: { backgroundColor: '#2d6a4f' },
  badgeForeign: { backgroundColor: '#533483' },
  badgeB2G: { backgroundColor: '#7C3AED' },
  buyerBadgeText: { fontSize: 11, color: '#fff', fontWeight: 'bold' },
  emptyState: { alignItems: 'center', paddingTop: 60, backgroundColor: 'transparent' },
  emptyText: { color: '#555', fontSize: 16, marginTop: 12 },
  emptyHint: { color: '#444', fontSize: 13, marginTop: 4 },
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#1a1a2e', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 20, maxHeight: '90%',
  },
  formTitle: { fontSize: 20, fontWeight: 'bold', color: '#fff', marginBottom: 16 },
  label: { fontSize: 13, color: '#aaa', marginBottom: 4, marginTop: 10 },
  input: {
    backgroundColor: '#16213e', borderRadius: 10, padding: 12, color: '#fff',
    fontSize: 15, borderWidth: 1, borderColor: '#0f3460',
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4, backgroundColor: 'transparent' },
  chip: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8,
    backgroundColor: '#16213e', borderWidth: 1, borderColor: '#0f3460',
  },
  chipActive: { backgroundColor: '#e94560', borderColor: '#e94560' },
  chipText: { fontSize: 13, color: '#aaa' },
  saveBtn: {
    backgroundColor: '#4CAF50', borderRadius: 12, padding: 16, alignItems: 'center',
    marginTop: 20,
  },
  saveBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  cancelBtn: { padding: 14, alignItems: 'center', marginTop: 8 },
  cancelBtnText: { color: '#aaa', fontSize: 15 },
});
