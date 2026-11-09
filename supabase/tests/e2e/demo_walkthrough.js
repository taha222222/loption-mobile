// Scripted walkthrough of the whole order lifecycle against the running demo
// (run_workflow_demo.sh): one order through every role, in the real app,
// checked in the database after each step.
//   cashier confirms -> kitchen starts and finishes -> admin assigns the
//   driver -> driver picks up, leaves, delivers -> admin records the cash ->
//   the customer sees « Livrée »; plus a cashier cancellation with a reason.
// Usage: node supabase/tests/e2e/demo_walkthrough.js <app url> <db port> [screens dir]
// Local demo only: it changes demo data and nothing else.
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const [WEB = 'http://127.0.0.1:8765', DB_PORT, SHOTS] = process.argv.slice(2);
const PASSWORD = 'Demo-1234!';
let failures = 0;
const pass = (m) => console.log(`  pass: ${m}`);
const fail = (m) => {
  failures += 1;
  console.log(`  FAIL: ${m}`);
};
const check = (ok, m) => (ok ? pass(m) : fail(m));
const sql = (q) =>
  execFileSync('psql', ['-h', '127.0.0.1', '-p', DB_PORT, '-U', 'postgres', '-d', 'postgres', '-XAt', '-c', q], {
    env: { ...process.env, PGPASSWORD: 'postgres' },
  })
    .toString()
    .trim();
const visible = (page, text) => page.getByText(text, { exact: true }).filter({ visible: true });

(async () => {
  if (!DB_PORT) throw new Error('usage: demo_walkthrough.js <app url> <db port> [screens dir]');
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch();
  const errors = [];
  let n = 0;
  const shot = async (page, name) => SHOTS && page.screenshot({ path: path.join(SHOTS, `${String(++n).padStart(2, '0')}-${name}.png`) });
  const login = async (email) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Africa/Casablanca' });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${email}: ${e}`));
    page.on('dialog', (d) => d.accept());
    await page.goto(WEB + '/login');
    await page.getByLabel('E-mail', { exact: true }).fill(email);
    await page.getByLabel('Mot de passe', { exact: true }).fill(PASSWORD);
    await page.getByText('Se connecter', { exact: true }).click();
    await page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 20000 });
    await page.waitForTimeout(2000);
    return page;
  };
  const num = sql(`select order_number from public.orders where status = 'pending' and order_number like 'LO-DEMO-%' order by order_number limit 1`);
  const other = sql(`select order_number from public.orders where status = 'pending' and order_number like 'LO-DEMO-%' order by order_number offset 1 limit 1`);
  const state = (o = num) => sql(`select status || '/' || payment_status from public.orders where order_number = '${o}'`);
  check(!!num && !!other, `two pending demo orders to work with (${num}, ${other})`);

  // Cashier: confirm one order, cancel another with a reason.
  const cashier = await login('caisse@demo.loption.test');
  check(new URL(cashier.url()).pathname === '/cashier', `cashier lands on /cashier (${new URL(cashier.url()).pathname})`);
  await shot(cashier, 'cashier-queue');
  await cashier.getByLabel(new RegExp(`^Commande ${num},`)).filter({ visible: true }).click();
  await cashier.getByRole('button', { name: 'Confirmer la commande' }).filter({ visible: true }).click();
  await cashier.getByText(/Commande confirmée/).first().waitFor({ timeout: 15000 });
  check(state() === 'confirmed/pending', `cashier confirmed ${num}: confirmed, payment still pending (${state()})`);
  await shot(cashier, 'cashier-confirmed');
  await cashier.getByLabel('Retour à la liste').filter({ visible: true }).click();
  await cashier.getByLabel(new RegExp(`^Commande ${other},`)).filter({ visible: true }).click();
  await cashier.getByLabel('Motif de l’annulation').filter({ visible: true }).fill('Rupture de stock');
  await cashier.getByRole('button', { name: 'Annuler la commande' }).filter({ visible: true }).click();
  await cashier.getByText(/Commande annulée/).first().waitFor({ timeout: 15000 });
  check(sql(`select status || '/' || cancel_reason from public.orders where order_number = '${other}'`) === 'cancelled/Rupture de stock',
    `cashier cancelled ${other} with the reason`);

  // Kitchen: start, then ready.
  const kitchen = await login('cuisine@demo.loption.test');
  check(new URL(kitchen.url()).pathname === '/kitchen', `kitchen lands on /kitchen (${new URL(kitchen.url()).pathname})`);
  await visible(kitchen, num).waitFor({ timeout: 15000 });
  await shot(kitchen, 'kitchen-board');
  await kitchen.getByRole('button', { name: 'Commencer la préparation' }).filter({ visible: true }).first().click();
  await kitchen.getByText(`${num} : préparation commencée.`).waitFor({ timeout: 15000 });
  check(state() === 'preparing/pending', `kitchen started ${num} (${state()})`);
  await kitchen.getByText(/^En préparation \(\d+\)$/).filter({ visible: true }).click();
  await kitchen.getByRole('button', { name: 'Commande prête' }).filter({ visible: true }).first().click();
  await kitchen.getByText(`${num} est prête pour le livreur.`).waitFor({ timeout: 15000 });
  check(state() === 'ready/pending', `kitchen marked ${num} ready (${state()})`);

  // Admin: assign the driver (the cashier screens do not assign yet).
  const admin = await login('admin@demo.loption.test');
  await admin.getByText('Orders', { exact: true }).filter({ visible: true }).last().click();
  await visible(admin, num).first().click();
  await admin.getByText('Livreur Démo (online)', { exact: true }).filter({ visible: true }).click();
  await admin.waitForTimeout(2500);
  check(sql(`select (driver_id is not null) || '/' || status from public.orders where order_number = '${num}'`) === 'true/ready',
    `admin assigned the driver to ${num}`);
  await shot(admin, 'admin-assigned');

  // Driver: pickup, on the way, delivered.
  const driver = await login('livreur@demo.loption.test');
  await visible(driver, num).first().waitFor({ timeout: 15000 });
  await shot(driver, 'driver-assigned');
  await visible(driver, 'PICK UP').first().click();
  for (const [button, expected] of [['Picked Up Order', 'picked_up'], ['Start Delivery', 'on_the_way'], ['Mark as Delivered', 'delivered']]) {
    await driver.getByText(button, { exact: true }).filter({ visible: true }).click();
    for (let i = 0; i < 20 && !state().startsWith(expected); i++) await driver.waitForTimeout(500);
    check(state() === `${expected}/pending`, `driver: ${button} → ${state()}`);
  }
  await shot(driver, 'driver-delivered');

  // Admin: record the cash after delivery.
  await admin.reload();
  await admin.waitForTimeout(2000);
  await admin.getByText('Orders', { exact: true }).filter({ visible: true }).last().click();
  await visible(admin, num).first().click();
  await admin.getByText('RECORD CASH PAID', { exact: true }).filter({ visible: true }).click();
  for (let i = 0; i < 20 && state() !== 'delivered/paid'; i++) await admin.waitForTimeout(500);
  check(state() === 'delivered/paid', `admin recorded the cash for ${num} (${state()})`);

  // Customer: sees the result.
  const customer = await login('client@demo.loption.test');
  // First sign-in on a device: the notification introduction (the saved
  // address skips the location step).
  if (new URL(customer.url()).pathname === '/setup') {
    await customer.getByText('Continuer sans notifications').click();
    await customer.waitForURL((u) => u.pathname !== '/setup', { timeout: 15000 });
  }
  // The tab, as a customer would (on the web the bare URL /orders is shared
  // by the customer, admin and partner groups).
  await customer.getByRole('tab', { name: 'Commandes' }).filter({ visible: true }).last().click();
  await customer.getByText(`#${num}`).first().waitFor({ timeout: 20000 });
  await shot(customer, 'customer-orders');
  const badge = async (o) => (await customer.getByText(`#${o}`).first().locator('xpath=../../..').innerText()).replace(/\s+/g, ' ');
  check((await badge(num)).includes('Livrée') && (await badge(other)).includes('Annulée') && (await customer.getByText(/^(pending|cancelled|delivered)$/).count()) === 0,
    `customer sees ${num} « Livrée » and ${other} « Annulée », no raw status code`);

  const steps = sql(`select string_agg(u.status, ' > ' order by u.created_at) from public.order_status_updates u join public.orders o on o.id = u.order_id where o.order_number = '${num}'`);
  const audits = sql(`select string_agg(action, ', ' order by a.occurred_at, a.id) from public.security_audit_log a where details ->> 'order_id' = (select id::text from public.orders where order_number = '${num}')`);
  console.log(`  timeline: ${steps}\n  audit:    ${audits}`);
  check(steps === 'pending > confirmed > preparing > ready > picked_up > on_the_way > delivered', 'customer timeline holds every status once, in order');
  check(errors.length === 0, `no uncaught page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
  await browser.close();
  console.log(failures === 0 ? 'WALKTHROUGH COMPLETE' : `WALKTHROUGH COMPLETE WITH ${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.log(`  FAIL: walkthrough aborted: ${e.message.split('\n').slice(0, 3).join(' ')}`);
  process.exit(1);
});
