// src/cashier/cashierOrders.ts
// What the cashier screens show and offer, as pure functions. The server is
// the authority: order_confirm / order_cancel check the role, the kitchen and
// the state, and the amounts are the order's server-computed values. This
// module only decides which buttons to offer and how to word the answers.
import { isWorkflowOrder, nextStatuses, type OrderStatus } from '../orders/orderWorkflow';
import type { WorkflowResult } from '../services/orderWorkflowApi';

export type CashierTab = 'pending' | 'active' | 'done';

// Pending = waiting for the cashier. Active = accepted and not yet delivered.
// Done = delivered or cancelled (most recent first).
export const CASHIER_TAB_STATUSES: Record<CashierTab, readonly OrderStatus[]> = {
  pending: ['pending'],
  active: ['confirmed', 'preparing', 'ready', 'picked_up', 'on_the_way'],
  done: ['delivered', 'cancelled'],
};

export const CASHIER_TAB_LABEL: Record<CashierTab, string> = {
  pending: 'À confirmer',
  active: 'En cours',
  done: 'Terminées',
};

// Oldest first while an order waits (first in, first served); newest first
// for the history.
export const CASHIER_TAB_ASCENDING: Record<CashierTab, boolean> = { pending: true, active: true, done: false };

export const STAFF_STATUS_LABEL: Record<OrderStatus, string> = {
  pending: 'À confirmer',
  confirmed: 'Confirmée',
  preparing: 'En préparation',
  ready: 'Prête',
  picked_up: 'Récupérée par le livreur',
  on_the_way: 'En route',
  delivered: 'Livrée',
  cancelled: 'Annulée',
};

export interface CashierOrderLike {
  status: string;
  workflow_version: number | null;
}

// Actions the server would accept from a cashier/admin, from the shared
// transition table (src/orders/orderWorkflow.ts mirrors order_transitions()).
// No payment, driver or kitchen action here: confirmation is not payment.
export function cashierActions(order: CashierOrderLike): { confirm: boolean; cancel: boolean } {
  if (!isWorkflowOrder(order)) return { confirm: false, cancel: false };
  const next = nextStatuses(order.status, 'cashier');
  return { confirm: next.includes('confirmed'), cancel: next.includes('cancelled') };
}

// Same limits as the server: order_cancel requires >= 3 characters for staff,
// orders.cancel_reason allows at most 300.
export const CANCEL_REASON_MIN = 3;
export const CANCEL_REASON_MAX = 300;

export function validateCancelReason(raw: string): { ok: true; reason: string } | { ok: false; message: string } {
  const reason = raw.trim();
  if (reason.length < CANCEL_REASON_MIN) return { ok: false, message: 'Indiquez le motif de l’annulation (3 caractères minimum).' };
  if (reason.length > CANCEL_REASON_MAX) return { ok: false, message: 'Le motif est limité à 300 caractères.' };
  return { ok: true, reason };
}

export type CashierAction = 'confirm' | 'cancel';

export interface ActionFeedback {
  tone: 'success' | 'info' | 'error';
  message: string;
  // The order changed on the server or someone else acted: reload it.
  refresh: boolean;
}

// The server's answer, in words for the cashier. A refused call is never
// shown as a success; "unchanged" means the order was already in that state
// (double tap, a colleague, a retry) and nothing was written.
export function describeActionResult(action: CashierAction, result: WorkflowResult): ActionFeedback {
  if (result.ok) {
    if (action === 'confirm') {
      return result.changed
        ? { tone: 'success', message: 'Commande confirmée. Le paiement reste à encaisser à la livraison.', refresh: true }
        : { tone: 'info', message: 'Cette commande était déjà confirmée. Rien n’a été modifié.', refresh: true };
    }
    return result.changed
      ? { tone: 'success', message: 'Commande annulée. Le motif est visible par le client.', refresh: true }
      : { tone: 'info', message: 'Cette commande était déjà annulée. Rien n’a été modifié.', refresh: true };
  }
  switch (result.error.kind) {
    case 'invalid':
      if (/cancellation reason/i.test(result.error.message)) {
        return { tone: 'error', message: 'Le motif de l’annulation est obligatoire (3 caractères minimum).', refresh: false };
      }
      return {
        tone: 'error',
        message: 'Cette action n’est plus possible : la commande a changé entre-temps. Voici son état actuel.',
        refresh: true,
      };
    case 'not_allowed':
      return { tone: 'error', message: 'Action refusée : ce compte ne gère pas les commandes de cette cuisine.', refresh: true };
    case 'not_available':
      return { tone: 'error', message: 'Le serveur n’a pas encore le circuit des commandes. Rien n’a été modifié.', refresh: false };
    case 'network':
      return { tone: 'error', message: 'Pas de connexion : rien n’a été modifié. Réessayez.', refresh: false };
    default:
      return { tone: 'error', message: `Action refusée par le serveur. Rien n’a été modifié. (${result.error.message})`, refresh: true };
  }
}

// Cash on delivery is the only method. The payment state is shown as the
// server keeps it; a confirmed order is never "paid".
export function paymentLabel(method: string | null | undefined, status: string | null | undefined, orderStatus?: string): string {
  const how = method === 'cash' || !method ? 'Paiement à la livraison (espèces)' : `Paiement : ${method}`;
  if (orderStatus === 'cancelled' && (status === 'pending' || !status)) return `${how} · commande annulée, rien à encaisser`;
  const state =
    status === 'paid' ? 'encaissé'
    : status === 'failed' ? 'non encaissé'
    : status === 'refunded' ? 'remboursé'
    : 'à encaisser à la livraison';
  return `${how} · ${state}`;
}

export interface OrderLineOption {
  group?: string | null;
  name?: string | null;
}

// "Sauce : Harissa · Taille : Grande" from the line's options snapshot.
export function formatLineOptions(options: unknown): string | null {
  if (!Array.isArray(options) || options.length === 0) return null;
  const parts = (options as OrderLineOption[])
    .filter((o) => o && typeof o === 'object' && typeof o.name === 'string' && o.name.trim() !== '')
    .map((o) => (o.group ? `${o.group} : ${o.name}` : String(o.name)));
  return parts.length ? parts.join(' · ') : null;
}

// Minutes since the order was placed, for the queue ("il y a 12 min").
export function waitingLabel(createdAt: string, now: number = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - new Date(createdAt).getTime()) / 60000));
  if (minutes < 1) return 'à l’instant';
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `il y a ${hours} h ${String(minutes % 60).padStart(2, '0')}`;
}

// Timeline row labels (order_status_updates holds status changes only).
export function timelineLabel(status: string): string {
  return (STAFF_STATUS_LABEL as Record<string, string>)[status] ?? status;
}

// Phone number in tel: form (the verified E.164 number from the order).
export function phoneHref(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const clean = phone.replace(/[^+\d]/g, '');
  return clean.length >= 8 ? `tel:${clean}` : null;
}

// "08/11 14:05" in the device's time zone (the kitchen's tablet), without
// relying on Intl time-zone support.
export function formatStaffTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const two = (n: number) => String(n).padStart(2, '0');
  return `${two(d.getDate())}/${two(d.getMonth() + 1)} ${two(d.getHours())}:${two(d.getMinutes())}`;
}
