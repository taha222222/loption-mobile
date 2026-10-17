// =====================================================================
// How public meal-images objects are actually SERVED and whether a real
// browser executes them. LOCAL only (run_phase1c.sh, scenario S), against
// the local Storage API container. Uses the pre-installed Chromium via
// Playwright; never contacts a hosted project.
//
// Usage: node browser_serving_tests.js <storage-url> <object>=<expect> ...
//   expect: executes | inert   (script execution on direct navigation)
// For every object it records the response headers (Content-Type,
// X-Content-Type-Options, Content-Disposition, Content-Security-Policy)
// and checks script execution on (1) direct navigation to the public URL
// and (2) embedding as <img>. Exit 1 if any observation differs from the
// expectation, so the documentation cannot silently drift from behaviour.
// Results describe THIS Chromium build and THIS Storage API version only;
// they are not a guarantee for other browsers or for hosted Supabase
// (which serves through a CDN that may change headers).
// =====================================================================
const { chromium } = require('playwright');

(async () => {
  const [base, ...specs] = process.argv.slice(2);
  const browser = await chromium.launch();
  let failures = 0;
  console.log(`  browser: Chromium ${browser.version()} (Playwright)`);
  for (const spec of specs) {
    const [object, expect] = spec.split('=');
    const url = `${base}/object/public/meal-images/${object}`;
    const row = { object };
    // (1) direct navigation
    let page = await browser.newPage();
    let dialog = false;
    page.on('dialog', async d => { dialog = true; await d.dismiss(); });
    const resp = await page.goto(url);
    const h = resp.headers();
    row.http = resp.status();
    row.content_type = h['content-type'] || 'absent';
    row.x_content_type_options = h['x-content-type-options'] || 'absent';
    row.content_disposition = h['content-disposition'] || 'absent';
    row.content_security_policy = h['content-security-policy'] || 'absent';
    await page.waitForTimeout(500);
    row.navigate_script_executed = dialog || (await page.title()) === 'EXECUTED';
    await page.close();
    // (2) <img> embedding on a page of the same origin
    page = await browser.newPage();
    dialog = false;
    page.on('dialog', async d => { dialog = true; await d.dismiss(); });
    await page.goto(`${base}/status`);
    await page.setContent(`<html><head><title>host</title></head><body><img id="i" src="${url}"></body></html>`);
    await page.waitForTimeout(800);
    row.img_decoded = await page.evaluate(() => { const i = document.getElementById('i'); return i.complete && i.naturalWidth > 0; });
    row.img_script_executed = dialog || (await page.title()) === 'EXECUTED';
    await page.close();
    const ok = (expect === 'executes') === row.navigate_script_executed && !row.img_script_executed;
    if (!ok) failures++;
    console.log(`  ${ok ? 'PASS' : 'FAIL'} ${object}: served ${row.content_type}, nosniff=${row.x_content_type_options}, ` +
      `navigate executes script=${row.navigate_script_executed} (expected ${expect}), <img> decoded=${row.img_decoded}, ` +
      `<img> executes script=${row.img_script_executed}`);
    console.log(`  headers ${JSON.stringify(row)}`);
  }
  await browser.close();
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
