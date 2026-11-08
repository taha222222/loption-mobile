---
name: loption-kitchen-operations
description: L'OPTION kitchen side of the order lifecycle — kitchen order queue, preparing and ready-for-pickup steps, kitchen staff scope and permissions, availability/capacity and operational exceptions. Use for any kitchen screen, kitchen queue, preparation workflow or kitchen-staff permission task. Always together with loption-order-operations.
---

# Kitchen operations

## Current state (verified 2026-11-08)
- Kitchen staff role exists (`staff_roles.role = 'kitchen_staff'`, scoped to one kitchen). Allowed steps:
  confirmed → preparing → ready via `order_kitchen_update` (**local only**, `20261105120000_v1_order_workflow.sql`).
  Kitchen staff read the workflow orders of their kitchen (policy `orders_kitchen_staff_read`).
- Client call exists: `kitchenUpdate()` in `src/services/orderWorkflowApi.ts`. **No kitchen screen exists** (app groups:
  `app/(app)`, `app/(driver)`, `app/(admin)`, `app/(collaborator)`). Admins cannot perform kitchen steps, so orders
  stop at `confirmed` today (gap G1).
- Not decided / not built: kitchen acceptance or rejection (G2), capacity, opening hours, pausing a kitchen (G7),
  reduced kitchen view without address/phone (#31). Only `kitchens.is_active` exists.

## Use when
Building the kitchen queue or screens, changing kitchen permissions, handling "the kitchen cannot prepare this".

## Boundaries
- The kitchen does not confirm, cancel, assign drivers or touch payment (cashier/admin do). A kitchen rejection or
  "out of stock" step is a business decision first (`loption-business-logic`), then a lifecycle change owned by
  `loption-order-operations`.
- Read and write only through RLS and the workflow functions; never update `orders` directly.

## Implementation workflow (for the kitchen screen when requested)
1. Route group for kitchen staff (route gate: `src/navigation/routeDecision.ts`, authority from `staff_roles`).
2. Queue: workflow orders of the staff's kitchen with status confirmed/preparing/ready, oldest first; lines and
   choices from `order_items` (`options`, `notes`); refetch after each action; Realtime best effort.
3. Actions: "Commencer la préparation" (preparing), "Prêt" (ready) via `kitchenUpdate`; show server refusals.
4. Loading, empty, error states; large touch targets (kitchen tablet/phone); French copy.

## Required tests
SQL: kitchen staff of kitchen A can move A's orders confirmed→preparing→ready, not B's, not other steps
(`run_v1_order_workflow.sh` already covers the server side). Jest: the queue shows only the kitchen's orders and only
the allowed button per status; refusal messages shown. e2e once the screen exists.

## Completion report
Steps exposed, permission checks proven, gaps G1/G2/G7 status, tests with counts, owner questions raised.
