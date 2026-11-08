import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import {
  BrandButton,
  FormMessage,
  IconButton,
  Screen,
  ScreenHeader,
  StatusBadge,
  SurfaceCard,
  TextField,
  confirmAction,
} from '../../src/components/v2';
import { theme } from '../../src/theme';
import { formatMad } from '../../src/menu/customization';
import {
  CANCEL_REASON_MAX,
  STAFF_STATUS_LABEL,
  cashierActions,
  describeActionResult,
  formatLineOptions,
  formatStaffTime,
  paymentLabel,
  phoneHref,
  timelineLabel,
  validateCancelReason,
  type ActionFeedback,
  type CashierAction,
} from '../../src/cashier/cashierOrders';
import { STAFF_STATUS_COLOR } from '../../src/cashier/statusColors';
import { fetchCashierOrder, subscribeCashierOrders, type CashierOrderDetail } from '../../src/services/cashierApi';
import { cancelOrder, confirmOrder } from '../../src/services/orderWorkflowApi';
import type { OrderStatus } from '../../src/orders/orderWorkflow';

type Load =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'missing' }
  | { state: 'ready'; order: CashierOrderDetail };

export default function CashierOrderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const orderId = typeof id === 'string' ? id : '';
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [refreshing, setRefreshing] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [busy, setBusy] = useState<CashierAction | null>(null);
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null);
  // Synchronous guard: a double tap sends one request, even before the
  // disabled state has rendered.
  const inFlight = useRef(false);
  const request = useRef(0);

  const reload = useCallback(
    async (showSpinner: boolean) => {
      const n = ++request.current;
      if (showSpinner) setLoad({ state: 'loading' });
      const result = await fetchCashierOrder(orderId);
      if (n !== request.current) return;
      if (!result.ok) {
        setLoad({
          state: 'error',
          message:
            result.error.kind === 'network'
              ? 'Pas de connexion. Vérifiez le réseau puis réessayez.'
              : 'La commande n’a pas pu être chargée.',
        });
      } else if (!result.data) setLoad({ state: 'missing' });
      else setLoad({ state: 'ready', order: result.data });
    },
    [orderId]
  );

  useEffect(() => {
    void Promise.resolve().then(() => reload(true));
  }, [reload]);

  useEffect(() => subscribeCashierOrders(`cashier-order-${orderId}`, () => void reload(false)), [orderId, reload]);

  const run = async (action: CashierAction, call: () => ReturnType<typeof confirmOrder>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(action);
    setFeedback(null);
    const result = await call();
    const next = describeActionResult(action, result);
    setFeedback(next);
    if (result.ok && action === 'cancel') setReason('');
    if (next.refresh) await reload(false);
    setBusy(null);
    inFlight.current = false;
  };

  const onConfirm = () => void run('confirm', () => confirmOrder(orderId));

  const onCancel = () => {
    const checked = validateCancelReason(reason);
    if (!checked.ok) {
      setReasonError(checked.message);
      return;
    }
    setReasonError(null);
    confirmAction(
      'Annuler la commande ?',
      `Le client verra le motif : « ${checked.reason} ». Cette action est définitive.`,
      'Annuler la commande',
      () => void run('cancel', () => cancelOrder(orderId, checked.reason))
    );
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await reload(false);
    setRefreshing(false);
  };

  const back = () => (router.canGoBack() ? router.back() : router.replace('/cashier'));

  if (load.state !== 'ready') {
    return (
      <Screen>
        <ScreenHeader title="Commande" right={<IconButton icon="close" label="Retour à la liste" onPress={back} />} />
        <View style={styles.pad}>
          {load.state === 'loading' ? (
            <ActivityIndicator color={theme.colors.brand} accessibilityLabel="Chargement de la commande" />
          ) : load.state === 'missing' ? (
            <FormMessage
              title="Commande introuvable"
              message="Cette commande n’existe pas ou n’appartient pas à votre cuisine."
              tone="info"
              actionLabel="Retour à la liste"
              onAction={back}
            />
          ) : (
            <FormMessage title="Commande indisponible" message={load.message} actionLabel="Réessayer" onAction={() => void reload(true)} />
          )}
        </View>
      </Screen>
    );
  }

  const order = load.order;
  const status = order.status as OrderStatus;
  const actions = cashierActions(order);
  const tel = phoneHref(order.delivery_phone);
  const reasonValid = validateCancelReason(reason).ok;

  return (
    <Screen>
      <ScreenHeader
        title={order.order_number}
        subtitle={`Passée le ${formatStaffTime(order.created_at)}`}
        right={<IconButton icon="close" label="Retour à la liste" onPress={back} />}
      />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.inkMuted} />}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.statusRow}>
          <StatusBadge label={STAFF_STATUS_LABEL[status] ?? order.status} color={STAFF_STATUS_COLOR[order.status] ?? theme.colors.inkMuted} />
          <Text style={styles.meta}>Mise à jour {formatStaffTime(order.status_changed_at ?? order.created_at)}</Text>
        </View>

        {feedback ? (
          <View accessibilityLiveRegion="polite" style={styles.feedback}>
            <FormMessage
              title={feedback.tone === 'error' ? 'Action non effectuée' : feedback.tone === 'success' ? 'C’est fait' : 'Déjà fait'}
              message={feedback.message}
              tone={feedback.tone === 'error' ? 'error' : 'info'}
            />
          </View>
        ) : null}

        {actions.confirm ? (
          <BrandButton
            title="Confirmer la commande"
            onPress={onConfirm}
            loading={busy === 'confirm'}
            disabled={busy !== null}
            style={styles.primary}
          />
        ) : null}
        {actions.confirm ? (
          <Text style={styles.note}>Confirmer n’encaisse rien : le client paie en espèces à la livraison.</Text>
        ) : null}

        <Section title="Client">
          <Row label="Téléphone vérifié" value={order.delivery_phone ?? 'Non renseigné'} />
          {tel ? (
            <BrandButton title="Appeler le client" variant="soft" onPress={() => void Linking.openURL(tel)} style={styles.secondary} />
          ) : null}
          <Row label="Adresse de livraison" value={order.delivery_address ?? 'Non renseignée'} />
        </Section>

        <Section title={`Articles (${order.items.reduce((n, i) => n + Number(i.quantity), 0)})`}>
          {order.items.length === 0 ? <Text style={styles.meta}>Aucun article enregistré.</Text> : null}
          {order.items.map((item) => {
            const options = formatLineOptions(item.options);
            return (
              <View key={item.id} style={styles.item}>
                <View style={styles.itemTop}>
                  <Text style={styles.itemName}>
                    {item.quantity} × {item.meal_name}
                  </Text>
                  {item.line_total_ttc != null ? <Text style={styles.itemPrice}>{formatMad(Number(item.line_total_ttc))}</Text> : null}
                </View>
                {options ? <Text style={styles.itemDetail}>{options}</Text> : null}
                {item.notes ? <Text style={styles.itemDetail}>Note du client : {item.notes}</Text> : null}
              </View>
            );
          })}
        </Section>

        <Section title="Montant (calculé par le serveur)">
          {order.subtotal != null ? <Row label="Articles" value={formatMad(Number(order.subtotal))} /> : null}
          {Number(order.promo_discount ?? 0) > 0 ? <Row label="Réduction" value={`-${formatMad(Number(order.promo_discount))}`} /> : null}
          {order.platform_service_fee != null ? <Row label="Frais de service" value={formatMad(Number(order.platform_service_fee))} /> : null}
          {order.delivery_fee != null ? <Row label="Livraison" value={formatMad(Number(order.delivery_fee))} /> : null}
          <Row label={order.status === 'cancelled' ? 'Total de la commande' : 'Total à encaisser'} value={formatMad(Number(order.total))} strong />
          <Text style={styles.meta}>{paymentLabel(order.payment_method, order.payment_status, order.status)}</Text>
        </Section>

        <Section title="Historique">
          <Row label="Commande passée" value={formatStaffTime(order.created_at)} />
          {order.timeline
            .filter((t) => t.status !== 'pending')
            .map((t) => (
              <View key={t.id}>
                <Row label={timelineLabel(t.status)} value={formatStaffTime(t.created_at)} />
                {t.message ? <Text style={styles.itemDetail}>Motif : {t.message}</Text> : null}
              </View>
            ))}
        </Section>

        {actions.cancel ? (
          <Section title="Annuler la commande">
            <TextField
              label="Motif de l’annulation"
              value={reason}
              onChangeText={(t) => {
                setReason(t);
                if (reasonError) setReasonError(null);
              }}
              maxLength={CANCEL_REASON_MAX}
              error={reasonError}
              hint="Obligatoire. Le client voit ce motif."
            />
            <BrandButton
              title="Annuler la commande"
              variant="soft"
              onPress={onCancel}
              loading={busy === 'cancel'}
              disabled={busy !== null || !reasonValid}
              style={styles.secondary}
            />
          </Section>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <SurfaceCard style={styles.section}>
      <Text style={styles.sectionTitle} accessibilityRole="header">
        {title}
      </Text>
      {children}
    </SurfaceCard>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, strong && styles.strong]}>{label}</Text>
      <Text style={[styles.rowValue, strong && styles.strong]} selectable>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pad: { padding: theme.spacing.xl },
  content: { paddingHorizontal: theme.spacing.xl, paddingBottom: theme.spacing['4xl'], gap: theme.spacing.md },
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  feedback: {},
  primary: { marginTop: theme.spacing.xs },
  secondary: { marginTop: theme.spacing.sm, marginBottom: theme.spacing.sm },
  note: { fontSize: theme.typography.sizes.xs, color: theme.colors.inkMuted, textAlign: 'center' },
  section: { gap: theme.spacing.sm },
  sectionTitle: { fontSize: theme.typography.sizes.md, fontWeight: theme.typography.weights.bold, color: theme.colors.ink },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: theme.spacing.md },
  rowLabel: { flexShrink: 0, fontSize: theme.typography.sizes.sm, color: theme.colors.inkMuted },
  rowValue: { flex: 1, textAlign: 'right', fontSize: theme.typography.sizes.sm, color: theme.colors.ink },
  strong: { fontWeight: theme.typography.weights.extrabold, color: theme.colors.ink, fontSize: theme.typography.sizes.md },
  meta: { fontSize: theme.typography.sizes.xs, color: theme.colors.inkMuted },
  item: { paddingVertical: theme.spacing.xs, borderBottomWidth: 1, borderBottomColor: theme.colors.hairline },
  itemTop: { flexDirection: 'row', justifyContent: 'space-between', gap: theme.spacing.md },
  itemName: { flex: 1, fontSize: theme.typography.sizes.sm, fontWeight: theme.typography.weights.semibold, color: theme.colors.ink },
  itemPrice: { fontSize: theme.typography.sizes.sm, color: theme.colors.ink },
  itemDetail: { fontSize: theme.typography.sizes.xs, color: theme.colors.inkMuted, marginTop: 2 },
});
