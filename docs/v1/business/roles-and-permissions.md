# Roles and permissions

Authority comes only from `public.staff_roles` (roles `admin`, `support`, `cashier`, `kitchen_staff`, `driver`; at most
one active role per user, unique index `staff_roles_one_active_role`). Customers hold no staff role. Never from JWT
claims, `user_profiles.role/is_admin` or client state. Roles are granted/revoked by an admin through
`assign_staff_role` / `revoke_staff_role` (Phase 1C, **hosted**). The one-role rule is in the order workflow migration
(**local only**). Sources: `supabase/migrations/20261016170000_phase1c_security_containment.sql`,
`supabase/migrations/20261105120000_v1_order_workflow.sql`.

## Matrix (delivery orders; IMPLEMENTED local only unless stated)

| Capability | Customer | Cashier (own kitchen) | Kitchen staff (own kitchen) | Driver | Admin | Support |
|---|---|---|---|---|---|---|
| Create order (`create_order`) | ✔ own account, verified phone | ✘ staff refused | ✘ | ✘ | ✘ | ✘ |
| Read orders | own | workflow orders of kitchen | workflow orders of kitchen | assigned only | all (read) | UNKNOWN (#29) |
| Confirm (pending → confirmed) | ✘ | ✔ | ✘ | ✘ | ✔ | ✘ |
| Preparing / ready | ✘ | ✘ | ✔ | ✘ | ✘ (G1) | ✘ |
| Assign / reassign driver (before pickup) | ✘ | ✔ | ✘ | ✘ | ✔ | ✘ |
| Pickup / on the way / delivered | ✘ | ✘ | ✘ | ✔ assigned | ✘ | ✘ |
| Cancel | ✔ while pending | ✔ until ready, reason | ✘ | ✘ | ✔ until ready, reason | ✘ |
| Record payment (paid / failed / refunded) | ✘ | ✔ | ✘ | ✘ | ✔ | ✘ |
| Report location | ✘ | ✘ | ✘ | ✔ own delivery, picked_up → delivered | ✘ | ✘ |
| See driver position | ✔ own order, pickup → delivery | UNKNOWN | ✘ | own | ✔ history (admin only) | ✘ |
| See customer's verified phone (`orders.delivery_phone`) | own | ✔ (row read) | ✔ (row read, #31) | ✔ assigned | ✔ | ✘ |
| Write prices, pricing rows, tax categories, promo codes | ✘ | ✘ | ✘ | ✘ | ✘ (owner as `postgres`) | ✘ |
| Edit meals / meal choices | ✘ | ✘ | ✘ | ✘ | ✔ (RLS admin policy) | ✘ |
| Direct UPDATE/INSERT of orders | ✘ | ✘ | ✘ | ✘ | ✘ (guard) | ✘ |
| Delete a workflow order, edit/delete its timeline | ✘ | ✘ | ✘ | ✘ | ✘ (guard, `20261110…`) | ✘ |
| Detach the customer from an order | via account deletion only | ✘ | ✘ | ✘ | ✘ (`20261110…`) | ✘ |

Screens (local): cashier → `app/cashier/` (queue, confirm, cancel with reason; Milestone 2); admin → `app/(admin)` and
the cashier queue; driver → `app/(driver)`; kitchen staff → `app/kitchen/` (board, preparing/ready; Milestone 3);
support → no screen (customer app). The kitchen board requests no phone, address or amount (the row policy still
allows them, #31/#62). The cashier sees the
order's verified phone and delivery address, not the customer's name or account (#61).

Confirmed by owner (2026-11-05): cashier confirms; cashier/admin assigns drivers; customer cancels while pending;
staff cancel until ready with a reason; one active staff role per user; kitchen scoping kept.

Open: keep or remove `support` (#29); kitchen staff seeing the full order row incl. address and phone (#31).
Driver approval = an admin grants the `driver` staff role; `set_driver_availability` (online/offline) requires a
`drivers` row (Phase 1C, hosted). Whether availability gates assignment: **UNKNOWN / not enforced**.
