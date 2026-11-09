// Customers never see a raw status code: every lifecycle status and every
// historical (counter/kiosk) status has a French label.
import { ORDER_STATUSES, customerStatusLabel } from '../src/orders/orderWorkflow';

it('labels every lifecycle status in French', () => {
  expect(ORDER_STATUSES.map(customerStatusLabel)).toEqual([
    'En attente de confirmation', 'Confirmée', 'En préparation', 'Prête', 'Récupérée par le livreur', 'En route', 'Livrée', 'Annulée',
  ]);
});

it('labels historical statuses and never shows an unknown code', () => {
  expect(customerStatusLabel('served')).toBe('Servie');
  expect(customerStatusLabel('paid')).toBe('Payée');
  expect(customerStatusLabel('new')).toBe('Reçue');
  expect(customerStatusLabel('something_else')).toBe('Commande');
});
