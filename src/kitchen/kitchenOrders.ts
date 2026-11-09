// src/kitchen/kitchenOrders.ts
// What the kitchen board shows and offers, as pure functions. The server is
// the authority: order_kitchen_update accepts confirmed -> preparing ->
// ready from kitchen staff of the order's kitchen only. The kitchen never
// confirms, cancels, assigns a driver or touches payment.
import { isWorkflowOrder, nextStatuses, type OrderStatus } from '../orders/orderWorkflow';
import type { WorkflowResult } from '../services/orderWorkflowApi';

export type KitchenTab = 'todo' | 'preparing' | 'ready';
export type KitchenStep = Extract<OrderStatus, 'preparing' | 'ready'>;

export const KITCHEN_TAB_STATUS: Record<KitchenTab, OrderStatus> = {
  todo: 'confirmed',
  preparing: 'preparing',
  ready: 'ready',
};
export const KITCHEN_STATUSES: readonly OrderStatus[] = ['confirmed', 'preparing', 'ready'];

export const KITCHEN_TAB_LABEL: Record<KitchenTab, string> = {
  todo: 'À préparer',
  preparing: 'En préparation',
  ready: 'Prêtes',
};

export const KITCHEN_STEP_BUTTON: Record<KitchenStep, string> = {
  preparing: 'Commencer la préparation',
  ready: 'Commande prête',
};

export interface KitchenOrderLike {
  status: string;
  workflow_version: number | null;
}

// The one step the kitchen may take now, from the shared transition table
// (src/orders/orderWorkflow.ts mirrors order_transitions()).
export function kitchenNextStep(order: KitchenOrderLike): KitchenStep | null {
  if (!isWorkflowOrder(order)) return null;
  const next = nextStatuses(order.status, 'kitchen_staff');
  if (next.includes('preparing')) return 'preparing';
  if (next.includes('ready')) return 'ready';
  return null;
}

export function kitchenTabOf(status: string): KitchenTab | null {
  if (status === 'confirmed') return 'todo';
  if (status === 'preparing') return 'preparing';
  if (status === 'ready') return 'ready';
  return null;
}

// Board order: the order waiting longest first (time it entered its column).
export function boardTime(o: { status: string; created_at: string; confirmed_at?: string | null; preparing_at?: string | null; ready_at?: string | null }): string {
  if (o.status === 'ready') return o.ready_at ?? o.preparing_at ?? o.confirmed_at ?? o.created_at;
  if (o.status === 'preparing') return o.preparing_at ?? o.confirmed_at ?? o.created_at;
  return o.confirmed_at ?? o.created_at;
}

export function groupByTab<T extends { status: string; created_at: string }>(orders: readonly T[]): Record<KitchenTab, T[]> {
  const groups: Record<KitchenTab, T[]> = { todo: [], preparing: [], ready: [] };
  for (const o of orders) {
    const tab = kitchenTabOf(o.status);
    if (tab) groups[tab].push(o);
  }
  for (const tab of Object.keys(groups) as KitchenTab[]) {
    groups[tab].sort((a, b) => boardTime(a).localeCompare(boardTime(b)));
  }
  return groups;
}

export interface KitchenFeedback {
  tone: 'success' | 'info' | 'error';
  message: string;
  refresh: boolean;
}

// The server's answer in words for the kitchen. A refused call is never shown
// as done; "unchanged" means someone already did it (another cook, a retry).
export function describeKitchenResult(orderNumber: string, step: KitchenStep, result: WorkflowResult): KitchenFeedback {
  if (result.ok) {
    if (step === 'preparing') {
      return result.changed
        ? { tone: 'success', message: `${orderNumber} : préparation commencée.`, refresh: true }
        : { tone: 'info', message: `${orderNumber} était déjà en préparation. Rien n’a été modifié.`, refresh: true };
    }
    return result.changed
      ? { tone: 'success', message: `${orderNumber} est prête pour le livreur.`, refresh: true }
      : { tone: 'info', message: `${orderNumber} était déjà prête. Rien n’a été modifié.`, refresh: true };
  }
  switch (result.error.kind) {
    case 'invalid':
      return {
        tone: 'error',
        message: `${orderNumber} a changé entre-temps (annulée par la caisse ou déjà avancée). Le tableau est mis à jour.`,
        refresh: true,
      };
    case 'not_allowed':
      return { tone: 'error', message: `Action refusée : ce compte ne prépare pas les commandes de cette cuisine.`, refresh: true };
    case 'not_available':
      return { tone: 'error', message: 'Le serveur n’a pas encore le circuit des commandes. Rien n’a été modifié.', refresh: false };
    case 'network':
      return { tone: 'error', message: 'Pas de connexion : rien n’a été modifié. Réessayez.', refresh: false };
    default:
      return { tone: 'error', message: `Action refusée par le serveur. Rien n’a été modifié. (${result.error.message})`, refresh: true };
  }
}

// "depuis 12 min" for the time an order has spent in its column.
export function sinceLabel(iso: string, now: number = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return 'à l’instant';
  if (minutes < 60) return `depuis ${minutes} min`;
  return `depuis ${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`;
}

// Total portions on the order (the cook's count).
export function portions(items: readonly { quantity: number }[]): number {
  return items.reduce((n, i) => n + Number(i.quantity || 0), 0);
}
