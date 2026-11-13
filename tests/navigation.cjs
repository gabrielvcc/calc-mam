const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { mockFirebase } = require('./auth-fixtures.cjs');

const base = process.env.CALC_BASE_URL || 'http://127.0.0.1:5500';
const frame = (page) => page.evaluate(() => new Promise(requestAnimationFrame));

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const auth = await mockFirebase(page, { initialUser: 'owner' });
    let documents = 0;
    let configurations = 0;
    let profiles = 0;
    let templates = 0;
    let calculations = 0;
    let startProfile;
    let releaseProfile;
    let startTemplate;
    let releaseTemplate;
    const profileStarted = new Promise((resolve) => { startProfile = resolve; });
    const profileGate = new Promise((resolve) => { releaseProfile = resolve; });
    const templateStarted = new Promise((resolve) => { startTemplate = resolve; });
    const templateGate = new Promise((resolve) => { releaseTemplate = resolve; });
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => { if (request.resourceType() === 'document') documents += 1; });
    await page.route('**/calculator.html', async (route) => {
      templates += 1;
      startTemplate();
      await templateGate;
      await route.continue();
    });
    await page.route('https://api.calculoperfil.gabrielvc.com.br/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/auth/config') configurations += 1;
      if (path === '/auth/me') {
        profiles += 1;
        if (profiles === 1) { startProfile(); await profileGate; }
      }
      if (await auth.handle(route)) return;
      calculations += 1;
      await route.fulfill({ json: { pressao_ensaio: 1350, wx: 8123, jx: 234567 } });
    });

    await page.goto(base);
    await profileStarted;
    assert.equal(await page.locator('#checkingAccessSection').isVisible(), true);
    assert.equal(await page.locator('#checkingAccessSection h1').count(), 0);
    assert.equal(await page.locator('#loginSection').isVisible(), false);
    await page.screenshot({ path: 'tests/artifacts/access-check-desktop.png', fullPage: true });
    releaseProfile();
    await page.waitForSelector('#portalSection:not([hidden])');
    await page.evaluate(() => { window.__navigationInstance = 'persistent-page'; });

    await page.locator('#portalApps a[href="/calculo-completo/"]').click();
    await templateStarted;
    assert.equal(await page.locator('#portalSection').isVisible(), true);
    assert.equal(await page.locator('#checkingAccessSection').isVisible(), false);
    await page.locator('#adminLink').click();
    await page.waitForSelector('#adminSection:not([hidden])');
    await page.locator('#grantEmail').fill('draft@example.com');
    const templateResponse = page.waitForResponse((response) => response.url().endsWith('/calculator.html'));
    releaseTemplate();
    await templateResponse;
    await page.waitForSelector('#calculatorForm', { state: 'attached' });
    assert.equal(await page.locator('#adminSection').isVisible(), true);
    assert.equal(await page.locator('#calculatorView').isVisible(), false);

    await page.locator('#adminSection a[href="/"]').click();
    await page.locator('#portalApps a[href="/resistencia-perfis/"]').click();
    await page.waitForSelector('body[data-tool="profiles"]');
    await page.locator('#manualPressaoInput').fill('1350');
    await page.locator('#frameWidthInput').fill('2400');
    await page.locator('#frameHeightInput').fill('2100');
    await page.locator('#frameLeavesInput').fill('2');
    await page.locator('#calculateBtn').click();
    await page.waitForFunction(() => !document.querySelector('#calculateBtn').disabled);
    const metrics = await page.locator('#results dl').innerText();
    await page.evaluate(() => { window.__navigationForm = document.querySelector('#calculatorForm'); });

    await page.locator('#top-bar .account-actions a[href="/"]').click();
    await page.waitForSelector('#portalSection:not([hidden])');
    await page.locator('#adminLink').click();
    await page.waitForSelector('#adminSection:not([hidden])');
    assert.equal(await page.locator('#grantEmail').inputValue(), 'draft@example.com');
    await page.goBack();
    assert.equal(await page.locator('#portalSection').isVisible(), true);
    await page.goForward();
    assert.equal(await page.locator('#adminSection').isVisible(), true);
    assert.equal(await page.locator('#grantEmail').inputValue(), 'draft@example.com');
    await page.goBack();
    await page.locator('#portalApps a[href="/resistencia-perfis/"]').click();
    await page.waitForSelector('body[data-tool="profiles"]');
    assert.equal(await page.locator('#frameWidthInput').inputValue(), '2400');
    assert.equal(await page.locator('#results dl').innerText(), metrics);
    assert.equal(await page.evaluate(() => window.__navigationForm === document.querySelector('#calculatorForm')), true);
    assert.equal(await page.locator('#manualTab').getAttribute('aria-selected'), 'true');

    await page.locator('.app-navigation [data-tool="glass"]').click();
    await page.waitForSelector('body[data-tool="glass"]');
    await page.goBack();
    await page.waitForSelector('body[data-tool="profiles"]');
    await page.goForward();
    await page.waitForSelector('body[data-tool="glass"]');
    await page.goBack();
    await page.waitForSelector('body[data-tool="profiles"]');
    assert.equal(await page.locator('#frameWidthInput').inputValue(), '2400');
    assert.equal(await page.locator('#checkingAccessSection').isVisible(), false);
    assert.equal(documents, 1);
    assert.equal(configurations, 1);
    assert.equal(profiles, 1);
    assert.equal(templates, 1);
    assert.equal(calculations, 1);
    assert.equal(await page.evaluate(() => window.__navigationInstance), 'persistent-page');

    auth.profiles.owner.apps.glass = false;
    const updatedProfile = page.waitForResponse((response) => response.url().endsWith('/auth/me'));
    await page.evaluate(() => { const now = Date.now; Date.now = () => now() + 61000; window.dispatchEvent(new Event('focus')); });
    await updatedProfile;
    await page.waitForFunction(() => document.querySelector('.app-navigation [data-tool="glass"]').hidden);
    assert.equal(await page.locator('#frameWidthInput').inputValue(), '2400');
    await page.locator('#top-bar .brand').click();
    await page.waitForSelector('#portalSection:not([hidden])');
    assert.equal(await page.locator('#portalApps a[href="/espessura-vidro/"]').count(), 0);
    await page.evaluate(() => {
      const link = document.createElement('a');
      link.id = 'testForbiddenRoute'; link.href = '/espessura-vidro/'; link.textContent = 'Vidro';
      document.querySelector('#portalSection').append(link);
    });
    await page.locator('#testForbiddenRoute').click();
    await page.waitForSelector('#deniedSection:not([hidden])');
    assert.equal(await page.locator('#calculatorForm').isVisible(), false);
    assert.equal(await page.locator('#checkingAccessSection').isVisible(), false);
    await page.goBack();
    await page.locator('#portalApps a[href="/resistencia-perfis/"]').click();
    await page.waitForSelector('body[data-tool="profiles"]');

    await page.locator('[data-dialog="standardsDialog"]').click();
    auth.profiles.owner.apps.profiles = false;
    const revoked = page.waitForResponse((response) => response.url().endsWith('/auth/me'));
    await page.evaluate(() => { const now = Date.now; Date.now = () => now() + 61000; window.dispatchEvent(new Event('focus')); });
    await revoked;
    await page.waitForSelector('#deniedSection:not([hidden])');
    assert.equal(await page.locator('#calculatorForm').isVisible(), false);
    assert.equal(await page.locator('dialog[open]').count(), 0);
    auth.profiles.owner.apps.profiles = true;
    const restored = page.waitForResponse((response) => response.url().endsWith('/auth/me'));
    await page.evaluate(() => { const now = Date.now; Date.now = () => now() + 61000; window.dispatchEvent(new Event('focus')); });
    await restored;
    await page.waitForSelector('body[data-tool="profiles"]');
    assert.equal(await page.locator('#frameWidthInput').inputValue(), '2400');

    await page.screenshot({ path: 'tests/artifacts/navigation-desktop.png', fullPage: true });
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
      await frame(page);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    }
    await page.screenshot({ path: 'tests/artifacts/navigation-mobile.png', fullPage: true });
    assert.equal(documents, 1);
    assert.deepEqual(errors, []);
    console.log('OK: one document/auth initialization, discreet startup check, portal/admin/calculator navigation, pending loads, retained forms/results, history, permission changes and responsive layout. Firebase/API mocked.');
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
