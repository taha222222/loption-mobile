# Testing the order workflow yourself (local)

Everything here runs on your machine against **local, disposable** services. Nothing talks to the hosted Supabase
project, and nothing is applied to it. Checkout stays closed in the app, so demo orders are created by the script.

## Prerequisites
Docker (running), `psql`, Node 20+, Python 3, and `npm ci` done in the repository. Playwright's Chromium is needed only
for the scripted walkthrough (`npx playwright install chromium` if it is not installed).

## 1. Start the demo (click through it yourself)
```bash
bash supabase/tests/e2e/run_workflow_demo.sh
```
About 3–6 minutes the first time (images, migrations, web build). When it prints `DEMO READY`, open
**http://127.0.0.1:8765**. It keeps running until **Ctrl+C**, which deletes everything.

Password for every account: `Demo-1234!` — use one private window (or browser profile) per role.

| Role | E-mail | Lands on | What to do |
|---|---|---|---|
| Cashier | `caisse@demo.loption.test` | Caisse (`/cashier`) | Open an order: lines, choices, note, verified phone, address, server total, « à encaisser à la livraison ». « Confirmer la commande », or write a reason and « Annuler la commande ». |
| Kitchen | `cuisine@demo.loption.test` | Cuisine (`/kitchen`) | « À préparer » → « Commencer la préparation »; « En préparation » → « Commande prête ». No phone, address or prices shown. |
| Admin | `admin@demo.loption.test` | Admin → **Orders** tab | Open the ready order → tap « Livreur Démo (online) » to assign. After delivery: « RECORD CASH PAID » (or NOT PAID). « CASHIER QUEUE » opens the cashier screens. |
| Driver | `livreur@demo.loption.test` | Driver dashboard | « PICK UP » on the assigned order → « Picked Up Order » → « Start Delivery » → « Mark as Delivered ». |
| Customer | `client@demo.loption.test` | Home (first time: « Continuer sans notifications ») | **Commandes** tab: each order with its status in French; open one to follow its timeline. |

Suggested run: cashier confirms LO-DEMO-001 and cancels LO-DEMO-002 → kitchen prepares and readies LO-DEMO-001 →
admin assigns the driver → driver delivers → admin records the cash → customer sees « Livrée » and « Annulée ».

Things worth trying: double-tap a button (one change only); cancel without a reason (refused); open `/kitchen` as the
cashier or `/cashier` as the customer (sent back); cancel from the cashier while the kitchen has the order open (the
kitchen is told and the order leaves its board).

More pending orders while it runs (the database port is printed at start):
```bash
PGPASSWORD=postgres psql -h 127.0.0.1 -p <db port> -U postgres -c "select demo.new_order()"
```
Live updates are not part of this local stack (no Realtime service): screens update after each action, on
« Actualiser » / pull-to-refresh and when you come back to them.

Options: `DEMO_PORT=9000` (another port), `DEMO_ORDERS=10` (more orders at start).

## 2. Scripted walkthrough (same flow, automated, against the running demo)
In a second terminal while the demo runs:
```bash
node supabase/tests/e2e/demo_walkthrough.js http://127.0.0.1:8765 <db port> ./walkthrough-screens
```
It drives every role in Chromium, checks the database after each step and saves screenshots.

## 3. Automated checks (no clicking)
```bash
npm run check
```
```bash
bash supabase/tests/run_v1_cashier_orders.sh
```
```bash
bash supabase/tests/run_v1_kitchen_orders.sh
```
```bash
bash supabase/tests/run_v1_order_lifecycle.sh
```
```bash
bash supabase/tests/e2e/run_app_e2e.sh
```

## What this does not cover
Hosted Supabase (none of the order migrations from `20261104…` on are applied there), real phones and tablets, push
notifications, Realtime, real WhatsApp codes, and placing an order from the customer app (checkout is closed).
