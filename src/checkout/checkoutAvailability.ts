// src/checkout/checkoutAvailability.ts
// Ordering stays closed until the server creates orders itself:
//   * public.create_order() exists on the project (trusted order creation,
//     checklist H4), and
//   * delivery fee, service fee, TVA and minimum order are approved
//     (checklist H1-H3).
// Owner decision 2026-11-05: the Place Order button is disabled until then.
// The app never writes orders or order lines itself (the database refuses it
// too). Closed unless the build sets EXPO_PUBLIC_CHECKOUT_OPEN=true exactly:
// only test builds pointed at a test project with approved test pricing do
// (owner, 2026-11-10). The server refuses orders anyway while pricing, taxes
// or the road-distance quote are missing.
export const checkoutOpenFrom = (value: string | undefined): boolean => value === 'true';
export const CHECKOUT_OPEN = checkoutOpenFrom(process.env.EXPO_PUBLIC_CHECKOUT_OPEN);

// Shown next to the disabled confirm button, to say why it is disabled.
export const CHECKOUT_CLOSED_TITLE = 'La commande en ligne ouvre bientôt';
export const CHECKOUT_CLOSED_MESSAGE = 'Votre panier est conservé. Rien n’est commandé ni facturé pour l’instant.';
