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
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
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
  const REST = 'http://127.0.0.1:54321/rest/v1';
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

  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
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

  // ---------------------------------------------------------- other tabs
  // Other V2 customer tabs still render for the onboarded account.
  for (const [route, text] of [['/menu', null], ['/profile', 'PARAMÈTRES']]) {
    await page2.goto(WEB + route);
    await page2.waitForTimeout(2500);
    if (text) await waitForText(page2, text);
    check(new URL(page2.url()).pathname === route, `V2 tab ${route} opens for the customer`);
  }
  await shot(page2, '09-profile');

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
