import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

/**
 * Configure global notification behavior
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/**
 * Request permissions
 */
export async function requestNotificationPermissions() {
  if (Platform.OS === 'web') return false;
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  return finalStatus === 'granted';
}

/**
 * Schedule a local notification for subscription expiry
 */
export async function scheduleExpiryNotification(daysRemaining: number, planName: string) {
  if (daysRemaining < 1) return;

  const title = daysRemaining <= 3 ? "⚠️ Subscription Expiring Soon!" : "Subscription Notice";
  const body = `Your ${planName} plan expires in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}. Renew now to avoid interruption.`;

  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      sound: true,
      data: { screen: 'subscription' },
    },
    trigger: null, // show immediately
  });
}
