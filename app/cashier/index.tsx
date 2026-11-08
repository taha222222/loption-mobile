import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Chip, EmptyState, FormMessage, IconButton, Screen, ScreenHeader, StatusBadge } from '../../src/components/v2';
import { STAFF_STATUS_COLOR } from '../../src/cashier/statusColors';
import { theme } from '../../src/theme';
import { formatMad } from '../../src/menu/customization';
import { useAuthStore } from '../../src/stores/authStore';
import {
  CASHIER_TAB_LABEL,
  STAFF_STATUS_LABEL,
  paymentLabel,
  waitingLabel,
  type CashierTab,
} from '../../src/cashier/cashierOrders';
import { fetchCashierQueue, subscribeCashierOrders, type CashierQueueOrder } from '../../src/services/cashierApi';
import type { OrderStatus } from '../../src/orders/orderWorkflow';

const TABS: CashierTab[] = ['pending', 'active', 'done'];

type Load =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'ready'; orders: CashierQueueOrder[] };

export default function CashierQueueScreen() {
  const role = useAuthStore((s) => s.role);
  const [tab, setTab] = useState<CashierTab>('pending');
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [refreshing, setRefreshing] = useState(false);
  const request = useRef(0);

  // Only the newest request may update the list (tab switches, realtime and
  // pull-to-refresh can overlap).
  const reload = useCallback(async (showSpinner: boolean) => {
    const id = ++request.current;
    if (showSpinner) setLoad({ state: 'loading' });
    const result = await fetchCashierQueue(tab);
    if (id !== request.current) return;
    if (result.ok) setLoad({ state: 'ready', orders: result.data });
    else
      setLoad({
        state: 'error',
        message:
          result.error.kind === 'network'
            ? 'Pas de connexion. Vérifiez le réseau puis réessayez.'
            : result.error.kind === 'not_available'
              ? 'Le serveur n’a pas encore le circuit des commandes.'
              : 'Les commandes n’ont pas pu être chargées.',
      });
  }, [tab]);

  useEffect(() => {
    void Promise.resolve().then(() => reload(true));
  }, [reload]);

  // Back from an order: show its new state.
  useFocusEffect(
    useCallback(() => {
      void reload(false);
    }, [reload])
  );

  useEffect(() => subscribeCashierOrders('cashier-queue', () => void reload(false)), [reload]);

  const onRefresh = async () => {
    setRefreshing(true);
    await reload(false);
    setRefreshing(false);
  };

  const signOut = () => void useAuthStore.getState().signOut();

  return (
    <Screen>
      <ScreenHeader
        title="Caisse"
        subtitle="Commandes à vérifier"
        right={
          <View style={styles.headerActions}>
            <IconButton icon="refresh" label="Actualiser" onPress={() => void reload(true)} />
            {role === 'admin' ? (
              <IconButton icon="arrow-back" label="Retour à l’administration" onPress={() => router.replace('/(admin)/orders')} />
            ) : (
              <IconButton icon="log-out-outline" label="Se déconnecter" onPress={signOut} />
            )}
          </View>
        }
      />
      <View style={styles.tabs} accessibilityRole="tablist">
        {TABS.map((t) => (
          <Chip key={t} label={CASHIER_TAB_LABEL[t]} active={tab === t} onPress={() => setTab(t)} />
        ))}
      </View>

      {load.state === 'loading' ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.colors.brand} accessibilityLabel="Chargement des commandes" />
        </View>
      ) : load.state === 'error' ? (
        <View style={styles.pad}>
          <FormMessage title="Commandes indisponibles" message={load.message} actionLabel="Réessayer" onAction={() => void reload(true)} />
        </View>
      ) : (
        <FlatList
          data={load.orders}
          keyExtractor={(o) => o.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.inkMuted} />}
          ListEmptyComponent={
            <EmptyState
              icon="receipt-outline"
              title={tab === 'pending' ? 'Aucune commande à confirmer' : tab === 'active' ? 'Aucune commande en cours' : 'Aucune commande terminée'}
              message={tab === 'pending' ? 'Les nouvelles commandes apparaissent ici.' : undefined}
            />
          }
          renderItem={({ item }) => <QueueCard order={item} />}
        />
      )}
    </Screen>
  );
}

function QueueCard({ order }: { order: CashierQueueOrder }) {
  const status = order.status as OrderStatus;
  const label = STAFF_STATUS_LABEL[status] ?? order.status;
  return (
    <TouchableOpacity
      activeOpacity={0.85}
      style={styles.card}
      onPress={() => router.push({ pathname: '/cashier/[id]', params: { id: order.id } })}
      accessibilityRole="button"
      accessibilityLabel={`Commande ${order.order_number}, ${label}, ${formatMad(Number(order.total))}`}
    >
      <View style={styles.cardTop}>
        <Text style={styles.number}>{order.order_number}</Text>
        <StatusBadge label={label} color={STAFF_STATUS_COLOR[order.status] ?? theme.colors.inkMuted} />
      </View>
      <View style={styles.cardRow}>
        <Text style={styles.total}>{formatMad(Number(order.total))}</Text>
        <Text style={styles.meta}>{waitingLabel(order.created_at)}</Text>
      </View>
      {order.delivery_address ? (
        <Text style={styles.address} numberOfLines={1}>
          {order.delivery_address}
        </Text>
      ) : null}
      <Text style={styles.meta}>{paymentLabel(order.payment_method, order.payment_status, order.status)}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  headerActions: { flexDirection: 'row', gap: theme.spacing.sm },
  tabs: { flexDirection: 'row', gap: theme.spacing.sm, paddingHorizontal: theme.spacing.xl, paddingBottom: theme.spacing.md },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  pad: { padding: theme.spacing.xl },
  list: { paddingHorizontal: theme.spacing.xl, paddingBottom: theme.spacing['3xl'], gap: theme.spacing.md },
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radii.lg,
    borderWidth: 1,
    borderColor: theme.colors.hairline,
    padding: theme.spacing.lg,
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: theme.spacing.sm },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: theme.spacing.xs },
  number: { fontSize: theme.typography.sizes.md, fontWeight: theme.typography.weights.bold, color: theme.colors.ink },
  total: { fontSize: theme.typography.sizes.lg, fontWeight: theme.typography.weights.extrabold, color: theme.colors.ink },
  address: { fontSize: theme.typography.sizes.sm, color: theme.colors.inkMuted, marginBottom: theme.spacing.xs },
  meta: { fontSize: theme.typography.sizes.xs, color: theme.colors.inkMuted },
});
