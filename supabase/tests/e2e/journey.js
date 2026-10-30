// Customer journey in the app's web build against the local Auth, PostgREST
// and Postgres started by run_app_e2e.sh. Prints "  pass:"/"  FAIL:" lines
// and "JOURNEY COMPLETE" when every step ran. No mocks: every request goes
// to the real local services.
const { chromium } = require('playwright');
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const OUT = process.env.E2E_OUT;
const MAIL = process.env.E2E_MAIL;
const WEB = process.env.E2E_WEB;
const SMTP_PORT = process.env.E2E_SMTP_PORT;
const SINK = process.env.E2E_SINK;
const DB_PORT = process.env.E2E_DB_PORT;
const REST = process.env.E2E_REST;
const SERVICE_JWT = process.env.E2E_SERVICE_JWT;
const DISPATCH = process.env.E2E_DISPATCH;
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function lastMailLink(to) {
  const files = fs.readdirSync(MAIL).sort();
  for (const f of files.reverse()) {
    const raw = fs.readFileSync(path.join(MAIL, f), 'utf8');
    if (!raw.toLowerCase().includes(to.toLowerCase())) continue;
    const decoded = raw.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
    const m = decoded.match(/href="([^"]+verify[^"]+)"/);
    if (m) return m[1].replace(/&amp;/g, '&');
  }
  return null;
}

async function waitForText(page, text, timeout = 15000) {
  await page.getByText(text, { exact: false }).first().waitFor({ timeout });
}

let current = null; // page used for a screenshot if the journey aborts
let sink = null; // SMTP sink process, always stopped on exit
(async () => {
  const browser = await chromium.launch();
  const pageErrors = [];
  const newPage = async (context) => {
    const page = await context.newPage();
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    return page;
  };
  const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });
  const stamp = Date.now();
  const emailA = `noSmtp+${stamp}@loption.test`;
  const emailB = `cliente+${stamp}@loption.test`;
  const password = 'Secret1234';

  // ---------------------------------------------------------------- welcome
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Africa/Casablanca' });
  const page = await newPage(ctx);
  current = page;
  await page.goto(WEB + '/');
  await waitForText(page, 'Bienvenue chez L’OPTION');
  await page.waitForTimeout(1500);
  check((await page.getByText('Pas encore configuré').count()) === 2, 'welcome: Google and Apple shown as not configured (real Auth settings)');
  await page.getByText('Continuer avec Google').click();
  await waitForText(page, 'Google n’est pas encore configuré');
  pass('Google press explains it is not configured; no crash');
  await shot(page, '01-welcome');

  // ------------------------------------------- sign-up without e-mail delivery
  await page.getByText('S’inscrire avec un e-mail').click();
  await page.getByLabel('E-mail', { exact: true }).fill(emailA);
  await page.getByLabel('Mot de passe', { exact: true }).fill(password);
  await page.getByLabel('Confirmer le mot de passe', { exact: true }).fill(password);
  const signupNoSmtp = page.waitForResponse((r) => r.url().includes('/auth/v1/signup'));
  await page.getByText('Créer mon compte').click();
  const r1 = await signupNoSmtp;
  await waitForText(page, 'E-mail non envoyé');
  check(r1.status() >= 400 && page.url().includes('/signup'), `no SMTP: Auth answered ${r1.status()}; the app says no e-mail was sent and stays on the form`);
  await shot(page, '02-signup-no-smtp');

  // ------------------------------------------------- start the SMTP sink
  sink = spawn('python3', ['-I', SINK, SMTP_PORT, MAIL], { stdio: 'ignore' });
  await sleep(1000);

  // --------------------------------------------- sign-up with e-mail delivery
  await page.getByLabel('E-mail', { exact: true }).fill(emailB);
  const signupOk = page.waitForResponse((r) => r.url().includes('/auth/v1/signup'));
  await page.getByText('Créer mon compte').click();
  const r2 = await signupOk;
  await waitForText(page, 'Vérifiez votre e-mail');
  check(r2.status() === 200, 'sign-up accepted (200) and the verification screen is shown');
  let link = null;
  for (let i = 0; i < 20 && !link; i++) {
    await sleep(500);
    link = lastMailLink(emailB);
  }
  check(!!link, 'verification e-mail received by the SMTP sink');
  const unconfirmed = sql(`select count(*) from auth.users where email = '${emailB.toLowerCase()}' and email_confirmed_at is null`);
  check(unconfirmed === '1', 'account exists and is NOT confirmed yet');
  check(sql(`select count(*) from public.user_profiles p join auth.users u on u.id = p.user_id where u.email = '${emailB.toLowerCase()}'`) === '0',
    'no profile is created by the client before verification');
  await shot(page, '03-verify-email');

  // -------------------------------------- unverified login goes to verification
  await page.goto(WEB + '/login');
  await page.getByLabel('E-mail', { exact: true }).fill(emailB);
  await page.getByLabel('Mot de passe', { exact: true }).fill(password);
  await page.getByText('Se connecter', { exact: true }).click();
  await waitForText(page, 'Vérifiez votre e-mail');
  pass('password login before confirming → verification screen (not the app)');

  // ---------------------------------------------------- open the e-mail link
  await page.goto(link);
  await waitForText(page, 'Votre profil nutritionnel', 20000);
  check(page.url().includes('/onboarding'), 'verification link (PKCE code) signs in and opens onboarding');
  const userId = sql(`select id from auth.users where email = '${emailB.toLowerCase()}'`);
  check(sql(`select email_confirmed_at is not null from auth.users where id = '${userId}'`) === 't', 'address confirmed by Auth');
  check(sql(`select count(*) || ':' || bool_and(role = 'customer' and not is_admin) from public.user_profiles where user_id = '${userId}'`) === '1:true',
    'exactly one customer profile created on first verified sign-in');
  await shot(page, '04-onboarding-step1');

  // ------------------------------------------ onboarding with a restart midway
  await page.getByText('Continuer', { exact: true }).click();
  await waitForText(page, 'Choisissez une option pour continuer.');
  pass('Continue without a choice shows a validation message');
  await page.getByText('Femme', { exact: true }).click();
  await page.getByText('Continuer', { exact: true }).click();
  await page.getByLabel('Âge', { exact: true }).fill('8');
  await page.getByLabel('Âge', { exact: true }).blur();
  await waitForText(page, 'Saisissez une valeur entre 13 et 100 ans.');
  await page.getByLabel('Âge', { exact: true }).fill('25');
  await page.getByText('Continuer', { exact: true }).click();
  await page.getByLabel('Poids', { exact: true }).fill('60');
  await page.waitForTimeout(500);
  await page.reload(); // the app closes and reopens
  await waitForText(page, 'Étape 3 sur 5', 20000);
  check((await page.getByLabel('Poids', { exact: true }).inputValue()) === '60', 'after a reload: same step (3/5) and the typed weight restored');
  await page.getByLabel('Étape précédente').click();
  check((await page.getByLabel('Âge', { exact: true }).inputValue()) === '25', 'Back after reload: earlier answer (age) restored');
  check(sql(`select coalesce(age::text, 'null') from public.user_profiles where user_id = '${userId}'`) === 'null',
    'partial answers are not written to the server before the last step');
  await page.getByText('Continuer', { exact: true }).click();
  await page.getByText('Continuer', { exact: true }).click();
  await page.getByLabel('Taille', { exact: true }).fill('165');
  await page.getByText('Continuer', { exact: true }).click();
  await page.getByText('Sédentaire', { exact: true }).click();
  await page.getByText('Calculer mon estimation').click();
  await waitForText(page, 'Votre estimation');
  const row = sql(`select bmr_kcal || ',' || tdee_kcal || ',' || nutrition_formula || ',' || (onboarding_completed_at is null) from public.user_profiles where user_id = '${userId}'`);
  check(row === '1345,1614,mifflin_st_jeor_1990,true', `server computed BMR/TDEE from the saved answers (${row}); not yet complete`);
  check((await page.getByText(/1\s345 kcal \/ jour/).count()) === 1 && (await page.getByText(/1\s614 kcal \/ jour/).count()) === 1,
    'result screen shows the server values');
  await shot(page, '05-result');
  await page.getByText('Continuer', { exact: true }).click();

  // ------------------------------------------------------- permissions setup
  await waitForText(page, 'Restez informé de vos commandes', 20000);
  check(sql(`select onboarding_completed_at is not null from public.user_profiles where user_id = '${userId}'`) === 't',
    'onboarding completion stamped by the server');
  await shot(page, '06-notifications');
  // Web has no notification permission: the app explains and lets the customer continue.
  await page.getByText('Continuer sans notifications').click();
  await waitForText(page, 'Où livrer vos repas ?');
  await page.getByText('Saisir mon adresse').click();
  await page.getByLabel('Adresse', { exact: true }).fill('abc');
  await page.getByText('Enregistrer l’adresse').click();
  await waitForText(page, 'Saisissez une adresse de livraison complète');
  await page.getByLabel('Adresse', { exact: true }).fill('12 Rue Exemple, Maarif, Casablanca');
  await shot(page, '07-address');
  await page.getByText('Enregistrer l’adresse').click();

  // ------------------------------------------------------------------- home
  await waitForText(page, 'Livraison offerte sur votre première commande', 20000);
  pass('home screen (V2) shows the first-order free-delivery offer from the server status');
  check(sql(`select delivery_address || '|' || first_order_offer_status from public.user_profiles where user_id = '${userId}'`) ===
    '12 Rue Exemple, Maarif, Casablanca|eligible', 'manual address saved; offer status eligible (server-maintained)');
  await shot(page, '08-home');

  // ------------------------------------------------- server-side protections
  const token = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.endsWith('-auth-token'));
    return JSON.parse(localStorage.getItem(key)).access_token;
  });
  const anon = await page.evaluate(() => (window.__anon = null));
  void anon;
  const api = async (method, url, body) =>
    page.evaluate(
      async ([m, u, b, t]) => {
        const r = await fetch(u, {
          method: m,
          headers: { Authorization: `Bearer ${t}`, apikey: 'x', 'content-type': 'application/json', Prefer: 'return=representation' },
          body: b ? JSON.stringify(b) : undefined,
        });
        return { status: r.status, body: await r.text() };
      },
      [method, url, body, token]
    );
  const tamperBmr = await api('PATCH', `${REST}/user_profiles?user_id=eq.${userId}`, { bmr_kcal: 9999 });
  const tamperOffer = await api('PATCH', `${REST}/user_profiles?user_id=eq.${userId}`, { first_order_offer_status: 'eligible' });
  const tamperRole = await api('PATCH', `${REST}/user_profiles?user_id=eq.${userId}`, { role: 'admin', is_admin: true });
  const order = await api('POST', `${REST}/orders`, { order_number: 'E2E-1', total: 1, subtotal: 1, delivery_fee: 0, status: 'confirmed', payment_method: 'cash', user_id: userId });
  const promos = await api('GET', `${REST}/promotions`);
  const apply = await api('POST', `${REST}/rpc/apply_first_order_offer`, { p_order_id: '00000000-0000-0000-0000-000000000000' });
  check([tamperBmr, tamperOffer, tamperRole].every((r) => r.status >= 400), `real API refuses writing bmr/offer/role (${tamperBmr.status}/${tamperOffer.status}/${tamperRole.status})`);
  check(order.status >= 400 && sql("select count(*) from public.orders where order_number = 'E2E-1'") === '0', `checkout stays disabled: client order insert refused (${order.status})`);
  check(promos.status >= 400 && apply.status >= 400, `promotions table and apply_first_order_offer not reachable by the customer (${promos.status}/${apply.status})`);
  check(sql(`select bmr_kcal || ',' || role || ',' || is_admin from public.user_profiles where user_id = '${userId}'`) === '1345,customer,false', 'profile unchanged by the attempts');

  // ------------------------------------------------------- returning user
  await page.reload();
  await waitForText(page, 'Livraison offerte sur votre première commande', 20000);
  check(!page.url().includes('onboarding') && !page.url().includes('setup'), 'reopening the app: straight to home');

  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Africa/Casablanca' });
  const page2 = await newPage(ctx2);
  current = page2;
  await page2.goto(WEB + '/login');
  await page2.getByLabel('E-mail', { exact: true }).fill(emailB);
  await page2.getByLabel('Mot de passe', { exact: true }).fill(password);
  await page2.getByText('Se connecter', { exact: true }).click();
  await page2.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 20000 });
  await page2.waitForTimeout(2500);
  const firstScreen = new URL(page2.url()).pathname;
  check(firstScreen !== '/onboarding', `log-in on another device: onboarding NOT shown again (landed on ${firstScreen})`);
  if (firstScreen === '/setup') {
    // Permissions are per device: explained once here; the saved address skips the location step.
    await page2.getByText('Continuer sans notifications').click();
  }
  await waitForText(page2, 'Livraison offerte sur votre première commande', 20000);
  pass('another device reaches the V2 home screen');
  check(sql(`select count(*) from public.user_profiles where user_id = '${userId}'`) === '1', 'still exactly one profile');

  // ------------------------------------------------- nutrition tracking
  await page2.goto(WEB + '/nutrition');
  await waitForText(page2, 'Vos estimations', 20000);
  check((await page2.getByText('Aucun repas enregistré aujourd’hui.').count()) === 1, 'nutrition: empty day shown as "no meal logged"');
  check((await page2.getByText(/1\s614 kcal/).count()) >= 1, 'nutrition: TDEE/target from the server (1 614 kcal)');
  await shot(page2, '10-nutrition-empty');
  const todayLocal = sql("select (now() at time zone 'Africa/Casablanca')::date");
  check(sql(`select time_zone from public.user_profiles where user_id = '${userId}'`) === 'Africa/Casablanca',
    'device time zone synced to the profile');

  // log a meal through the UI
  await page2.getByText('Ajouter un repas consommé').click();
  await waitForText(page2, 'Menu L’OPTION', 20000);
  await page2.getByLabel(/^Test bowl\. 500 kcal \/ portion$/).click();
  await page2.getByText('Enregistrer', { exact: true }).click();
  await waitForText(page2, 'Test bowl', 20000);
  await page2.waitForTimeout(1000);
  const e1 = sql(`select count(*) || ':' || sum(kcal) || ':' || min(local_date) from public.nutrition_log_entries where user_id = '${userId}' and deleted_at is null`);
  check(e1 === `1:500:${todayLocal}`, `meal logged with server-side calories for the local day (${e1})`);
  check((await page2.getByLabel(/500 kilocalories consommées sur un objectif de 1614\. 1114 restantes/).count()) === 1,
    'today card: consumed 500, remaining 1 114 (real values)');
  await shot(page2, '11-nutrition-logged');

  // remove it (the web build confirms with window.confirm)
  page2.once('dialog', (d) => d.accept());
  await page2.getByLabel('Retirer Test bowl').click();
  await waitForText(page2, 'Aucun repas enregistré aujourd’hui.', 20000);
  check(sql(`select count(*) from public.nutrition_log_entries where user_id = '${userId}' and deleted_at is not null`) === '1',
    'removal keeps an audit record (deleted_at set, row kept)');

  // log again for the streak, then the API protections
  await page2.getByText('Ajouter un repas consommé').click();
  await waitForText(page2, 'Menu L’OPTION', 20000);
  await page2.getByLabel(/^Test bowl\. 500 kcal \/ portion$/).click();
  await page2.getByText('Enregistrer', { exact: true }).click();
  await waitForText(page2, '1 jour d’affilée', 20000);
  pass('streak: 1 day after logging today (server-computed)');
  const token2 = await page2.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.endsWith('-auth-token'));
    return JSON.parse(localStorage.getItem(key)).access_token;
  });
  const call = (method, url, body) =>
    page2.evaluate(async ([m, u, b, t]) => {
      const r = await fetch(u, { method: m, headers: { Authorization: `Bearer ${t}`, apikey: 'x', 'content-type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: b ? JSON.stringify(b) : undefined });
      return { status: r.status, body: await r.text() };
    }, [method, url, body, token2]);
  const req = '7a1b2c3d-0000-4000-8000-00000000e2e1';
  const entryBody = { client_request_id: req, local_date: todayLocal, time_zone: 'Africa/Casablanca', meal_id: '00000000-0000-0000-0000-00000000aa01', servings: 1 };
  const retry1 = await call('POST', `${REST}/nutrition_log_entries?on_conflict=user_id,client_request_id`, entryBody);
  const retry2 = await call('POST', `${REST}/nutrition_log_entries?on_conflict=user_id,client_request_id`, entryBody);
  check(retry1.status < 300 && retry2.status < 300 && sql(`select count(*) from public.nutrition_log_entries where client_request_id = '${req}'`) === '1',
    `API retry with the same idempotency key creates one entry (${retry1.status}/${retry2.status})`);
  const forged = await call('POST', `${REST}/nutrition_log_entries`, { ...entryBody, client_request_id: '7a1b2c3d-0000-4000-8000-00000000e2e2', kcal: 1 });
  const other = await call('GET', `${REST}/nutrition_log_entries?user_id=neq.${userId}&select=id`);
  const deliveries = await call('GET', `${REST}/notification_deliveries?select=id`);
  check(forged.status >= 400 && other.body === '[]' && deliveries.status >= 400,
    `API refuses client calorie values (${forged.status}), hides other users' entries, and the outbox (${deliveries.status})`);
  await call('DELETE', `${REST}/nutrition_log_entries?client_request_id=eq.${req}`);
  check(sql(`select count(*) from public.nutrition_log_entries where client_request_id = '${req}' and deleted_at is null`) === '1',
    'API cannot hard-delete entries');

  // reminders: opt in through the UI
  await page2.goto(WEB + '/nutrition-reminders');
  await waitForText(page2, 'Recevoir des rappels de suivi', 20000);
  await page2.getByLabel('Recevoir des rappels de suivi').click();
  await page2.getByText('Enregistrer', { exact: true }).click();
  await waitForText(page2, 'Préférences enregistrées', 20000);
  check(sql(`select reminders_enabled || ':' || daily_target_enabled || ':' || daily_time || ':' || time_zone from public.notification_preferences where user_id = '${userId}'`)
    === 'true:true:12:00:00:Africa/Casablanca', 'reminder opt-in saved with local time zone and the proposed default time');
  await shot(page2, '12-reminders');

  // a device token through the real RPC (web has no push token), then the dispatcher
  const reg = await call('POST', `${REST}/rpc/register_push_token`, { p_token: 'ExponentPushToken[e2e-device-000001]', p_device_type: 'ios' });
  check(reg.status < 300, `register_push_token as the customer (${reg.status})`);
  const noon = sql(`select to_char(((now() at time zone 'Africa/Casablanca')::date + time '12:30') at time zone 'Africa/Casablanca' at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`);
  const runDispatch = (nowIso, mode) => {
    const out = path.join(OUT, `push-${mode}-${Date.now()}.json`);
    const summary = JSON.parse(execFileSync('node', ['--experimental-strip-types', '--no-warnings', DISPATCH, REST, SERVICE_JWT, nowIso, mode, out]).toString().trim().split('\n').pop());
    return { summary, received: JSON.parse(fs.readFileSync(out, 'utf8')) };
  };
  const d1 = runDispatch(noon, 'ok');
  check(d1.summary.sent === 1 && d1.received.length === 1 && d1.received[0].to === 'ExponentPushToken[e2e-device-000001]'
    && d1.received[0].data && d1.received[0].data.screen === 'nutrition' && /objectif du jour/.test(d1.received[0].title),
    `12:30 local: the daily target reminder is planned and delivered to the fake push service (${JSON.stringify(d1.summary)})`);
  check(sql(`select status from public.notification_deliveries where user_id = '${userId}' and kind = 'daily_target'`) === 'sent',
    'delivery recorded as sent with its ticket');
  const d2 = runDispatch(noon, 'ok');
  check(d2.summary.planned === 0 && d2.received.length === 0, 'a second run at the same time sends nothing (idempotent)');
  sql(`update public.notification_preferences set progress_enabled = true where user_id = '${userId}'`);
  const fourPm = sql(`select to_char(((now() at time zone 'Africa/Casablanca')::date + time '16:10') at time zone 'Africa/Casablanca' at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`);
  const consumedNow = sql(`select sum(kcal) from public.nutrition_log_entries where user_id = '${userId}' and deleted_at is null and local_date = '${todayLocal}'`);
  const d3 = runDispatch(fourPm, 'unregistered');
  check(d3.received.length === 1 && d3.received[0].body.includes(`${consumedNow} kcal`)
    && sql(`select is_active from public.user_push_tokens where push_token = 'ExponentPushToken[e2e-device-000001]'`) === 'f',
    'progress reminder carries the real logged total; DeviceNotRegistered deactivates the token');
  const d4 = runDispatch(fourPm, 'ok');
  check(d4.received.length === 0, 'nothing is sent to a deactivated token');

  // ---------------------------------------------------------- other tabs
  // Other V2 customer tabs still render for the onboarded account.
  for (const [route, text] of [['/menu', null], ['/profile', 'PARAMÈTRES']]) {
    await page2.goto(WEB + route);
    await page2.waitForTimeout(2500);
    if (text) await waitForText(page2, text);
    check(new URL(page2.url()).pathname === route, `V2 tab ${route} opens for the customer`);
  }
  await shot(page2, '09-profile');

  // ------------------------------------------- daily tracking + basket
  await page2.goto(WEB + '/');
  await waitForText(page2, 'Livraison offerte sur votre première commande', 20000);
  check((await page2.getByRole('tab', { name: 'Suivi', exact: true }).count()) === 1 && (await page2.getByRole('tab', { name: 'Panier', exact: true }).count()) === 0
    && (await page2.getByRole('tab').count()) === 5,
    'tab bar: "Suivi" (Daily Tracking) replaces the "Panier" tab');
  check((await page2.getByLabel('Panier vide').count()) === 1, 'home header shows the basket');
  await page2.goto(WEB + '/menu');
  await page2.getByLabel('Ajouter au panier').first().waitFor({ timeout: 20000 });
  await page2.getByLabel('Ajouter au panier').first().click();
  await page2.getByLabel('Ajouter au panier').first().click();
  check((await page2.getByLabel('Panier, 2 articles').count()) === 1, 'menu basket shows the live item count (2)');
  await page2.getByLabel('Panier, 2 articles').click();
  await page2.waitForURL((u) => u.pathname === '/cart', { timeout: 15000 });
  await waitForText(page2, 'Panier (2)');
  pass('basket opens the cart with its items preserved');
  await shot(page2, '12-cart-from-basket');

  await page2.getByRole('tab', { name: 'Suivi', exact: true }).click();
  await page2.waitForURL((u) => u.pathname === '/tracking', { timeout: 15000 });
  await waitForText(page2, 'Mon bilan', 20000);
  pass('the Suivi tab opens Daily Tracking');
  const consumedToday = Number(sql(`select coalesce(sum(kcal), 0) from public.nutrition_log_entries where user_id = '${userId}' and deleted_at is null and local_date = '${todayLocal}'`));
  const balanceLabel = async () => (await page2.getByTestId('daily-balance-card').getAttribute('aria-label')) || '';
  await page2.waitForTimeout(1500);
  check((await balanceLabel()).includes(`Budget 1614 kilocalories, ${consumedToday} consommées, ${1614 - consumedToday} restantes`) && (await balanceLabel()).includes('Estimation habituelle (TDEE)'),
    `no activity data: budget = TDEE 1 614, consumed ${consumedToday}, remaining ${1614 - consumedToday} (${await balanceLabel()})`);
  check((await page2.getByText('Activité non disponible ici').count()) === 1, 'web: no health provider, said in words (no fake steps)');
  await shot(page2, '13-tracking-tdee');

  // A day synced from the phone (the web build cannot read HealthKit): steps and active energy.
  const syncDay = await page2.evaluate(async ([u, t, d]) => {
    const r = await fetch(u, { method: 'POST', headers: { Authorization: `Bearer ${t}`, apikey: 'x', 'content-type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ local_date: d, source: 'apple_health', time_zone: 'Africa/Casablanca', steps: 6230, distance_m: 4480, active_energy_kcal: 310, total_energy_kcal: 2400 }) });
    return r.status;
  }, [`${REST}/activity_daily_totals?on_conflict=user_id,local_date,source`, token2, todayLocal]);
  check(syncDay < 300 && sql(`select coverage || ':' || coalesce(total_energy_kcal::text, 'null') from public.activity_daily_totals where user_id = '${userId}'`) === 'partial:null',
    `activity sync stored; today is partial and its "total" energy was dropped by the server (${syncDay})`);
  const bmr = Number(sql(`select bmr_kcal from public.user_profiles where user_id = '${userId}'`));
  await page2.reload();
  await page2.getByText(/6\s230/).first().waitFor({ timeout: 20000 });
  const withActivity = await balanceLabel();
  check(withActivity.includes(`Budget ${bmr + 310} kilocalories`) && withActivity.includes(`${bmr + 310 - consumedToday} restantes`) && withActivity.includes('Métabolisme de base + activité mesurée'),
    `with measured activity: budget = BMR ${bmr} + active 310, no TDEE added (${withActivity})`);
  await shot(page2, '14-tracking-activity');

  // A gym session recorded in the app (timer; >= 1 minute): server MET estimate, budget unchanged.
  await page2.getByLabel('Démarrer : Salle de sport').click();
  await waitForText(page2, 'Démarrer · Salle de sport', 15000);
  await page2.getByText('Démarrer · Salle de sport').click();
  await waitForText(page2, 'En cours', 15000);
  await shot(page2, '16-workout-running');
  await page2.getByText('Pause', { exact: true }).click();
  await waitForText(page2, 'En pause');
  await page2.getByText('Reprendre', { exact: true }).click();
  await page2.waitForTimeout(62000);
  await page2.getByText('Terminer', { exact: true }).click();
  await waitForText(page2, 'Séance enregistrée', 20000);
  await page2.waitForTimeout(1000);
  const ws = sql(`select concat_ws(':', kind, energy_source, energy_kcal, weight_kg, active_seconds) from public.workout_sessions where user_id = '${userId}'`);
  check(/^gym:met_estimate:\d+:60(\.0)?:\d+$/.test(ws), `gym session stored with a server MET estimate (${ws || 'no row'})`);
  await page2.goto(WEB + '/tracking');
  await waitForText(page2, 'Mon bilan', 20000);
  await page2.waitForTimeout(1500);
  check((await balanceLabel()).includes(`Budget ${bmr + 310} kilocalories`), 'the workout does not change the daily budget (no double counting)');
  check((await page2.getByText(/^\d+ kcal — estimation \(MET × poids × durée\)$/).count()) >= 1, 'timeline shows the workout energy labelled as an estimate');

  // "J’ai mangé ce repas" only for a received order.
  const orderOk = sql(`with o as (insert into public.orders (order_number, total, subtotal, delivery_fee, status, payment_method, user_id) values ('E2E-1', 60, 60, 0, 'served', 'cash', '${userId}') returning id) select id from o`);
  sql(`insert into public.order_items (order_id, meal_id, meal_name, quantity, price) values ('${orderOk}', '00000000-0000-0000-0000-00000000aa01', 'Test bowl', 1, 60)`);
  const orderLate = sql(`with o as (insert into public.orders (order_number, total, subtotal, delivery_fee, status, payment_method, user_id) values ('E2E-2', 60, 60, 0, 'confirmed', 'cash', '${userId}') returning id) select id from o`);
  await page2.goto(`${WEB}/log-meal?orderId=${orderLate}`);
  await waitForText(page2, 'Commande pas encore livrée', 20000);
  pass('an order not yet delivered cannot be logged as eaten');
  await page2.goto(`${WEB}/log-meal?orderId=${orderOk}`);
  await waitForText(page2, 'Cette commande', 20000);
  await page2.getByLabel(/^Test bowl\. 500 kcal \/ portion · commandé ×1$/).click();
  await page2.getByText('Enregistrer', { exact: true }).click();
  await page2.waitForTimeout(2000);
  check(sql(`select count(*) || ':' || sum(kcal) from public.nutrition_log_entries e join public.order_items i on i.id = e.order_item_id where i.order_id = '${orderOk}'`) === '1:500',
    'delivered order: "I ate this meal" logged once with the meal record’s 500 kcal');
  await page2.goto(WEB + '/tracking');
  await waitForText(page2, 'Mon bilan', 20000);
  await page2.waitForTimeout(1500);
  check((await balanceLabel()).includes(`${consumedToday + 500} consommées, ${bmr + 310 - consumedToday - 500} restantes`),
    `consumed and remaining follow the logged meal (${await balanceLabel()})`);
  await shot(page2, '15-tracking-after-meal');
  for (const name of ['17-tracking-workouts-journal', '18-tracking-trends']) {
    await page2.mouse.move(195, 420);
    await page2.mouse.wheel(0, 650);
    await page2.waitForTimeout(700);
    await shot(page2, name);
  }

  check(pageErrors.length === 0, `no uncaught page errors${pageErrors.length ? ': ' + pageErrors.slice(0, 3).join(' | ') : ''}`);
  sink.kill();
  await browser.close();
  console.log(failures === 0 ? 'JOURNEY COMPLETE' : `JOURNEY COMPLETE WITH ${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(async (e) => {
  if (sink) sink.kill();
  console.log(`  FAIL: journey aborted: ${e.message.split('\n').slice(0, 3).join(' ')}`);
  if (current) {
    console.log(`    at ${current.url()}`);
    await current.screenshot({ path: path.join(OUT, 'aborted.png') }).catch(() => {});
  }
  process.exit(1);
});
