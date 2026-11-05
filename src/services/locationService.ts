import * as Location from 'expo-location';
import { supabase } from '../lib/supabase';
import { LOCATION_STATUSES } from '../orders/orderWorkflow';
import { reportDriverLocation } from './orderWorkflowApi';

class LocationService {
  private locationSubscription: any = null;
  private currentDriverId: string | null = null;
  private isTracking = false;

  /**
   * Request location permissions from user
   */
  async requestPermissions(): Promise<boolean> {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      console.log('❌ Location permission denied');
      return false;
    }
    console.log('✅ Location permission granted');
    return true;
  }

  /**
   * Start tracking driver location (called when driver goes online)
   */
  async startTracking(driverId: string) {
    console.log('📍 Starting location tracking for driver:', driverId);
    
    const hasPermission = await this.requestPermissions();
    if (!hasPermission) return;
    
    this.currentDriverId = driverId;
    this.isTracking = true;

    // Get initial location immediately
    await this.updateDriverLocation(driverId);

    // Start watching position
    this.locationSubscription = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.High,
        timeInterval: 5000, // Update every 5 seconds
        distanceInterval: 10, // Or every 10 meters
      },
      async (location) => {
        if (this.isTracking) {
          await this.updateDriverLocation(driverId, location);
        }
      }
    );
    
    console.log('✅ Location tracking started');
  }

  /**
   * Stop tracking driver location (called when driver goes offline)
   */
  async stopTracking() {
    console.log('📍 Stopping location tracking');
    this.isTracking = false;
    
    if (this.locationSubscription) {
      this.locationSubscription.remove();
      this.locationSubscription = null;
    }
    
    this.currentDriverId = null;
    console.log('✅ Location tracking stopped');
  }

  /**
   * Update driver location in database
   */
  private async updateDriverLocation(driverId: string, location?: Location.LocationObject) {
    let latitude: number, longitude: number, accuracy: number | null, timestamp: number;

    if (location) {
      latitude = location.coords.latitude;
      longitude = location.coords.longitude;
      accuracy = location.coords.accuracy ?? null;
      timestamp = location.timestamp;
    } else {
      try {
        const currentLocation = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });
        latitude = currentLocation.coords.latitude;
        longitude = currentLocation.coords.longitude;
        accuracy = currentLocation.coords.accuracy ?? null;
        timestamp = currentLocation.timestamp;
      } catch (error) {
        console.error('Error getting current location:', error);
        return;
      }
    }

    // Update drivers table with current location
    const { error: driverError } = await supabase
      .from('drivers')
      .update({
        current_latitude: latitude,
        current_longitude: longitude,
        last_location_update: new Date().toISOString(),
      })
      .eq('id', driverId);

    if (driverError) {
      console.error('Error updating driver location:', driverError);
    }

    // The delivery in progress (between pickup and delivery): the server
    // checks the assignment and the step, keeps the history and shows the
    // position to that order's customer only.
    const { data: activeOrder, error: orderError } = await supabase
      .from('orders')
      .select('id')
      .eq('driver_id', driverId)
      .in('status', [...LOCATION_STATUSES])
      .limit(1)
      .maybeSingle();

    if (orderError) {
      console.error('Error fetching active order:', orderError);
    }

    if (activeOrder && activeOrder.id) {
      const result = await reportDriverLocation(activeOrder.id, { latitude, longitude, accuracy, timestamp });
      if (!result.ok) {
        console.error('Error reporting delivery location:', result.error.kind);
      }
    }
  }

  /**
   * Get driver's current location for a specific order (for customers)
   */
  async getDriverLocation(orderId: string) {
    const { data, error } = await supabase
      .from('orders')
      .select('driver_latitude, driver_longitude, driver_id, status')
      .eq('id', orderId)
      .maybeSingle();

    if (error) {
      console.error('Error getting driver location:', error);
      return null;
    }

    if (data && data.driver_latitude && data.driver_longitude) {
      return {
        latitude: data.driver_latitude,
        longitude: data.driver_longitude,
        status: data.status,
      };
    }
    return null;
  }

  /**
   * Subscribe to real-time driver location updates for a customer
   */
  subscribeToDriverLocation(orderId: string, callback: (location: any) => void) {
    console.log('📍 Subscribing to driver location updates for order:', orderId);
    
    const subscription = supabase
      .channel(`driver-location-${orderId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'orders',
          filter: `id=eq.${orderId}`,
        },
        (payload) => {
          if (payload.new.driver_latitude && payload.new.driver_longitude) {
            callback({
              latitude: payload.new.driver_latitude,
              longitude: payload.new.driver_longitude,
              status: payload.new.status,
            });
          }
        }
      )
      .subscribe();

    return subscription;
  }

  /**
   * Check if location tracking is active
   */
  isTrackingActive(): boolean {
    return this.isTracking;
  }

  /**
   * Get current driver ID being tracked
   */
  getCurrentDriverId(): string | null {
    return this.currentDriverId;
  }
}

export const locationService = new LocationService();