import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, TouchableOpacity, Animated, Easing } from 'react-native';
import { View, Text } from './Themed';
import { FontAwesome } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '@/lib/auth';
import { scheduleExpiryNotification, requestNotificationPermissions } from '@/lib/notifications';

const DISMISS_KEY = 'subscription_banner_dismissed_at';

export function SubscriptionBanner() {
  const { subscriptionStatus, business } = useAuth();
  const router = useRouter();
  const [isVisible, setIsVisible] = useState(false);
  const [daysLeft, setDaysLeft] = useState(0);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    checkVisibility();
  }, [subscriptionStatus]);

  const checkVisibility = async () => {
    if (!subscriptionStatus || !subscriptionStatus.active || !subscriptionStatus.ends_at) {
      setIsVisible(false);
      return;
    }

    const expiryDate = new Date(subscriptionStatus.ends_at);
    const now = new Date();
    const diffTime = expiryDate.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    setDaysLeft(diffDays);

    const isAnnual = subscriptionStatus.billing_cycle === 'yearly';
    const threshold = isAnnual ? 30 : 7;

    if (diffDays <= threshold && diffDays > 0) {
      // Check if dismissed in last 24h
      const dismissedAt = await AsyncStorage.getItem(DISMISS_KEY);
      if (dismissedAt && diffDays > 3) { // Force show if < 3 days remaining
        const lastDismissed = new Date(dismissedAt);
        const hoursSince = (now.getTime() - lastDismissed.getTime()) / (1000 * 60 * 60);
        if (hoursSince < 24) {
          setIsVisible(false);
          return;
        }
      }

      setIsVisible(true);
      Animated.timing(opacityAnim, {
        toValue: 1,
        duration: 500,
        useNativeDriver: true,
      }).start();

      // Trigger notification if first time seeing this threshold today
      if (diffDays <= threshold) {
        const hasNotified = await AsyncStorage.getItem(`notified_expiry_${diffDays}`);
        if (!hasNotified) {
          const granted = await requestNotificationPermissions();
          if (granted) {
            await scheduleExpiryNotification(diffDays, subscriptionStatus.display_name || 'YourBooks');
            await AsyncStorage.setItem(`notified_expiry_${diffDays}`, new Date().toISOString());
          }
        }
      }
    } else {
      setIsVisible(false);
    }
  };

  useEffect(() => {
    if (isVisible && daysLeft <= 3) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.05,
            duration: 1000,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 1000,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ])
      ).start();
    } else {
      pulseAnim.setValue(1);
    }
  }, [isVisible, daysLeft]);

  const handleDismiss = async () => {
    if (daysLeft <= 3) return; // Cannot dismiss if critical
    await AsyncStorage.setItem(DISMISS_KEY, new Date().toISOString());
    Animated.timing(opacityAnim, {
      toValue: 0,
      duration: 300,
      useNativeDriver: true,
    }).start(() => setIsVisible(false));
  };

  if (!isVisible) return null;

  const isCritical = daysLeft <= 3;

  return (
    <Animated.View style={[
      styles.container, 
      { opacity: opacityAnim, transform: [{ scale: pulseAnim }] },
      isCritical ? styles.critical : styles.warning
    ]}>
      <View style={styles.content}>
        <FontAwesome 
          name={isCritical ? "exclamation-circle" : "calendar"} 
          size={18} 
          color="#fff" 
          style={styles.icon} 
        />
        <View style={styles.textContainer}>
          <Text style={styles.title}>
            {isCritical ? 'Subscription Expiring!' : 'Subscription Renewal'}
          </Text>
          <Text style={styles.subtitle}>
            Your {subscriptionStatus?.display_name} plan expires in {daysLeft} {daysLeft === 1 ? 'day' : 's'}.
          </Text>
        </View>
        
        <TouchableOpacity 
          style={styles.renewBtn} 
          onPress={() => router.push('/subscription')}
        >
          <Text style={styles.renewBtnText}>Renew Now</Text>
        </TouchableOpacity>

        {!isCritical && (
          <TouchableOpacity onPress={handleDismiss} style={styles.closeBtn}>
            <FontAwesome name="times" size={14} color="rgba(255,255,255,0.7)" />
          </TouchableOpacity>
        )}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 12,
    marginTop: 8,
    borderRadius: 12,
    padding: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 8,
    zIndex: 9999,
  },
  warning: {
    backgroundColor: '#FF9800',
  },
  critical: {
    backgroundColor: '#e94560',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  icon: {
    marginRight: 10,
  },
  textContainer: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  title: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  subtitle: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 12,
  },
  renewBtn: {
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    marginLeft: 10,
  },
  renewBtnText: {
    color: '#1a1a2e',
    fontSize: 12,
    fontWeight: 'bold',
  },
  closeBtn: {
    padding: 8,
    marginLeft: 4,
  }
});
