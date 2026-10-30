// Customer journey against a database WITHOUT the V1 migrations (the
// staging baseline, as a hosted project has it before the V1 rollout):
// sign up, verify the e-mail, onboarding, setup, home, Suivi. The app must
// stay usable and say honestly what is unavailable: no endless loading,
// no "check your connection" for a feature the server does not have yet,
// no "complete your profile" for a profile that is complete.
// Run by run_app_e2e.sh with E2E_SCHEMA=baseline.
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
  failures++;
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
  for (const f of fs.readdirSync(MAIL).sort().reverse()) {
    const raw = fs.readFileSync(path.join(MAIL, f), 'utf8');
    if (!raw.toLowerCase().includes(to.toLowerCase())) continue;
    const decoded = raw.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
    const m = decoded.match(/href="([^"]+verify[^"]+)"/);
    if (m) return m[1].replace(/&amp;/g, '&');
  }
  return null;
}
const waitForText = (page, text, timeout = 15000) => page.getByText(text, { exact: false }).first().waitFor({ timeout });

let current = null;
let sink = null;
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Africa/Casablanca' });
  const page = await ctx.newPage();
  current = page;
  const pageErrors = [];
  const failedRequests = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('response', (r) => {
    if (r.status() >= 400 && r.url().includes('/rest/v1/')) failedRequests.push(`${r.status()} ${r.request().method()} ${r.url().split('/rest/v1/')[1].split('?')[0]}`);
  });
  const shot = (name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });
  const email = `baseline+${Date.now()}@loption.test`;
  const password = 'Secret1234';

  sink = spawn('python3', ['-I', SINK, SMTP_PORT, MAIL], { stdio: 'ignore' });
  await sleep(1000);

  // ------------------------------------------------------------ sign up
  await page.goto(WEB + '/');
  await waitForText(page, 'Bienvenue chez L’OPTION');
  await page.getByText('S’inscrire avec un e-mail').click();
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  await page.getByLabel('Mot de passe', { exact: true }).fill(password);
  await page.getByLabel('Confirmer le mot de passe', { exact: true }).fill(password);
  await page.getByText('Créer mon compte').click();
  await waitForText(page, 'Vérifiez votre e-mail');
  let link = null;
  for (let i = 0; i < 20 && !link; i++) {
    await sleep(500);
    link = lastMailLink(email);
  }
  check(!!link, 'account created; verification e-mail received');
  await page.goto(link);
  await waitForText(page, 'Votre profil nutritionnel', 20000);
  const userId = sql(`select id from auth.users where email = '${email}'`);
  pass('verification link signs in and opens onboarding');

  // --------------------------------------------------------- onboarding
  await page.getByText('Homme', { exact: true }).click();
  await page.getByText('Continuer', { exact: true }).click();
  await page.getByLabel('Âge', { exact: true }).fill('30');
  await page.getByText('Continuer', { exact: true }).click();
  await page.getByLabel('Poids', { exact: true }).fill('70');
  await page.getByText('Continuer', { exact: true }).click();
  await page.getByLabel('Taille', { exact: true }).fill('175');
  await page.getByText('Continuer', { exact: true }).click();
  await page.getByText('Modérément actif', { exact: true }).click();
  await page.getByText('Calculer mon estimation').click();
  await page.waitForTimeout(2500);
  await shot('b1-onboarding-result');
  const profile = sql(`select concat_ws(',', gender, age, weight, height, activity_level) from public.user_profiles where user_id = '${userId}'`);
  check(profile === 'man,30,70,175,moderate', `onboarding answers saved in the profile (${profile})`);
  const continueBtn = page.getByText('Continuer', { exact: true });
  if (await continueBtn.count()) await continueBtn.first().click();
  await page.waitForTimeout(2500);

  // -------------------------------------------------------------- setup
  if ((await page.getByText('Continuer sans notifications').count()) > 0) await page.getByText('Continuer sans notifications').click();
  await page.waitForTimeout(1500);
  if ((await page.getByText('Saisir mon adresse').count()) > 0) {
    await page.getByText('Saisir mon adresse').click();
    await page.getByLabel('Adresse', { exact: true }).fill('12 Rue Exemple, Maarif, Casablanca');
    await page.getByText('Enregistrer l’adresse').click();
    await page.waitForTimeout(2000);
    if ((await page.getByText('Plus tard', { exact: true }).count()) > 0 && new URL(page.url()).pathname === '/setup') {
      console.log(`  info: address step: ${(await page.innerText('body')).match(/Le serveur[^\n]*/)?.[0] ?? 'saved'}`);
      await page.getByText('Plus tard', { exact: true }).click();
    }
  }
  await page.waitForTimeout(3000);
  await shot('b2-after-setup');
  console.log(`  info: landed on ${new URL(page.url()).pathname}`);

  // --------------------------------------------------------------- home
  await page.goto(WEB + '/');
  await page.waitForTimeout(5000);
  await shot('b3-home');
  const card = page.getByTestId('calorie-today-card');
  const cardLabel = (await card.count()) ? await card.getAttribute('aria-label') : '(no card)';
  const cardText = (await card.count()) ? await card.innerText() : '';
  console.log(`  info: home card: ${cardLabel} | ${cardText.replace(/\s+/g, ' ')}`);
  check(!/…|…/.test(cardText), 'home: the calorie card is not stuck loading ("…")');

  // -------------------------------------------------------------- Suivi
  await page.getByRole('tab', { name: 'Suivi', exact: true }).click();
  await page.waitForTimeout(5000);
  await shot('b4-suivi');
  const body = await page.innerText('body');
  console.log(`  info: Suivi shows: ${body.slice(0, 400).replace(/\s+/g, ' ')}`);
  check(!/Vérifiez votre connexion/.test(body), 'Suivi: no "check your connection" when the server simply lacks the feature');
  check(!/complétez votre profil|Compléter mon profil/i.test(body), 'Suivi: does not ask to complete a profile that is complete');

  console.log(`  info: failed REST calls: ${[...new Set(failedRequests)].join(', ') || 'none'}`);
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
