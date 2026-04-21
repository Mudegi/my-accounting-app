import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Modal,
  TextInput,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Text, View } from '@/components/Themed';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { supabase } from '@/lib/supabase';

interface UnitSearchModalProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (unit: { code: string; name: string }) => void;
}

export default function UnitSearchModal({ visible, onClose, onSelect }: UnitSearchModalProps) {
  const [search, setSearch] = useState('');
  const [units, setUnits] = useState<{ code: string; name: string }[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (visible && search.length === 0) {
      loadInitialUnits();
    }
  }, [visible]);

  const loadInitialUnits = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('units_of_measure')
      .select('code, name')
      .order('name')
      .limit(50);
    if (data) setUnits(data);
    setLoading(false);
  };

  const handleSearch = async (text: string) => {
    setSearch(text);
    if (text.length < 2) return;

    setLoading(true);
    const { data } = await supabase
      .from('units_of_measure')
      .select('code, name')
      .or(`name.ilike.%${text}%,code.ilike.%${text}%`)
      .order('name')
      .limit(50);
    
    if (data) setUnits(data);
    setLoading(false);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <View style={styles.overlay}>
          <View style={styles.content}>
            <View style={styles.header}>
              <Text style={styles.title}>Search Unit of Measure</Text>
              <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                <FontAwesome name="times" size={24} color="#fff" />
              </TouchableOpacity>
            </View>

            <View style={styles.searchContainer}>
              <FontAwesome name="search" size={16} color="#666" />
              <TextInput
                style={styles.searchInput}
                placeholder="Type unit name (e.g. Gram, Drum, Box)..."
                placeholderTextColor="#666"
                value={search}
                onChangeText={handleSearch}
                autoFocus
              />
            </View>

            {loading && <ActivityIndicator color="#e94560" style={{ marginBottom: 10 }} />}

            <FlatList
              data={units}
              keyExtractor={(item) => item.code}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.unitItem}
                  onPress={() => {
                    onSelect(item);
                    onClose();
                  }}
                >
                  <View style={{ flex: 1, backgroundColor: 'transparent' }}>
                    <Text style={styles.unitName}>{item.name}</Text>
                    <Text style={styles.unitCode}>Code: {item.code}</Text>
                  </View>
                  <FontAwesome name="chevron-right" size={14} color="#333" />
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <View style={styles.empty}>
                  <Text style={{ color: '#555' }}>
                    {search.length > 0 ? 'No matching units found' : 'Type to start searching...'}
                  </Text>
                </View>
              }
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'flex-end' },
  content: { backgroundColor: '#1a1a2e', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, height: '80%' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, backgroundColor: 'transparent' },
  title: { fontSize: 20, fontWeight: 'bold', color: '#fff' },
  closeBtn: { padding: 4 },
  searchContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#16213e', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 16 },
  searchInput: { flex: 1, color: '#fff', fontSize: 16, marginLeft: 10 },
  unitItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#0f3460', backgroundColor: 'transparent' },
  unitName: { color: '#fff', fontSize: 16, fontWeight: '600' },
  unitCode: { color: '#888', fontSize: 12, marginTop: 2 },
  empty: { alignItems: 'center', paddingVertical: 40, backgroundColor: 'transparent' },
});
