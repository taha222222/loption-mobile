// src/services/orderRealtime.ts
// Realtime (best effort) for the staff order screens: any visible change of
// orders or a new timeline row triggers a refetch. Rows are filtered by the
// same RLS policies as the reads. Screens also refetch after every action, on
// focus and on demand, so a missing Realtime service only delays updates.
import { supabase } from '../lib/supabase';

export function subscribeOrderChanges(channelName: string, onChange: () => void): () => void {
  try {
    const channel = supabase
      .channel(channelName)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => onChange())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'order_status_updates' }, () => onChange())
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  } catch {
    return () => {};
  }
}
