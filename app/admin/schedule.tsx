import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Switch,
  Alert,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { Text, View } from '@/components/Themed';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useLocalSearchParams, useRouter } from 'expo-router';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Preset time options (HH:MM 24h format)
const TIME_OPTIONS = [
  '00:00', '01:00', '02:00', '03:00', '04:00', '05:00',
  '06:00', '06:30', '07:00', '07:30', '08:00', '08:30',
  '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
  '12:00', '12:30', '13:00', '13:30', '14:00', '14:30',
  '15:00', '15:30', '16:00', '16:30', '17:00', '17:30',
  '18:00', '18:30', '19:00', '19:30', '20:00', '20:30',
  '21:00', '21:30', '22:00', '22:30', '23:00', '23:30', '23:59',
];

function formatTime12(t: string): string {
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${m.toString().padStart(2, '0')} ${ampm}`;
}

type DaySchedule = {
  day: number;
  start: string;
  end: string;
  enabled: boolean;
};

export default function ScheduleScreen() {
  const { profile } = useAuth();
  const router = useRouter();
  const params = useLocalSearchParams<{ userId: string; userName: string }>();
  const userId = params.userId;
  const userName = params.userName ? decodeURIComponent(params.userName) : 'User';

  const [schedule, setSchedule] = useState<DaySchedule[]>(
    DAYS.map((_, i) => ({ day: i, start: '07:00', end: '20:00', enabled: true }))
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasSchedule, setHasSchedule] = useState(false);
  const [editingTime, setEditingTime] = useState<{ dayIdx: number; field: 'start' | 'end' } | null>(null);

  useEffect(() => {
    loadSchedule();
  }, [userId]);

  const loadSchedule = async () => {
    if (!userId) return;
    setLoading(true);
    const { data } = await supabase
      .from('user_access_schedules')
      .select('day_of_week, start_time, end_time, is_enabled')
      .eq('user_id', userId)
      .order('day_of_week');

    if (data && data.length > 0) {
      setHasSchedule(true);
      const newSchedule = DAYS.map((_, i) => {
        const existing = data.find((d: any) => d.day_of_week === i);
        if (existing) {
          return {
            day: i,
            start: existing.start_time.slice(0, 5), // "07:00:00" -> "07:00"
            end: existing.end_time.slice(0, 5),
            enabled: existing.is_enabled,
          };
        }
        return { day: i, start: '07:00', end: '20:00', enabled: true };
      });
      setSchedule(newSchedule);
    }
    setLoading(false);
  };

  const handleSave = async () => {
    if (!userId) return;
    setSaving(true);

    const payload = schedule.map(s => ({
      day: s.day,
      start: s.start,
      end: s.end,
      enabled: s.enabled,
    }));

    const { error } = await supabase.rpc('save_user_schedule', {
      p_user_id: userId,
      p_schedule: payload,
    });

    setSaving(false);
    if (error) {
      Alert.alert('Error', error.message);
    } else {
      setHasSchedule(true);
      Alert.alert('Saved', `Working hours for ${userName} have been updated.`);
    }
  };

  const handleClearSchedule = () => {
    Alert.alert(
      'Remove All Restrictions',
      `Remove all working hour restrictions for ${userName}? They will be able to access the app at any time.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            const { error } = await supabase
              .from('user_access_schedules')
              .delete()
              .eq('user_id', userId);
            if (error) {
              Alert.alert('Error', error.message);
            } else {
              setHasSchedule(false);
              setSchedule(DAYS.map((_, i) => ({ day: i, start: '07:00', end: '20:00', enabled: true })));
              Alert.alert('Done', `All restrictions removed for ${userName}.`);
            }
          }
        }
      ]
    );
  };

  const updateDay = (dayIdx: number, field: keyof DaySchedule, value: any) => {
    setSchedule(prev => prev.map((s, i) => i === dayIdx ? { ...s, [field]: value } : s));
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator color="#e94560" size="large" style={{ marginTop: 40 }} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <FontAwesome name="clock-o" size={24} color="#2196F3" />
        <View style={{ flex: 1, backgroundColor: 'transparent', marginLeft: 12 }}>
          <Text style={styles.headerTitle}>Working Hours</Text>
          <Text style={styles.headerSub}>{userName}</Text>
        </View>
      </View>

      {!hasSchedule && (
        <View style={styles.infoCard}>
          <FontAwesome name="info-circle" size={16} color="#4CAF50" />
          <Text style={styles.infoText}>
            No restrictions set. {userName} can access the app at any time. Set working hours below to restrict access.
          </Text>
        </View>
      )}

      {/* Quick presets */}
      <View style={styles.presetsCard}>
        <Text style={styles.presetsTitle}>Quick Presets</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
          <TouchableOpacity
            style={styles.presetChip}
            onPress={() => setSchedule(DAYS.map((_, i) => ({ day: i, start: '08:00', end: '17:00', enabled: i >= 1 && i <= 5 })))}
          >
            <Text style={styles.presetText}>Mon-Fri 8AM-5PM</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.presetChip}
            onPress={() => setSchedule(DAYS.map((_, i) => ({ day: i, start: '07:00', end: '20:00', enabled: i >= 1 && i <= 6 })))}
          >
            <Text style={styles.presetText}>Mon-Sat 7AM-8PM</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.presetChip}
            onPress={() => setSchedule(DAYS.map((_, i) => ({ day: i, start: '00:00', end: '23:59', enabled: true })))}
          >
            <Text style={styles.presetText}>24/7 Access</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.presetChip}
            onPress={() => setSchedule(DAYS.map((_, i) => ({ day: i, start: '06:00', end: '22:00', enabled: true })))}
          >
            <Text style={styles.presetText}>Every day 6AM-10PM</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>

      {/* Day-by-day schedule */}
      {schedule.map((s, idx) => (
        <View key={idx} style={[styles.dayCard, !s.enabled && { opacity: 0.5 }]}>
          <View style={styles.dayHeader}>
            <Text style={[styles.dayName, !s.enabled && { textDecorationLine: 'line-through' }]}>{DAYS[idx]}</Text>
            <Switch
              value={s.enabled}
              onValueChange={(val) => updateDay(idx, 'enabled', val)}
              trackColor={{ false: '#333', true: '#4CAF50' }}
              thumbColor={s.enabled ? '#fff' : '#666'}
            />
          </View>

          {s.enabled && (
            <View style={styles.timeRow}>
              <TouchableOpacity
                style={styles.timeBtn}
                onPress={() => setEditingTime(editingTime?.dayIdx === idx && editingTime.field === 'start' ? null : { dayIdx: idx, field: 'start' })}
              >
                <FontAwesome name="sign-in" size={12} color="#4CAF50" />
                <Text style={styles.timeBtnText}>{formatTime12(s.start)}</Text>
              </TouchableOpacity>
              <Text style={{ color: '#555', fontSize: 14 }}>to</Text>
              <TouchableOpacity
                style={styles.timeBtn}
                onPress={() => setEditingTime(editingTime?.dayIdx === idx && editingTime.field === 'end' ? null : { dayIdx: idx, field: 'end' })}
              >
                <FontAwesome name="sign-out" size={12} color="#e94560" />
                <Text style={styles.timeBtnText}>{formatTime12(s.end)}</Text>
              </TouchableOpacity>
            </View>
          )}

          {!s.enabled && (
            <Text style={{ color: '#e94560', fontSize: 12, marginTop: 4 }}>Day off — no access</Text>
          )}

          {/* Time picker dropdown */}
          {editingTime && editingTime.dayIdx === idx && (
            <View style={styles.timePicker}>
              <Text style={styles.timePickerLabel}>
                Select {editingTime.field === 'start' ? 'start' : 'end'} time:
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {TIME_OPTIONS.map(t => (
                  <TouchableOpacity
                    key={t}
                    style={[
                      styles.timeOption,
                      s[editingTime.field] === t && styles.timeOptionActive,
                    ]}
                    onPress={() => {
                      updateDay(idx, editingTime.field, t);
                      setEditingTime(null);
                    }}
                  >
                    <Text style={[
                      styles.timeOptionText,
                      s[editingTime.field] === t && styles.timeOptionTextActive,
                    ]}>{formatTime12(t)}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}
        </View>
      ))}

      {/* Save / Clear buttons */}
      <View style={{ padding: 16, gap: 10 }}>
        <TouchableOpacity style={styles.saveBtn} onPress={handleSave} disabled={saving}>
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <FontAwesome name="check" size={16} color="#fff" />
              <Text style={styles.saveBtnText}>Save Working Hours</Text>
            </>
          )}
        </TouchableOpacity>

        {hasSchedule && (
          <TouchableOpacity style={styles.clearBtn} onPress={handleClearSchedule}>
            <FontAwesome name="times" size={16} color="#e94560" />
            <Text style={styles.clearBtnText}>Remove All Restrictions</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#16213e',
    margin: 16,
    marginBottom: 8,
    borderRadius: 16,
    padding: 20,
  },
  headerTitle: { color: '#fff', fontSize: 20, fontWeight: 'bold' },
  headerSub: { color: '#aaa', fontSize: 14, marginTop: 2 },
  infoCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: '#16213e',
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 12,
    padding: 14,
    borderLeftWidth: 3,
    borderLeftColor: '#4CAF50',
  },
  infoText: { color: '#aaa', fontSize: 13, flex: 1, lineHeight: 18 },
  presetsCard: {
    backgroundColor: '#16213e',
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 12,
    padding: 14,
  },
  presetsTitle: { color: '#666', fontSize: 11, fontWeight: 'bold', letterSpacing: 1 },
  presetChip: {
    backgroundColor: '#0f3460',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#2196F3',
  },
  presetText: { color: '#2196F3', fontSize: 12, fontWeight: '600' },
  dayCard: {
    backgroundColor: '#16213e',
    marginHorizontal: 16,
    marginBottom: 6,
    borderRadius: 12,
    padding: 14,
  },
  dayHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  dayName: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 10,
    backgroundColor: 'transparent',
  },
  timeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#0f3460',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  timeBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  timePicker: {
    marginTop: 10,
    backgroundColor: '#0f3460',
    borderRadius: 10,
    padding: 10,
  },
  timePickerLabel: { color: '#aaa', fontSize: 11, marginBottom: 8 },
  timeOption: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#16213e',
    marginRight: 6,
    borderWidth: 1,
    borderColor: '#0f3460',
  },
  timeOptionActive: { backgroundColor: '#2196F3', borderColor: '#2196F3' },
  timeOptionText: { color: '#aaa', fontSize: 12 },
  timeOptionTextActive: { color: '#fff', fontWeight: 'bold' },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#4CAF50',
    borderRadius: 12,
    padding: 16,
  },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  clearBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#16213e',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e94560',
  },
  clearBtnText: { color: '#e94560', fontSize: 14, fontWeight: '600' },
});
