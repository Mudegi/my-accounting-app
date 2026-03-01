import React, { useState, useCallback } from 'react';
import {
  StyleSheet,
  TouchableOpacity,
  FlatList,
  TextInput,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Text, View } from '@/components/Themed';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useFocusEffect } from 'expo-router';

type Category = { id: string; name: string; ura_product_code: string | null };

export default function CategoriesScreen() {
  const { business } = useAuth();
  const efrisEnabled = business?.is_efris_enabled ?? false;
  const [categories, setCategories] = useState<Category[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [uraCode, setUraCode] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!business) return;
    const { data } = await supabase
      .from('categories')
      .select('*')
      .eq('business_id', business.id)
      .order('name');
    if (data) setCategories(data);
  }, [business]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleAdd = async () => {
    if (!name.trim()) { Alert.alert('Error', 'Category name is required'); return; }
    if (!business) return;
    setSaving(true);
    const { error } = await supabase.from('categories').insert({
      business_id: business.id,
      name: name.trim(),
      ura_product_code: uraCode.trim() || null,
    });
    if (error) Alert.alert('Error', error.message);
    else { setName(''); setUraCode(''); setShowForm(false); load(); }
    setSaving(false);
  };

  const handleDelete = (id: string, catName: string) => {
    Alert.alert('Delete Category', `Delete "${catName}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          await supabase.from('categories').delete().eq('id', id);
          load();
        }
      },
    ]);
  };

  return (
    <View style={styles.container}>
      <FlatList
        data={categories}
        keyExtractor={(c) => c.id}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.cardInfo}>
              <Text style={styles.cardName}>{item.name}</Text>
              {efrisEnabled && item.ura_product_code && (
                <Text style={styles.cardSub}>URA Code: {item.ura_product_code}</Text>
              )}
            </View>
            <TouchableOpacity onPress={() => handleDelete(item.id, item.name)}>
              <FontAwesome name="trash" size={18} color="#e94560" />
            </TouchableOpacity>
          </View>
        )}
        ListHeaderComponent={
          showForm ? (
            <View style={styles.formCard}>
              <Text style={styles.formTitle}>New Category</Text>
              <TextInput style={styles.input} placeholder="Category name *" placeholderTextColor="#555" value={name} onChangeText={setName} />
              {efrisEnabled && (
                <TextInput style={styles.input} placeholder="URA Product Code (for EFRIS)" placeholderTextColor="#555" value={uraCode} onChangeText={setUraCode} />
              )}
              <View style={styles.formButtons}>
                <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowForm(false)}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.saveBtn} onPress={handleAdd} disabled={saving}>
                  {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.saveText}>Add</Text>}
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <TouchableOpacity style={styles.addButton} onPress={() => setShowForm(true)}>
              <FontAwesome name="plus" size={16} color="#fff" />
              <Text style={styles.addButtonText}>Add Category</Text>
            </TouchableOpacity>
          )
        }
        ListEmptyComponent={
          !showForm ? (
            <View style={styles.empty}>
              <FontAwesome name="tags" size={48} color="#333" />
              <Text style={styles.emptyText}>No categories yet</Text>
            </View>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e', padding: 16 },
  card: { backgroundColor: '#16213e', borderRadius: 12, padding: 16, marginBottom: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardInfo: { backgroundColor: 'transparent' },
  cardName: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  cardSub: { color: '#aaa', fontSize: 13, marginTop: 3 },
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
  empty: { alignItems: 'center', paddingTop: 60 },
  emptyText: { color: '#555', fontSize: 16, marginTop: 12 },
});
