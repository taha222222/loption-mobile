import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { supabase } from '../lib/supabase';

// Configure notification handler
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export interface NotificationData {
  title: string;
  body: string;
  data?: any;
}

class NotificationService {
  private expoPushToken: string | null = null;

  // Register for push notifications
  async registerForPushNotificationsAsync(): Promise<string | null> {
    // Skip push notifications in development/Expo Go
    if (!Device.isDevice) {
      console.log('📱 Must use physical device for Push Notifications');
      return null;
    }

    // Skip if running in Expo Go (development build)
    if (__DEV__) {
      console.log('⚠️ Push notifications disabled in development mode');
      return null;
    }

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      console.log('❌ Failed to get push token permission');
      return null;
    }

    try {
      const token = await Notifications.getExpoPushTokenAsync();
      this.expoPushToken = token.data;
      console.log('✅ Expo Push Token:', this.expoPushToken);
      return this.expoPushToken;
    } catch (error) {
      console.log('⚠️ Push notifications not available in Expo Go');
      return null;
    }
  }

  // Registers the push token only when permission was already granted.
  // Never shows the OS prompt (that happens after the explanation screen).
  async registerPushTokenIfPermitted(userId: string, role: string) {
    try {
      const { status } = await Notifications.getPermissionsAsync();
      if (status !== 'granted') return;
      const token = await this.registerForPushNotificationsAsync();
      if (token) await this.savePushToken(userId, token, role);
    } catch (error) {
      console.log('Push token registration skipped:', error);
    }
  }

  // Save token to database for a user
  async savePushToken(userId: string, token: string, role: string) {
    if (!token) return;
    
    const table = role === 'driver' ? 'driver_push_tokens' : 'user_push_tokens';
    
    const { error } = await supabase
      .from(table)
      .upsert({
        user_id: userId,
        push_token: token,
        device_type: Platform.OS,
        updated_at: new Date().toISOString(),
      });

    if (error) {
      console.error('Error saving push token:', error);
    }
  }

  // Send notification to a specific user
  async sendToUser(userId: string, title: string, body: string, data?: any) {
    if (__DEV__) {
      console.log('📧 [DEV] Would send notification to user:', { title, body });
      return;
    }
    
    const { data: tokenData } = await supabase
      .from('user_push_tokens')
      .select('push_token')
      .eq('user_id', userId)
      .single();

    if (!tokenData?.push_token) {
      console.log('No push token for user:', userId);
      return;
    }

    await this.sendPushNotification(tokenData.push_token, title, body, data);
  }

  // Send notification to a specific driver
  async sendToDriver(driverId: string, title: string, body: string, data?: any) {
    if (__DEV__) {
      console.log('📧 [DEV] Would send notification to driver:', { title, body });
      return;
    }
    
    const { data: tokenData } = await supabase
      .from('driver_push_tokens')
      .select('push_token')
      .eq('user_id', driverId)
      .single();

    if (!tokenData?.push_token) {
      console.log('No push token for driver:', driverId);
      return;
    }

    await this.sendPushNotification(tokenData.push_token, title, body, data);
  }

  // Send notification to all online drivers
  async sendToAllOnlineDrivers(title: string, body: string, data?: any) {
    if (__DEV__) {
      console.log('📧 [DEV] Would send notification to all online drivers:', { title, body });
      return;
    }
    
    const { data: drivers } = await supabase
      .from('drivers')
      .select('id')
      .eq('status', 'online');

    if (!drivers) return;

    for (const driver of drivers) {
      await this.sendToDriver(driver.id, title, body, data);
    }
  }

  // Send push notification via Expo
  async sendPushNotification(token: string, title: string, body: string, data?: any) {
    const message = {
      to: token,
      sound: 'default',
      title,
      body,
      data: data || {},
    };

    try {
      const response = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Accept-encoding': 'gzip, deflate',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(message),
      });
      return await response.json();
    } catch (error) {
      console.error('Error sending push notification:', error);
    }
  }

  // Handle notification when app is open
  setupNotificationListeners() {
    const subscription = Notifications.addNotificationReceivedListener(notification => {
      console.log('Notification received:', notification);
    });

    const responseSubscription = Notifications.addNotificationResponseReceivedListener(response => {
      const data = response.notification.request.content.data;
      console.log('Notification response:', data);
      
      if (data?.orderId) {
        // Navigation logic here
      }
    });

    return { subscription, responseSubscription };
  }
}

export const notificationService = new NotificationService();