import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';
import { supabase } from '../lib/supabase';


export interface NotificationData {
  title: string;
  body: string;
  data?: any;
}

class NotificationService {
  private expoPushToken: string | null = null;

  // Returns this device's Expo push token. Needs a physical device, a
  // development or production build (not Expo Go) and the EAS project id
  // from app.json (extra.eas.projectId). Does not log the token.
  async registerForPushNotificationsAsync(): Promise<string | null> {
    if (!Device.isDevice) return null;
    if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) return null; // Expo Go

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') return null;

    const projectId =
      (Constants.expoConfig?.extra as any)?.eas?.projectId ?? (Constants as any).easConfig?.projectId ?? null;
    if (!projectId) {
      console.log('Push token unavailable: EAS projectId missing');
      return null;
    }
    try {
      const token = await Notifications.getExpoPushTokenAsync({ projectId });
      this.expoPushToken = token.data;
      return this.expoPushToken;
    } catch {
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

  // Save token to database for a user. Customers go through
  // register_push_token(), which binds the device token to the account
  // signed in on it now (a shared device moves to the new account).
  async savePushToken(userId: string, token: string, role: string) {
    if (!token) return;

    if (role !== 'driver') {
      const { error } = await supabase.rpc('register_push_token', { p_token: token, p_device_type: Platform.OS });
      if (error) console.error('Error saving push token:', error.message);
      return;
    }

    const { error } = await supabase
      .from('driver_push_tokens')
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

  // Stops notifications for the signed-out account on this device
  // (best effort; the server also deactivates tokens Expo reports invalid).
  async deactivateCurrentToken(): Promise<void> {
    if (!this.expoPushToken) return;
    try {
      await supabase.rpc('deactivate_push_token', { p_token: this.expoPushToken });
    } catch {
      // ignore: offline sign-out still proceeds
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

  // Listeners for notifications. `onOpen` receives the data of a tapped
  // notification (including the one that launched the app).
  setupNotificationListeners(onOpen?: (data: Record<string, unknown>) => void) {
    // Show notifications that arrive while the app is open.
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
      }),
    });
    const subscription = Notifications.addNotificationReceivedListener(() => {});

    const responseSubscription = Notifications.addNotificationResponseReceivedListener((response) => {
      onOpen?.((response.notification.request.content.data ?? {}) as Record<string, unknown>);
    });
    if (onOpen) {
      Notifications.getLastNotificationResponseAsync()
        .then((response) => {
          if (response) onOpen((response.notification.request.content.data ?? {}) as Record<string, unknown>);
        })
        .catch(() => {});
    }

    return { subscription, responseSubscription };
  }
}

export const notificationService = new NotificationService();