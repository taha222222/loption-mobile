// src/orders/orderWorkflow.ts
// The delivery-order state machine as the screens need it (which buttons to
// show). The database is the authority: public.order_transitions() and the
// workflow functions of 20261105120000_v1_order_workflow.sql decide; this
// copy only avoids offering an action the server would refuse.
// __tests__/orderWorkflow.test.ts checks it against the migration.

export const ORDER_STATUSES = ['pending', 'confirmed', 'preparing', 'ready', 'picked_up', 'on_the_way', 'delivered', 'cancelled'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export type OrderActor = 'cashier' | 'kitchen_staff' | 'driver' | 'customer';
export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded';

export interface OrderTransition {
  from: OrderStatus;
  to: OrderStatus;
  actor: OrderActor;
}

// Same rows as public.order_transitions(). An admin acts as 'cashier'.
export const ORDER_TRANSITIONS: readonly OrderTransition[] = [
  { from: 'pending', to: 'confirmed', actor: 'cashier' },
  { from: 'confirmed', to: 'preparing', actor: 'kitchen_staff' },
  { from: 'preparing', to: 'ready', actor: 'kitchen_staff' },
  { from: 'ready', to: 'picked_up', actor: 'driver' },
  { from: 'picked_up', to: 'on_the_way', actor: 'driver' },
  { from: 'on_the_way', to: 'delivered', actor: 'driver' },
  { from: 'pending', to: 'cancelled', actor: 'customer' },
  { from: 'pending', to: 'cancelled', actor: 'cashier' },
  { from: 'confirmed', to: 'cancelled', actor: 'cashier' },
  { from: 'preparing', to: 'cancelled', actor: 'cashier' },
  { from: 'ready', to: 'cancelled', actor: 'cashier' },
];

// Same rows as public.order_payment_transitions(): cash on delivery, recorded
// by the cashier once the order is delivered.
export const PAYMENT_TRANSITIONS: readonly { from: PaymentStatus; to: PaymentStatus; orderStatus: OrderStatus }[] = [
  { from: 'pending', to: 'paid', orderStatus: 'delivered' },
  { from: 'pending', to: 'failed', orderStatus: 'delivered' },
  { from: 'failed', to: 'paid', orderStatus: 'delivered' },
  { from: 'paid', to: 'refunded', orderStatus: 'delivered' },
];

// A driver can be (re)assigned before pickup only.
export const ASSIGNABLE_STATUSES: readonly OrderStatus[] = ['confirmed', 'preparing', 'ready'];
// The driver shares the position only between pickup and delivery.
export const LOCATION_STATUSES: readonly OrderStatus[] = ['picked_up', 'on_the_way'];

export const isOrderStatus = (s: unknown): s is OrderStatus => typeof s === 'string' && (ORDER_STATUSES as readonly string[]).includes(s);

// Orders created before the workflow (counter/kiosk, workflow_version NULL)
// are read-only history.
export const isWorkflowOrder = (o: { workflow_version?: number | null }): boolean => o.workflow_version === 1;

export function nextStatuses(status: string, actor: OrderActor): OrderStatus[] {
  return ORDER_TRANSITIONS.filter((t) => t.from === status && t.actor === actor).map((t) => t.to);
}

export function canTransition(from: string, to: string, actor: OrderActor): boolean {
  return ORDER_TRANSITIONS.some((t) => t.from === from && t.to === to && t.actor === actor);
}

export function nextPayments(payment: string | null | undefined, orderStatus: string): PaymentStatus[] {
  return PAYMENT_TRANSITIONS.filter((t) => t.from === payment && t.orderStatus === orderStatus).map((t) => t.to);
}

// Customer-facing labels (French, like the other customer screens).
// Every status a customer can see in French: the lifecycle statuses, and the
// statuses of historical (counter/kiosk) orders. Never a raw status code.
const HISTORICAL_STATUS_LABEL_FR: Record<string, string> = { new: 'Reçue', served: 'Servie', paid: 'Payée' };
export function customerStatusLabel(status: string): string {
  if (isOrderStatus(status)) return ORDER_STATUS_LABEL_FR[status];
  return HISTORICAL_STATUS_LABEL_FR[status] ?? 'Commande';
}

export const ORDER_STATUS_LABEL_FR: Record<OrderStatus, string> = {
  pending: 'En attente de confirmation',
  confirmed: 'Confirmée',
  preparing: 'En préparation',
  ready: 'Prête',
  picked_up: 'Récupérée par le livreur',
  on_the_way: 'En route',
  delivered: 'Livrée',
  cancelled: 'Annulée',
};
