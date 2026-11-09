import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { BrandButton, Chip, EmptyState, FormMessage, IconButton, Screen, ScreenHeader, StatusBadge } from '../../src/components/v2';
import { theme } from '../../src/theme';
import { useAuthStore } from '../../src/stores/authStore';
import { STAFF_STATUS_LABEL, formatLineOptions } from '../../src/cashier/cashierOrders';
import { STAFF_STATUS_COLOR } from '../../src/cashier/statusColors';
import {
  KITCHEN_STEP_BUTTON,
  KITCHEN_TAB_LABEL,
  boardTime,
  describeKitchenResult,
  groupByTab,
  kitchenNextStep,
  portions,
  sinceLabel,
  type KitchenFeedback,
  type KitchenTab,
} from '../../src/kitchen/kitchenOrders';
import { fetchKitchenBoard, type KitchenOrder } from '../../src/services/kitchenApi';
import { subscribeOrderChanges } from '../../src/services/orderRealtime';
import { kitchenUpdate } from '../../src/services/orderWorkflowApi';
import type { OrderStatus } from '../../src/orders/orderWorkflow';

const TABS: KitchenTab[] = ['todo', 'preparing', 'ready'];

type Load =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'ready'; orders: KitchenOrder[] };

export default function KitchenBoardScreen() {
  const [tab, setTab] = useState<KitchenTab>('todo');
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [refreshing, setRefreshing] = useState(false);
  const [busyOrder, setBusyOrder] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<KitchenFeedback | null>(null);
  const request = useRef(0);
  // Synchronous guard: one request per order at a time, even before the
  // disabled state has rendered (double tap on a kitchen tablet).
  const inFlight = useRef(new Set<string>());

  const reload = useCallback(async (showSpinner: boolean) => {
    const n = ++request.current;
    if (showSpinner) setLoad({ state: 'loading' });
    const result = await fetchKitchenBoard();
    if (n !== request.current) return;
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
  }, []);

  useEffect(() => {
    void Promise.resolve().then(() => reload(true));
  }, [reload]);

  useFocusEffect(
    useCallback(() => {
      void reload(false);
    }, [reload])
  );

  useEffect(() => subscribeOrderChanges('kitchen-board', () => void reload(false)), [reload]);

  const advance = async (order: KitchenOrder) => {
    const step = kitchenNextStep(order);
    if (!step || inFlight.current.has(order.id)) return;
    inFlight.current.add(order.id);
    setBusyOrder(order.id);
    setFeedback(null);
    const result = await kitchenUpdate(order.id, step);
    const next = describeKitchenResult(order.order_number, step, result);
    setFeedback(next);
    if (next.refresh) await reload(false);
    inFlight.current.delete(order.id);
    setBusyOrder(null);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await reload(false);
    setRefreshing(false);
  };

  const groups = load.state === 'ready' ? groupByTab(load.orders) : null;

  return (
    <Screen>
      <ScreenHeader
        title="Cuisine"
        subtitle="Commandes confirmées"
        right={
          <View style={styles.headerActions}>
            <IconButton icon="refresh" label="Actualiser" onPress={() => void reload(true)} />
            <IconButton icon="log-out-outline" label="Se déconnecter" onPress={() => void useAuthStore.getState().signOut()} />
          </View>
        }
      />
      <View style={styles.tabs} accessibilityRole="tablist">
        {TABS.map((t) => (
          <Chip
            key={t}
            label={groups ? `${KITCHEN_TAB_LABEL[t]} (${groups[t].length})` : KITCHEN_TAB_LABEL[t]}
            active={tab === t}
            onPress={() => setTab(t)}
          />
        ))}
      </View>

      {feedback ? (
        <View style={styles.feedback} accessibilityLiveRegion="polite">
          <FormMessage
            title={feedback.tone === 'error' ? 'Action non effectuée' : feedback.tone === 'success' ? 'C’est fait' : 'Déjà fait'}
            message={feedback.message}
            tone={feedback.tone === 'error' ? 'error' : 'info'}
          />
        </View>
      ) : null}

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
          data={groups ? groups[tab] : []}
          keyExtractor={(o) => o.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.inkMuted} />}
          ListEmptyComponent={
            <EmptyState
              icon="restaurant-outline"
              title={tab === 'todo' ? 'Aucune commande à préparer' : tab === 'preparing' ? 'Aucune commande en préparation' : 'Aucune commande prête'}
              message={tab === 'todo' ? 'Les commandes confirmées par la caisse apparaissent ici.' : undefined}
            />
          }
          renderItem={({ item }) => (
            <KitchenCard order={item} busy={busyOrder === item.id} disabled={busyOrder !== null} onAdvance={() => void advance(item)} />
          )}
        />
      )}
    </Screen>
  );
}

function KitchenCard({ order, busy, disabled, onAdvance }: { order: KitchenOrder; busy: boolean; disabled: boolean; onAdvance: () => void }) {
  const status = order.status as OrderStatus;
  const step = kitchenNextStep(order);
  return (
    <View style={styles.card} accessibilityLabel={`Commande ${order.order_number}, ${STAFF_STATUS_LABEL[status] ?? order.status}`}>
      <View style={styles.cardTop}>
        <Text style={styles.number}>{order.order_number}</Text>
        <StatusBadge label={STAFF_STATUS_LABEL[status] ?? order.status} color={STAFF_STATUS_COLOR[order.status] ?? theme.colors.inkMuted} />
      </View>
      <Text style={styles.meta}>
        {portions(order.items)} portion{portions(order.items) > 1 ? 's' : ''} · {sinceLabel(boardTime(order))}
      </Text>
      <View style={styles.items}>
        {order.items.length === 0 ? <Text style={styles.meta}>Aucun article enregistré.</Text> : null}
        {order.items.map((item) => {
          const options = formatLineOptions(item.options);
          return (
            <View key={item.id} style={styles.item}>
              <Text style={styles.itemName}>
                {item.quantity} × {item.meal_name}
              </Text>
              {options ? <Text style={styles.itemDetail}>{options}</Text> : null}
              {item.notes ? <Text style={styles.itemNote}>Note : {item.notes}</Text> : null}
            </View>
          );
        })}
      </View>
      {step ? (
        <BrandButton title={KITCHEN_STEP_BUTTON[step]} onPress={onAdvance} loading={busy} disabled={disabled} style={styles.action} />
      ) : (
        <Text style={styles.waiting}>
          {order.driver_id ? 'En attente du livreur (livreur assigné)' : 'En attente du livreur (pas encore assigné par la caisse)'}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  headerActions: { flexDirection: 'row', gap: theme.spacing.sm },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm, paddingHorizontal: theme.spacing.xl, paddingBottom: theme.spacing.md },
  feedback: { paddingHorizontal: theme.spacing.xl, paddingBottom: theme.spacing.md },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  pad: { padding: theme.spacing.xl },
  list: { paddingHorizontal: theme.spacing.xl, paddingBottom: theme.spacing['3xl'], gap: theme.spacing.md },
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radii.lg,
    borderWidth: 1,
    borderColor: theme.colors.hairline,
    padding: theme.spacing.lg,
    gap: theme.spacing.sm,
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  number: { fontSize: theme.typography.sizes.xl, fontWeight: theme.typography.weights.extrabold, color: theme.colors.ink },
  meta: { fontSize: theme.typography.sizes.sm, color: theme.colors.inkMuted },
  items: { gap: theme.spacing.sm, paddingVertical: theme.spacing.xs },
  item: { borderLeftWidth: 3, borderLeftColor: theme.colors.brandSoft, paddingLeft: theme.spacing.md },
  itemName: { fontSize: theme.typography.sizes.lg, fontWeight: theme.typography.weights.bold, color: theme.colors.ink },
  itemDetail: { fontSize: theme.typography.sizes.md, color: theme.colors.ink, marginTop: 2 },
  itemNote: { fontSize: theme.typography.sizes.md, fontWeight: theme.typography.weights.semibold, color: theme.colors.coral, marginTop: 2 },
  action: { marginTop: theme.spacing.xs },
  waiting: { fontSize: theme.typography.sizes.sm, color: theme.colors.inkMuted, textAlign: 'center', paddingVertical: theme.spacing.sm },
});
