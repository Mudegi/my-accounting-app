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
  RefreshControl,
} from 'react-native';
import { Text, View } from '@/components/Themed';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useFocusEffect } from 'expo-router';

type SalesTarget = {
  id: string;
  branch_id: string | null;
  branch_name: string;
  user_id: string | null;
  user_name: string;
  target_type: 'daily' | 'weekly' | 'monthly';
  target_amount: number;
  period_start: string;
  period_end: string;
  actual: number;
  progress: number; // 0 to 1
};

type TargetType = 'daily' | 'weekly' | 'monthly';

export default function SalesTargetsScreen() {
  const { business, currentBranch, branches, profile, fmt } = useAuth();
  const isAdmin = profile?.role === 'admin';

  const [targets, setTargets] = useState<SalesTarget[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [targetType, setTargetType] = useState<TargetType>('monthly');
  const [targetAmount, setTargetAmount] = useState('');
  const [selectedBranch, setSelectedBranch] = useState<string>('all');
  const [saving, setSaving] = useState(false);

  const getTargetPeriod = (type: TargetType): { start: Date; end: Date } => {
    const now = new Date();
    switch (type) {
      case 'daily':
        return { start: new Date(now.getFullYear(), now.getMonth(), now.getDate()), end: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59) };
      case 'weekly': {
        const day = now.getDay();
        const diff = now.getDate() - day + (day === 0 ? -6 : 1); // Monday
        const start = new Date(now.getFullYear(), now.getMonth(), diff);
        const end = new Date(start);
        end.setDate(start.getDate() + 6);
        return { start, end };
      }
      case 'monthly':
        return {
          start: new Date(now.getFullYear(), now.getMonth(), 1),
          end: new Date(now.getFullYear(), now.getMonth() + 1, 0),
        };
    }
  };

  const load = useCallback(async () => {
    if (!business) return;

    try {
      const { data: targetsData, error } = await supabase
        .from('sales_targets')
        .select('*')
        .eq('business_id', business.id)
        .order('period_start', { ascending: false })
        .limit(50);

      if (error) throw error;
      if (!targetsData) { setTargets([]); return; }

      // Get branch names
      const branchMap: Record<string, string> = {};
      branches.forEach(b => { branchMap[b.id] = b.name; });

      // For each target, get actual sales in the period
      const enriched: SalesTarget[] = [];

      for (const t of targetsData) {
        let salesQuery = supabase
          .from('sales')
          .select('total_amount')
          .eq('business_id', business.id)
          .eq('status', 'completed')
          .gte('created_at', t.period_start + 'T00:00:00')
          .lte('created_at', t.period_end + 'T23:59:59');

        if (t.branch_id) salesQuery = salesQuery.eq('branch_id', t.branch_id);
        if (t.user_id) salesQuery = salesQuery.eq('seller_id', t.user_id);

        const { data: salesData } = await salesQuery;
        const actual = salesData?.reduce((sum: number, s: any) => sum + Number(s.total_amount), 0) || 0;

        enriched.push({
          id: t.id,
          branch_id: t.branch_id,
          branch_name: t.branch_id ? (branchMap[t.branch_id] || 'Unknown') : 'All Branches',
          user_id: t.user_id,
          user_name: t.user_id ? 'Staff' : 'Everyone',
          target_type: t.target_type,
          target_amount: Number(t.target_amount),
          period_start: t.period_start,
          period_end: t.period_end,
          actual,
          progress: Number(t.target_amount) > 0 ? Math.min(1, actual / Number(t.target_amount)) : 0,
        });
      }

      setTargets(enriched);
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setLoading(false);
    }
  }, [business, branches]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const openNew = () => {
    setEditId(null);
    setTargetType('monthly');
    setTargetAmount('');
    setSelectedBranch(currentBranch?.id || 'all');
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!business || !profile) return;
    const amount = parseFloat(targetAmount);
    if (!amount || amount <= 0) {
      Alert.alert('Error', 'Enter a valid target amount');
      return;
    }

    const { start, end } = getTargetPeriod(targetType);

    setSaving(true);
    try {
      const payload = {
        business_id: business.id,
        branch_id: selectedBranch === 'all' ? null : selectedBranch,
        target_type: targetType,
        target_amount: amount,
        period_start: start.toISOString().split('T')[0],
        period_end: end.toISOString().split('T')[0],
        created_by: profile.id,
      };

      if (editId) {
        const { error } = await supabase.from('sales_targets').update(payload).eq('id', editId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('sales_targets').insert(payload);
        if (error) throw error;
      }

      setShowForm(false);
      await load();
      Alert.alert('Saved', `${targetType} target: ${fmt(amount)}`);
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (t: SalesTarget) => {
    Alert.alert('Delete Target', `Remove this ${t.target_type} target?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          await supabase.from('sales_targets').delete().eq('id', t.id);
          load();
        },
      },
    ]);
  };

  const formatDate = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });

  const isCurrentPeriod = (t: SalesTarget): boolean => {
    const now = new Date();
    const start = new Date(t.period_start);
    const end = new Date(t.period_end);
    return now >= start && now <= end;
  };

  const getProgressColor = (progress: number): string => {
    if (progress >= 1) return '#4CAF50';
    if (progress >= 0.7) return '#FF9800';
    if (progress >= 0.4) return '#FFD700';
    return '#e94560';
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#e94560" style={{ marginTop: 60 }} />
      </View>
    );
  }

  // Active targets (current period)
  const activeTargets = targets.filter(isCurrentPeriod);
  const pastTargets = targets.filter(t => !isCurrentPeriod(t));

  return (
    <View style={styles.container}>
      <FlatList
        data={pastTargets}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#e94560" />}
        ListHeaderComponent={
          <>
            {/* Header */}
            <View style={styles.header}>
              <Text style={styles.heading}>🎯 Sales Targets</Text>
              {isAdmin && (
                <TouchableOpacity style={styles.addBtn} onPress={openNew}>
                  <FontAwesome name="plus" size={16} color="#fff" />
                </TouchableOpacity>
              )}
            </View>

            {/* Active Targets */}
            {activeTargets.length > 0 ? (
              <>
                <Text style={styles.sectionTitle}>Current Targets</Text>
                {activeTargets.map((t) => (
                  <View key={t.id} style={[styles.card, styles.activeCard]}>
                    <View style={styles.cardHeader}>
                      <View style={{ backgroundColor: 'transparent', flex: 1 }}>
                        <Text style={styles.cardType}>
                          {t.target_type.charAt(0).toUpperCase() + t.target_type.slice(1)} Target
                        </Text>
                        <Text style={styles.cardBranch}>{t.branch_name}</Text>
                        <Text style={styles.cardPeriod}>
                          {formatDate(t.period_start)} – {formatDate(t.period_end)}
                        </Text>
                      </View>
                      <View style={{ backgroundColor: 'transparent', alignItems: 'flex-end' }}>
                        <Text style={styles.targetAmount}>{fmt(t.target_amount)}</Text>
                        <Text style={[styles.actualAmount, { color: getProgressColor(t.progress) }]}>
                          {fmt(t.actual)} ({Math.round(t.progress * 100)}%)
                        </Text>
                      </View>
                    </View>
                    <View style={styles.progressBar}>
                      <View style={[styles.progressFill, {
                        width: `${Math.min(100, t.progress * 100)}%`,
                        backgroundColor: getProgressColor(t.progress),
                      }]} />
                    </View>
                    {t.progress >= 1 && (
                      <Text style={styles.achievedBadge}>🏆 Target Achieved!</Text>
                    )}
                    {isAdmin && (
                      <TouchableOpacity
                        style={styles.deleteBtn}
                        onPress={() => handleDelete(t)}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      >
                        <FontAwesome name="trash" size={14} color="#e94560" />
                      </TouchableOpacity>
                    )}
                  </View>
                ))}
              </>
            ) : (
              <View style={styles.emptyActive}>
                <FontAwesome name="bullseye" size={48} color="#333" />
                <Text style={styles.emptyText}>No active targets</Text>
                {isAdmin && (
                  <TouchableOpacity style={styles.createBtn} onPress={openNew}>
                    <Text style={styles.createBtnText}>Set a Target</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            {/* Past Targets Header */}
            {pastTargets.length > 0 && (
              <Text style={styles.sectionTitle}>Past Targets</Text>
            )}
          </>
        }
        renderItem={({ item }) => (
          <View style={[styles.card, { opacity: 0.7 }]}>
            <View style={styles.cardHeader}>
              <View style={{ backgroundColor: 'transparent', flex: 1 }}>
                <Text style={styles.cardType}>
                  {item.target_type.charAt(0).toUpperCase() + item.target_type.slice(1)}
                </Text>
                <Text style={styles.cardBranch}>{item.branch_name}</Text>
                <Text style={styles.cardPeriod}>
                  {formatDate(item.period_start)} – {formatDate(item.period_end)}
                </Text>
              </View>
              <View style={{ backgroundColor: 'transparent', alignItems: 'flex-end' }}>
                <Text style={styles.targetAmount}>{fmt(item.target_amount)}</Text>
                <Text style={[styles.actualAmount, { color: getProgressColor(item.progress) }]}>
                  {fmt(item.actual)} ({Math.round(item.progress * 100)}%)
                </Text>
                {item.progress >= 1 && <Text style={{ fontSize: 12 }}>🏆</Text>}
              </View>
            </View>
            <View style={styles.progressBar}>
              <View style={[styles.progressFill, {
                width: `${Math.min(100, item.progress * 100)}%`,
                backgroundColor: getProgressColor(item.progress),
              }]} />
            </View>
          </View>
        )}
        ListEmptyComponent={
          activeTargets.length > 0 ? null : undefined
        }
      />

      {/* Create/Edit Target Modal */}
      <Modal visible={showForm} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <ScrollView>
              <Text style={styles.modalTitle}>{editId ? 'Edit Target' : 'New Sales Target'}</Text>

              <Text style={styles.label}>Target Period</Text>
              <View style={styles.chipRow}>
                {(['daily', 'weekly', 'monthly'] as TargetType[]).map((t) => (
                  <TouchableOpacity
                    key={t}
                    style={[styles.chip, targetType === t && styles.chipActive]}
                    onPress={() => setTargetType(t)}
                  >
                    <Text style={[styles.chipText, targetType === t && { color: '#fff' }]}>
                      {t.charAt(0).toUpperCase() + t.slice(1)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.label}>Branch</Text>
              <View style={styles.chipRow}>
                <TouchableOpacity
                  style={[styles.chip, selectedBranch === 'all' && styles.chipActive]}
                  onPress={() => setSelectedBranch('all')}
                >
                  <Text style={[styles.chipText, selectedBranch === 'all' && { color: '#fff' }]}>All Branches</Text>
                </TouchableOpacity>
                {branches.map((b) => (
                  <TouchableOpacity
                    key={b.id}
                    style={[styles.chip, selectedBranch === b.id && styles.chipActive]}
                    onPress={() => setSelectedBranch(b.id)}
                  >
                    <Text style={[styles.chipText, selectedBranch === b.id && { color: '#fff' }]}>
                      {b.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.label}>Target Amount *</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. 5000000"
                placeholderTextColor="#555"
                value={targetAmount}
                onChangeText={setTargetAmount}
                keyboardType="numeric"
              />

              <Text style={styles.hint}>
                Period: {(() => {
                  const { start, end } = getTargetPeriod(targetType);
                  return `${start.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} – ${end.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`;
                })()}
              </Text>

              <TouchableOpacity
                style={[styles.saveBtn, saving && { opacity: 0.6 }]}
                onPress={handleSave}
                disabled={saving}
              >
                {saving ? <ActivityIndicator color="#fff" /> : (
                  <Text style={styles.saveBtnText}>{editId ? 'Update' : 'Create Target'}</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowForm(false)}>
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
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 16, paddingBottom: 0, backgroundColor: 'transparent',
  },
  heading: { fontSize: 22, fontWeight: 'bold', color: '#fff' },
  addBtn: {
    backgroundColor: '#e94560', width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
  },
  sectionTitle: { fontSize: 16, fontWeight: 'bold', color: '#ccc', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  card: {
    backgroundColor: '#16213e', marginHorizontal: 16, marginBottom: 10,
    borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#0f3460',
  },
  activeCard: { borderColor: '#4CAF50', borderWidth: 2 },
  cardHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
    backgroundColor: 'transparent',
  },
  cardType: { fontSize: 14, fontWeight: 'bold', color: '#fff' },
  cardBranch: { fontSize: 12, color: '#aaa', marginTop: 2 },
  cardPeriod: { fontSize: 11, color: '#888', marginTop: 2 },
  targetAmount: { fontSize: 16, fontWeight: 'bold', color: '#fff' },
  actualAmount: { fontSize: 14, marginTop: 2 },
  progressBar: {
    height: 6, backgroundColor: '#0f3460', borderRadius: 3, marginTop: 10, overflow: 'hidden',
  },
  progressFill: { height: '100%', borderRadius: 3 },
  achievedBadge: { color: '#4CAF50', fontSize: 13, fontWeight: 'bold', marginTop: 6, textAlign: 'center' },
  deleteBtn: { position: 'absolute', bottom: 10, right: 10 },
  emptyActive: {
    alignItems: 'center', padding: 32, margin: 16,
    backgroundColor: '#16213e', borderRadius: 16, borderWidth: 1, borderColor: '#0f3460',
  },
  emptyText: { color: '#555', fontSize: 16, marginTop: 12 },
  createBtn: {
    backgroundColor: '#e94560', borderRadius: 10, paddingHorizontal: 20, paddingVertical: 10, marginTop: 16,
  },
  createBtnText: { color: '#fff', fontWeight: 'bold' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalContent: {
    backgroundColor: '#1a1a2e', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 20, maxHeight: '85%',
  },
  modalTitle: { fontSize: 20, fontWeight: 'bold', color: '#fff', marginBottom: 12 },
  label: { fontSize: 13, color: '#aaa', marginBottom: 4, marginTop: 12 },
  input: {
    backgroundColor: '#16213e', borderRadius: 10, padding: 12, color: '#fff',
    fontSize: 15, borderWidth: 1, borderColor: '#0f3460',
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4, backgroundColor: 'transparent' },
  chip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10,
    backgroundColor: '#16213e', borderWidth: 1, borderColor: '#0f3460',
  },
  chipActive: { backgroundColor: '#e94560', borderColor: '#e94560' },
  chipText: { fontSize: 13, color: '#aaa' },
  hint: { color: '#666', fontSize: 12, marginTop: 8 },
  saveBtn: {
    backgroundColor: '#4CAF50', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 20,
  },
  saveBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  cancelBtn: { padding: 14, alignItems: 'center', marginTop: 8 },
  cancelBtnText: { color: '#aaa', fontSize: 15 },
});
