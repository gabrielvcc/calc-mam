const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { mockFirebase } = require('./auth-fixtures.cjs');

const base = process.env.CALC_BASE_URL || 'http://127.0.0.1:5500';
const elapseCheck = (page) => page.evaluate(() => { const now = Date.now; Date.now = () => now() + 61000; });
const nextFrame = (page) => page.evaluate(() => new Promise(requestAnimationFrame));

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  const errors = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const login = await context.newPage();
    login.on('pageerror', (error) => errors.push(error.message));
    const loginAuth = await mockFirebase(login, { initialUser: null });
    await login.route('https://api.calculoperfil.gabrielvc.com.br/**', (route) => loginAuth.handle(route));
    await login.goto(base);
    await login.waitForFunction(() => document.querySelector('#googleLoginBtn')?.disabled === false);
    await login.locator('#googleLoginBtn').click();
    await login.waitForSelector('#portalSection:not([hidden])');

    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    const auth = await mockFirebase(page, { initialUser: null });
    let mode = 'normal';
    let profileRequests = 0;
    let resultsVersion = 0;
    let allowInitial;
    let initialStarted;
    const initialGate = new Promise((resolve) => { allowInitial = resolve; });
    const initialRequest = new Promise((resolve) => { initialStarted = resolve; });
    let allowCalculation;
    let calculationStarted;
    const calculationGate = new Promise((resolve) => { allowCalculation = resolve; });
    const pendingCalculation = new Promise((resolve) => { calculationStarted = resolve; });
    await page.route('https://api.calculoperfil.gabrielvc.com.br/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/auth/me') {
        profileRequests += 1;
        if (profileRequests === 1) { initialStarted(); await initialGate; }
        if (mode === 'unavailable') return route.fulfill({ status: 503, json: { error: 'Indisponibilidade temporária.' } });
        if (mode === 'offline') return route.abort('failed');
        if (mode === 'expired') {
          mode = 'normal';
          return route.fulfill({ status: 401, json: { error: 'Token expirado.' } });
        }
      }
      if (await auth.handle(route)) return;
      const payload = route.request().postDataJSON();
      if (payload.pressao_personalizada === 2000) { calculationStarted(); await calculationGate; }
      resultsVersion += 1;
      await route.fulfill({ json: { pressao_ensaio: payload.pressao_personalizada, wx: 8000 + resultsVersion, jx: 200000 + resultsVersion } });
    });

    await page.goto(`${base}/resistencia-perfis/?metodo=manual`);
    await initialRequest;
    assert.equal(await page.locator('#checkingAccessSection').isVisible(), true);
    assert.equal(await page.locator('#loginSection').isVisible(), false);
    allowInitial();
    await page.waitForSelector('body[data-tool="profiles"]');
    assert.equal(profileRequests, 1);
    await page.locator('#manualPressaoInput').fill('1350');
    await page.locator('#frameWidthInput').fill('2400');
    await page.locator('#frameHeightInput').fill('2100');
    await page.locator('#frameLeavesInput').fill('2');
    await page.locator('#calculateBtn').click();
    await page.waitForFunction(() => !document.querySelector('#calculateBtn').disabled);
    const oldMetrics = await page.locator('#results dl').innerText();
    await page.locator('#frameHeightInput').fill('');
    assert.equal(await page.locator('#results dl').innerText(), oldMetrics);
    assert.equal(await page.locator('#recalculationNotice').isVisible(), true);
    await page.locator('#calculateBtn').click();
    assert.equal(await page.locator('#results dl').innerText(), oldMetrics);
    await page.locator('#frameHeightInput').fill('2200');
    await page.locator('#calculateBtn').click();
    await page.waitForFunction(() => !document.querySelector('#calculateBtn').disabled);
    assert.notEqual(await page.locator('#results dl').innerText(), oldMetrics);
    assert.equal(await page.locator('#recalculationNotice').count(), 0);

    await page.locator('#manualPressaoInput').fill('2000');
    await page.locator('#calculateBtn').click();
    await pendingCalculation;
    await page.locator('#manualPressaoInput').fill('2100');
    allowCalculation();
    await page.waitForFunction(() => !document.querySelector('#calculateBtn').disabled);
    assert.match(await page.locator('#results dl').innerText(), /2\.000/);
    assert.equal(await page.locator('#recalculationNotice').isVisible(), true);
    await page.evaluate(() => { window.__formBeforeFocus = document.querySelector('#calculatorForm'); });
    for (let index = 0; index < 3; index += 1) await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    assert.equal(profileRequests, 1);

    for (const failure of ['unavailable', 'offline', 'normal', 'expired']) {
      mode = failure;
      await elapseCheck(page);
      const event = failure === 'offline'
        ? page.waitForEvent('requestfailed', (request) => request.url().endsWith('/auth/me'))
        : page.waitForResponse((response) => response.url().endsWith('/auth/me'));
      const renewed = failure === 'expired' ? page.waitForResponse((response) => response.url().endsWith('/auth/me') && response.status() === 200) : null;
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await event;
      if (renewed) await renewed;
      await nextFrame(page);
      assert.equal(await page.evaluate(() => window.__formBeforeFocus === document.querySelector('#calculatorForm')), true);
      assert.equal(await page.locator('#manualPressaoInput').inputValue(), '2100');
      assert.equal(await page.locator('#recalculationNotice').isVisible(), true);
      assert.equal(await page.locator('#loginSection').isVisible(), false);
    }
    assert.equal(await page.evaluate(() => window.__testTokenRefreshes), 1);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: 'tests/artifacts/stale-results-mobile.png', fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);

    await login.locator('#accessAccount [data-sign-out]').click();
    await login.waitForFunction(() => document.querySelector('#googleLoginBtn')?.disabled === false);
    await page.waitForSelector('#loginSection:not([hidden])');
    assert.equal(await page.locator('#calculatorForm').count(), 0);
    assert.deepEqual(errors, []);
    console.log('OK: cross-tab login/logout, no false login during restoration/focus/outages, token renewal, retained stale results and recalculation. Firebase/API mocked.');
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
