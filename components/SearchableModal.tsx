import React, { useState } from 'react';
import {
  StyleSheet,
  Modal,
  TextInput,
  TouchableOpacity,
  FlatList,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Text, View } from '@/components/Themed';
import FontAwesome from '@expo/vector-icons/FontAwesome';

interface SearchableModalProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (item: any) => void;
  data: any[];
  searchPlaceholder?: string;
  title: string;
  labelExtractor: (item: any) => string;
  valueExtractor: (item: any) => string;
  subLabelExtractor?: (item: any) => string;
}

export default function SearchableModal({
  visible,
  onClose,
  onSelect,
  data,
  searchPlaceholder = 'Search...',
  title,
  labelExtractor,
  valueExtractor,
  subLabelExtractor,
}: SearchableModalProps) {
  const [search, setSearch] = useState('');

  const filteredData = data.filter((item) => {
    const label = labelExtractor(item).toLowerCase();
    const subLabel = subLabelExtractor ? subLabelExtractor(item).toLowerCase() : '';
    const query = search.toLowerCase();
    return label.includes(query) || subLabel.includes(query);
  });

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <View style={styles.overlay}>
          <View style={styles.content}>
            <View style={styles.header}>
              <Text style={styles.title}>{title}</Text>
              <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                <FontAwesome name="times" size={24} color="#aaa" />
              </TouchableOpacity>
            </View>

            <View style={styles.searchContainer}>
              <FontAwesome name="search" size={16} color="#666" />
              <TextInput
                style={styles.searchInput}
                placeholder={searchPlaceholder}
                placeholderTextColor="#666"
                value={search}
                onChangeText={setSearch}
                autoFocus
              />
            </View>

            <FlatList
              data={filteredData}
              keyExtractor={(item) => valueExtractor(item)}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.item}
                  onPress={() => {
                    onSelect(item);
                    setSearch('');
                    onClose();
                  }}
                >
                  <View style={{ flex: 1, backgroundColor: 'transparent' }}>
                    <Text style={styles.itemLabel}>{labelExtractor(item)}</Text>
                    {subLabelExtractor && (
                      <Text style={styles.itemSubLabel}>{subLabelExtractor(item)}</Text>
                    )}
                  </View>
                  <FontAwesome name="chevron-right" size={14} color="#333" />
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <View style={styles.empty}>
                  <Text style={{ color: '#555' }}>No results found</Text>
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
  content: { backgroundColor: '#16213e', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, height: '80%' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, backgroundColor: 'transparent' },
  title: { fontSize: 20, fontWeight: 'bold', color: '#fff' },
  closeBtn: { padding: 4 },
  searchContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0f3460', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 16 },
  searchInput: { flex: 1, color: '#fff', fontSize: 16, marginLeft: 10 },
  item: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#0f3460', backgroundColor: 'transparent' },
  itemLabel: { color: '#fff', fontSize: 16, fontWeight: '600' },
  itemSubLabel: { color: '#888', fontSize: 12, marginTop: 2 },
  empty: { alignItems: 'center', paddingVertical: 40, backgroundColor: 'transparent' },
});
