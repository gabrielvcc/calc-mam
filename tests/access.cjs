const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { mockFirebase } = require('./auth-fixtures.cjs');

const base = process.env.CALC_BASE_URL || 'http://127.0.0.1:5500';

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  const errors = [];
  const calculations = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on('pageerror', (error) => errors.push(error.message));
    const auth = await mockFirebase(page, { initialUser: null });
    await page.route('https://api.calculoperfil.gabrielvc.com.br/**', async (route) => {
      if (await auth.handle(route)) return;
      calculations.push(route.request().headers());
      await route.fulfill({ json: { pressao_ensaio: 1350 } });
    });
    await page.goto(base);
    await page.waitForFunction(() => document.querySelector('#googleLoginBtn')?.disabled === false);
    assert.equal(await page.locator('#calculatorForm').count(), 0);
    await page.screenshot({ path: 'tests/artifacts/login-desktop.png', fullPage: true });
    await page.locator('#loginSection [data-request-access]').click();
    assert.equal(await page.locator('#requestAccessDialog').isVisible(), true);
    assert.equal(await page.locator('#requestAccessDialog [data-contact-email]').getAttribute('href'), 'mailto:eng@gabrielvc.com.br');
    await page.locator('#closeRequestBtn').click();

    await page.evaluate(() => { window.__testLoginAs = 'blocked'; });
    await page.locator('#googleLoginBtn').click();
    await page.waitForSelector('#deniedSection:not([hidden])');
    assert.match(await page.locator('#deniedTitle').innerText(), /lista de acesso/);
    assert.equal(await page.locator('#calculatorForm').count(), 0);
    await page.locator('#deniedSection [data-request-access]').click();
    assert.equal(await page.locator('#requestEmail').inputValue(), 'blocked@example.com');
    await page.locator('#closeRequestBtn').click();
    await page.locator('#deniedSection [data-sign-out]').click();
    await page.waitForFunction(() => document.querySelector('#googleLoginBtn')?.disabled === false);

    await page.evaluate(() => { window.__testLoginAs = 'limited'; });
    await page.locator('#googleLoginBtn').click();
    await page.waitForSelector('#portalSection:not([hidden])');
    assert.equal(await page.locator('#portalApps a[href="/espessura-vidro/"]').count(), 0);
    assert.equal(await page.locator('#adminLink').isVisible(), false);
    await page.locator('#portalApps a[href="/calculo-completo/"]').click();
    await page.waitForSelector('#calculatorForm');
    assert.equal(await page.locator('#glassSection').isVisible(), false);
    assert.equal(await page.locator('.app-navigation [data-tool="glass"]').isVisible(), false);
    await page.locator('#manualTab').click();
    await page.locator('#manualPressaoInput').fill('1350');
    await page.locator('#calculateBtn').click();
    await page.waitForFunction(() => !document.querySelector('#calculateBtn').disabled);
    assert.equal(calculations.at(-1).authorization, 'Bearer test-limited');
    assert.equal(calculations.at(-1)['x-calculator-app'], 'complete');

    await page.goto(`${base}/espessura-vidro/`);
    await page.waitForSelector('#deniedSection:not([hidden])');
    assert.match(await page.locator('#deniedTitle').innerText(), /não liberada/);
    assert.equal(await page.locator('#calculatorForm').count(), 0);
    await page.goto(`${base}/administracao/`);
    await page.waitForSelector('#deniedSection:not([hidden])');
    assert.equal(await page.locator('#adminSection').isVisible(), false);

    await page.goto(`${base}/resistencia-perfis/?metodo=manual`);
    await page.waitForSelector('body[data-tool="profiles"]');
    auth.profiles.limited = null;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForSelector('#deniedSection:not([hidden])');
    assert.equal(await page.locator('#calculatorForm').count(), 0);

    const owner = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    owner.on('pageerror', (error) => errors.push(error.message));
    const ownerAuth = await mockFirebase(owner, { initialUser: 'owner' });
    await owner.route('https://api.calculoperfil.gabrielvc.com.br/**', async (route) => {
      assert.equal(await ownerAuth.handle(route), true);
    });
    await owner.goto(base);
    await owner.locator('#adminLink').click();
    await owner.waitForSelector('#adminSection:not([hidden])');
    await owner.locator('#grantEmail').fill('guest@example.com');
    const refreshResponse = owner.waitForResponse((response) => response.url().endsWith('/auth/me'));
    await owner.evaluate(() => window.dispatchEvent(new Event('focus')));
    await refreshResponse;
    assert.equal(await owner.locator('#grantEmail').inputValue(), 'guest@example.com');
    await owner.locator('[name="grantApp"][value="complete"]').check();
    await owner.locator('[name="grantApp"][value="profiles"]').check();
    await owner.locator('[name="grantApp"][value="wind"]').check();
    await owner.locator('#saveGrantBtn').click();
    await owner.waitForFunction(() => document.querySelector('#grantsList').textContent.includes('guest@example.com'));
    assert.equal(ownerAuth.grants[0].apps.glass, false);
    await owner.locator('#grantsList button', { hasText: 'Desativar' }).click();
    await owner.waitForFunction(() => document.querySelector('#grantsList').textContent.includes('Desativado'));
    assert.equal(ownerAuth.grants[0].active, false);
    await owner.screenshot({ path: 'tests/artifacts/access-admin-desktop.png', fullPage: true });

    const unconfigured = await browser.newPage();
    const missing = await mockFirebase(unconfigured, { initialUser: null, configured: false });
    await unconfigured.route('https://api.calculoperfil.gabrielvc.com.br/**', (route) => missing.handle(route));
    await unconfigured.goto(base);
    await unconfigured.waitForSelector('#loginError:not([hidden])');
    assert.equal(await unconfigured.locator('#googleLoginBtn').isDisabled(), true);
    assert.equal(await unconfigured.locator('#calculatorForm').count(), 0);

    for (const target of [page, owner, unconfigured]) {
      for (const width of [1440, 768, 390, 320]) {
        await target.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
        assert.equal(await target.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      }
    }
    await page.screenshot({ path: 'tests/artifacts/access-denied-mobile.png', fullPage: true });
    await owner.screenshot({ path: 'tests/artifacts/access-admin-mobile.png', fullPage: true });
    assert.deepEqual(errors, []);
    console.log('OK: public login, request, whitelist denial, scoped apps, blocked direct routes, revocation, admin editor, fail-closed configuration and responsive layout. Firebase/API mocked.');
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
