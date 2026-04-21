import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Alert,
  ActivityIndicator,
  Modal,
} from 'react-native';
import { Text, View } from '@/components/Themed';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter } from 'expo-router';

type TaxRate = {
  id: string;
  name: string;
  code: string;
  rate: number;
  is_active: boolean;
  is_default: boolean;
};

export default function TaxSettingsScreen() {
  const { business, taxes, reloadUserData, fmt } = useAuth();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingTax, setEditingTax] = useState<TaxRate | null>(null);

  // Form state
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [rate, setRate] = useState('');
  const [isDefault, setIsDefault] = useState(false);

  const openForm = (tax?: TaxRate) => {
    if (tax) {
      setEditingTax(tax);
      setName(tax.name);
      setCode(tax.code);
      setRate((tax.rate * 100).toString());
      setIsDefault(tax.is_default);
    } else {
      setEditingTax(null);
      setName('');
      setCode('');
      setRate('');
      setIsDefault(false);
    }
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!name.trim() || !code.trim() || !rate.trim()) {
      Alert.alert('Error', 'Please fill all required fields');
      return;
    }

    if (!business) return;

    setLoading(true);
    try {
      const taxData = {
        business_id: business.id,
        name: name.trim(),
        code: code.trim(),
        rate: parseFloat(rate) / 100,
        is_default: isDefault,
        updated_at: new Date().toISOString(),
      };

      if (isDefault) {
        // Clear other defaults first
        await supabase
          .from('tax_rates')
          .update({ is_default: false })
          .eq('business_id', business.id);
      }

      if (editingTax) {
        const { error } = await supabase
          .from('tax_rates')
          .update(taxData)
          .eq('id', editingTax.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('tax_rates')
          .insert(taxData);
        if (error) throw error;
      }

      await reloadUserData();
      setShowForm(false);
      Alert.alert('Success', 'Tax rate saved');
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setLoading(false);
    }
  };

  const toggleActive = async (tax: TaxRate) => {
    setLoading(true);
    try {
      const { error } = await supabase
        .from('tax_rates')
        .update({ is_active: !tax.is_active })
        .eq('id', tax.id);
      
      if (error) throw error;
      await reloadUserData();
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <Text style={styles.title}>Tax Configurations</Text>
          <Text style={styles.subtitle}>Define the taxes used in your business globally.</Text>
        </View>

        {business?.is_efris_enabled && (
          <View style={styles.efrisWarning}>
            <FontAwesome name="info-circle" size={16} color="#7C3AED" />
            <Text style={styles.efrisWarningText}>
              EFRIS is enabled. Ensure your tax Codes (01, 02, etc.) match URA requirements.
            </Text>
          </View>
        )}

        <View style={styles.list}>
          {taxes.map((tax) => (
            <TouchableOpacity 
              key={tax.id} 
              style={[styles.taxCard, !tax.is_active && styles.inactiveCard]}
              onPress={() => openForm(tax)}
            >
              <View style={styles.taxInfo}>
                <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'transparent' }}>
                  <Text style={styles.taxName}>{tax.name}</Text>
                  {tax.is_default && (
                    <View style={styles.defaultBadge}>
                      <Text style={styles.defaultBadgeText}>DEFAULT</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.taxMeta}>Code: {tax.code} • Rate: {(tax.rate * 100).toFixed(1)}%</Text>
              </View>
              
              <View style={styles.taxActions}>
                <TouchableOpacity 
                  style={[styles.toggleBtn, tax.is_active ? styles.toggleBtnActive : styles.toggleBtnInactive]}
                  onPress={() => toggleActive(tax)}
                >
                  <Text style={styles.toggleBtnText}>{tax.is_active ? 'Active' : 'Inactive'}</Text>
                </TouchableOpacity>
                <FontAwesome name="chevron-right" size={12} color="#555" />
              </View>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity style={styles.addButton} onPress={() => openForm()}>
          <FontAwesome name="plus" size={16} color="#fff" />
          <Text style={styles.addButtonText}>Add New Tax Category</Text>
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Add/Edit Modal */}
      <Modal visible={showForm} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{editingTax ? 'Edit Tax' : 'New Tax Category'}</Text>
              <TouchableOpacity onPress={() => setShowForm(false)}>
                <FontAwesome name="times" size={20} color="#aaa" />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ padding: 20 }}>
              <View style={styles.field}>
                <Text style={styles.label}>Display Name *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. VAT 18%"
                  placeholderTextColor="#666"
                  value={name}
                  onChangeText={setName}
                />
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>Code (Internal/EFRIS) *</Text>
                <Text style={styles.hint}>e.g. 01 for Standard, 02 for Zero Rated</Text>
                <TextInput
                  style={styles.input}
                  placeholder="01"
                  placeholderTextColor="#666"
                  value={code}
                  onChangeText={setCode}
                />
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>Tax Rate (%) *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="18"
                  placeholderTextColor="#666"
                  value={rate}
                  onChangeText={setRate}
                  keyboardType="numeric"
                />
              </View>

              <TouchableOpacity 
                style={styles.checkboxRow}
                onPress={() => setIsDefault(!isDefault)}
              >
                <View style={[styles.checkbox, isDefault && styles.checkboxChecked]}>
                  {isDefault && <FontAwesome name="check" size={12} color="#fff" />}
                </View>
                <Text style={styles.checkboxLabel}>Set as default for new products</Text>
              </TouchableOpacity>

              <TouchableOpacity 
                style={[styles.saveButton, loading && { opacity: 0.7 }]}
                onPress={handleSave}
                disabled={loading}
              >
                {loading ? <ActivityIndicator color="#fff" /> : (
                  <Text style={styles.saveButtonText}>Save Configuration</Text>
                )}
              </TouchableOpacity>
              
              <View style={{ height: 40 }} />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  scroll: { padding: 20 },
  header: { marginBottom: 24 },
  title: { color: '#fff', fontSize: 24, fontWeight: 'bold' },
  subtitle: { color: '#888', fontSize: 14, marginTop: 4 },
  efrisWarning: { flexDirection: 'row', backgroundColor: '#7C3AED15', padding: 12, borderRadius: 10, alignItems: 'center', marginBottom: 20, borderWidth: 1, borderColor: '#7C3AED33' },
  efrisWarningText: { color: '#7C3AED', fontSize: 12, marginLeft: 10, flex: 1 },
  list: { marginBottom: 20 },
  taxCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#16213e', borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: '#0f3460' },
  inactiveCard: { opacity: 0.5 },
  taxInfo: { flex: 1, backgroundColor: 'transparent' },
  taxName: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  taxMeta: { color: '#888', fontSize: 13, marginTop: 4 },
  taxActions: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: 'transparent' },
  defaultBadge: { backgroundColor: '#4CAF5022', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, marginLeft: 8 },
  defaultBadgeText: { color: '#4CAF50', fontSize: 9, fontWeight: 'bold' },
  toggleBtn: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  toggleBtnActive: { backgroundColor: '#4CAF5022' },
  toggleBtnInactive: { backgroundColor: '#5552' },
  toggleBtnText: { color: '#fff', fontSize: 11, fontWeight: 'bold' },
  addButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#0f3460', borderRadius: 16, padding: 16, gap: 10, borderStyle: 'dashed', borderWidth: 1, borderColor: '#2196F3' },
  addButtonText: { color: '#2196F3', fontWeight: 'bold', fontSize: 15 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#16213e', borderTopLeftRadius: 24, borderTopRightRadius: 24, height: '80%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 1, borderBottomColor: '#0f3460' },
  modalTitle: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  field: { marginBottom: 20 },
  label: { color: '#aaa', fontSize: 13, marginBottom: 8 },
  hint: { color: '#666', fontSize: 11, marginBottom: 6 },
  input: { backgroundColor: '#0f3460', borderRadius: 12, padding: 14, color: '#fff', fontSize: 16 },
  checkboxRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 24 },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: '#0f3460', alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  checkboxChecked: { backgroundColor: '#4CAF50', borderColor: '#4CAF50' },
  checkboxLabel: { color: '#fff', fontSize: 14 },
  saveButton: { backgroundColor: '#e94560', borderRadius: 16, padding: 18, alignItems: 'center' },
  saveButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
});
