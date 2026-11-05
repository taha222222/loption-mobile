// src/checkout/checkoutAvailability.ts
// Ordering stays closed until the server creates orders itself:
//   * public.create_order() exists on the project (trusted order creation,
//     checklist H4), and
//   * delivery fee, service fee, TVA and minimum order are approved
//     (checklist H1-H3).
// Owner decision 2026-11-05: the Place Order button is disabled until then.
// The app never writes orders or order lines itself (the database refuses it
// too); opening checkout is a reviewed change of this constant.
export const CHECKOUT_OPEN = false;

export const CHECKOUT_CLOSED_TITLE = 'Commandes bientôt disponibles';
export const CHECKOUT_CLOSED_MESSAGE =
  'La commande en ligne ouvrira dès que les tarifs de livraison seront validés. Votre panier est conservé ; rien n’est commandé ni facturé.';
