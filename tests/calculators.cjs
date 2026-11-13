const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { mockFirebase } = require('./auth-fixtures.cjs');

const base = process.env.CALC_BASE_URL || 'http://127.0.0.1:5500';
const brandTitle = 'Resistência de Perfis de Alumínio · Pressão de Vento · Espessura Mínima de Vidro';
const completeTitle = 'Cálculo completo Resistência de Perfis de Alumínio + Pressão de Vento + Espessura Mínima de Vidro';
const requests = [];
const errors = [];

function fixture(payload, nbr) {
  const result = { pressao_ensaio: payload.pressao_personalizada || 1350 };
  if (payload.larguratotal) Object.assign(result, { wx: 31726.575, jx: 2423754.53 });
  if (payload.calcular_vidro) result.vidro = {
    tipo: 'Laminado float - 2 vidros', sistema: 'laminated', vidros: [4, 4],
    componentes: ['Vidro 4 mm', 'Vidro 4 mm'], largura_vidro: payload.largura_vidro,
    altura_vidro: payload.altura_vidro, pressao_vento: result.pressao_ensaio, pressao: 1155,
    fator_pressao_calculo: 1.5, e1: 5.87, c: 1, e3: 1, eR: 6.84, eF: 6.15,
    eF_minimo: 5.45, espessura_resistencia: 6.87, espessura_flecha: 7.08,
    alpha: 1.3101, flecha: 16.07, flecha_limite: 23.13, relacao_L_l: 1.549,
    relacao_l_L: 0.646, espessura_calculada: 7.08, espessura_requerida: 7.08,
    espessura_minima: 8, espessura_nominal: 8, fora_catalogo: false,
    catalogo: [6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30],
  };
  if (nbr) Object.assign(result, {
    regiao: '4', v0: 45, s1: 1, s2: s2Fixture(), s3: { effective: 1 }, q: 1125,
    cp: { average_cpe: -1, positive_pressure: 1000, negative_pressure: -1350,
      governing: { h_over_b: 0.9, a_over_b: 1.5, wind_angle: 0, zone: 'A1', cpe: -1, cpi: 0.2, cp: -1.2 } },
  });
  return result;
}

function s2Fixture() {
  return { class: 'A', value: 1.04, gust_factor: 1, meteorological: { bm: 1, p: 0.085 } };
}

async function checkRetainedResults(page, selectors) {
  const metrics = await page.locator('#results dl').innerText();
  const calculations = requests.length;
  await page.evaluate(() => { window.__previousResultList = document.querySelector('#results dl'); });
  for (const selector of selectors) {
    const input = page.locator(selector);
    const original = await input.inputValue();
    await input.focus();
    await input.press('End');
    await input.press('Backspace');
    assert.equal(await input.inputValue(), original.slice(0, -1));
    for (const clear of [false, true]) {
      if (clear) await input.fill('');
      assert.equal(await page.locator('#results dl').innerText(), metrics);
      assert.equal(await page.evaluate(() => document.querySelector('#results dl') === window.__previousResultList), true, 'Editing inputs must not replace the last result nodes');
      assert.equal(await page.locator('#recalculationNotice').isVisible(), true);
    }
    await input.fill(original);
  }
  assert.equal(requests.length, calculations, 'Editing inputs must not request a new calculation');
}

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on('pageerror', (error) => errors.push(error.message));
    const auth = await mockFirebase(page);
    await page.route('https://api.calculoperfil.gabrielvc.com.br/**', async (route) => {
      if (await auth.handle(route)) return;
      const path = new URL(route.request().url()).pathname;
      const payload = route.request().postDataJSON();
      requests.push({ path, payload });
      const json = path === '/regiaovento' ? { regiao: '4', v0: 45 }
        : path === '/nbr6123/s2' ? s2Fixture() : fixture(payload, path === '/nbr6123/calcular');
      await route.fulfill({ json });
    });
    await page.route('https://nominatim.openstreetmap.org/**', (route) => route.fulfill({ json: [{ lat: '-25.4284', lon: '-49.2733' }] }));

    await page.goto(`${base}/calculo-completo/?metodo=manual`);
    await page.waitForSelector('body[data-tool]');
    assert.equal(await page.locator('#top-bar .brand strong').evaluate((element) => element.firstChild.textContent), brandTitle);
    assert.equal(await page.locator('#top-bar .brand small').innerText(), 'Calculadoras');
    assert.equal(await page.locator('#top-bar .standards-button').count(), 0);
    await page.locator('#sidebar > .standards-button').click();
    await page.waitForSelector('#standardsDialog[open]');
    await page.keyboard.press('Escape');
    const ids = await page.locator('[id]').evaluateAll((elements) => elements.map((element) => element.id));
    assert.equal(new Set(ids).size, ids.length, 'Shared layout must not duplicate field IDs');
    await page.locator('#calculateBtn').click();
    assert.match(await page.locator('#calculationError').innerText(), /pressão/);
    await page.locator('#manualPressaoInput').fill('1350.125');
    await page.locator('#frameWidthInput').fill('2400');
    await page.locator('#frameHeightInput').fill('2100');
    await page.locator('#frameLeavesInput').fill('2');
    await page.locator('#includeGlassInput').check();
    await page.locator('#sameGlassInput').check();
    assert.equal(await page.locator('#glassWidthInput').inputValue(), '1200');
    await page.locator('[data-dialog="glassDialog"]').click();
    await page.locator('[data-glass-type="laminado_float_2"]').click();
    await page.locator('#calculateBtn').click();
    await page.waitForFunction(() => document.querySelector('#results').textContent.includes('31.727'));
    assert.deepEqual(await page.locator('#results dt').allTextContents(), ['Wx necessário', 'Jx necessário', 'Vidro mínimo', 'Pressão de ensaio']);
    assert.equal(requests.at(-1).payload.calcular_vidro, true);
    await checkRetainedResults(page, ['#frameWidthInput', '#frameHeightInput', '#frameLeavesInput', '#manualPressaoInput']);
    const calculatedMetrics = await page.locator('#results dl').innerText();
    await page.locator('#includeGlassInput').uncheck();
    assert.equal(await page.locator('#results dl').innerText(), calculatedMetrics);
    await page.locator('#includeGlassInput').check();
    await page.locator('[data-glass-details]').click();
    await page.waitForSelector('#glassDetailsDialog[open]');
    assert.match(await page.locator('#glassDetailsContent').innerText(), /Espessura total mínima por flecha/);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#glassDetailsDialog').isVisible(), false);

    await page.locator('.app-navigation [data-tool="glass"]').click();
    assert.match(page.url(), /espessura-vidro/);
    assert.equal(await page.locator('#frameSection').isVisible(), false);
    assert.equal(await page.locator('#sameGlassControl').isVisible(), false);
    assert.equal(await page.locator('#glassWidthInput').getAttribute('readonly'), null);
    await page.locator('#calculateBtn').click();
    await page.waitForFunction(() => !document.querySelector('#calculateBtn').disabled);
    assert.equal(requests.at(-1).payload.larguratotal, undefined);
    assert.equal(requests.at(-1).payload.liga, undefined);
    assert.equal(requests.at(-1).payload.calcular_vidro, true);
    assert.equal(await page.locator('#results dt').filter({ hasText: 'Wx' }).count(), 0);
    await checkRetainedResults(page, ['#glassWidthInput', '#glassHeightInput', '#manualPressaoInput']);
    await page.goBack();
    assert.equal(await page.locator('#toolTitle').textContent(), completeTitle);
    assert.equal(await page.locator('#frameWidthInput').inputValue(), '2400');

    await page.locator('.app-navigation [data-tool="profiles"]').click();
    assert.equal(await page.locator('#glassSection').isVisible(), false);
    await page.locator('[data-dialog="alloyDialog"]').click();
    await page.locator('[data-alloy="6063-T6"]').click();
    await page.locator('#calculateBtn').click();
    await page.waitForFunction(() => !document.querySelector('#calculateBtn').disabled);
    assert.equal(requests.at(-1).payload.calcular_vidro, undefined);
    assert.equal(requests.at(-1).payload.larguratotal, '2400');
    assert.equal(requests.at(-1).payload.liga, '6063-T6');
    await checkRetainedResults(page, ['#frameWidthInput', '#frameHeightInput', '#frameLeavesInput']);

    await page.locator('.app-navigation [data-tool="wind"]').click();
    assert.equal(await page.locator('#manualTab').isVisible(), false);
    assert.equal(await page.locator('#tabledTab').getAttribute('aria-selected'), 'true');
    await page.locator('#tabledTab').focus();
    await page.keyboard.press('End');
    assert.equal(await page.locator('#nbrTab').getAttribute('aria-selected'), 'true');
    await page.keyboard.press('Home');
    assert.equal(await page.locator('#tabledTab').getAttribute('aria-selected'), 'true');
    await page.locator('#pavimentosInput').fill('5');
    await page.locator('#addressInput').fill('Curitiba');
    await page.locator('#searchBtn').click();
    await page.waitForSelector('#mapid .leaflet-marker-icon');
    await page.locator('#calculateBtn').click();
    await page.waitForSelector('.result-next');
    assert.equal(requests.at(-1).payload.pressao_personalizada, undefined);
    assert.equal(requests.at(-1).payload.pavimentos, 5);
    await checkRetainedResults(page, ['#pavimentosInput']);
    await page.locator('.result-next [data-tool="glass"]').click();
    await page.reload();
    await page.waitForSelector('body[data-tool]');
    assert.equal(await page.locator('input[type="number"], input[type="text"]').evaluateAll((inputs) => inputs.every((input) => input.value === '')), true);
    assert.equal(await page.locator('#includeGlassInput').isChecked(), false);
    assert.equal(await page.locator('#sameGlassInput').isChecked(), false);
    assert.equal(await page.locator('[data-alloy-label]').innerText(), '6060-T5');
    assert.equal(await page.locator('[data-glass-label]').innerText(), 'Monolítico float');
    assert.equal(await page.locator('#reusePressureBtn').isVisible(), false);
    assert.equal(await page.locator('.leaflet-marker-icon').count(), 0);
    assert.match(await page.locator('#results').innerText(), /Aguardando cálculo/);
    await page.locator('#manualTab').click();
    await page.locator('#manualPressaoInput').fill('1350');
    await page.locator('#glassWidthInput').fill('1200');
    await page.locator('#glassHeightInput').fill('2100');
    await page.locator('#calculateBtn').click();
    await page.waitForFunction(() => !document.querySelector('#calculateBtn').disabled);
    await page.locator('#manualPressaoInput').fill('');
    await page.locator('#reusePressureBtn').click();
    assert.equal(await page.locator('#manualPressaoInput').inputValue(), '1350');

    await page.locator('.app-navigation [data-tool="wind"]').click();
    await page.locator('[data-method="tabled"]').click();
    await page.locator('#pavimentosInput').fill('5');
    await page.locator('#addressInput').fill('Curitiba');
    await page.locator('#searchBtn').click();
    await page.waitForSelector('#mapid .leaflet-marker-icon');
    await page.locator('#calculateBtn').click();
    await page.waitForSelector('.result-next');
    assert.equal(requests.at(-1).payload.pavimentos, 5);
    await page.locator('[data-method="nbr"]').click();
    await page.waitForFunction(() => document.querySelector('#nbrV0Input').value === '45');
    await page.locator('[data-dialog="s1Dialog"]').click();
    await page.locator('input[name="nbrS1"][value="1.0"]').check();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('input[name="nbrS1"][value="1.0"]').isChecked(), false);
    await page.locator('[data-dialog="s1Dialog"]').click();
    await page.locator('input[name="nbrS1"][value="1.0"]').check();
    await page.locator('[data-apply-factor="s1Dialog"]').click();
    await page.locator('[data-dialog="s2Dialog"]').click();
    await page.locator('input[name="nbrS2"][value="categoria2"]').check();
    await page.locator('#nbrBuildingWidthInput').fill('30');
    await page.locator('#nbrBuildingLengthInput').fill('20');
    await page.locator('#nbrBuildingHeightInput').fill('18');
    await page.locator('[data-apply-factor="s2Dialog"]').click();
    await page.locator('[data-dialog="s3Dialog"]').click();
    await page.locator('input[name="nbrS3"][value="1.00"]').check();
    await page.locator('[data-apply-factor="s3Dialog"]').click();
    await page.locator('#calculateBtn').click();
    await page.waitForSelector('[data-pressure-details]');
    assert.equal(requests.at(-1).path, '/nbr6123/calcular');
    assert.equal(requests.at(-1).payload.larguratotal, undefined);
    await page.locator('[data-pressure-details]').click();
    await page.waitForSelector('#calculationDetailsDialog[open]');
    await page.keyboard.press('Escape');

    for (const [path, title] of [['/calculo-completo/', completeTitle], ['/resistencia-perfis/', 'Resistência de perfis'], ['/espessura-vidro/', 'Espessura de vidro mínima'], ['/pressao-vento/', 'Pressão de vento']]) {
      await page.goto(`${base}${path}?metodo=manual`);
      await page.waitForSelector('body[data-tool]');
      assert.equal(await page.locator('#toolTitle').textContent(), title);
      assert.equal(await page.locator('input[name="nbrS1"]:checked, input[name="nbrS2"]:checked, input[name="nbrS3"]:checked').count(), 0);
      if (path === '/pressao-vento/') {
        assert.equal(await page.locator('#manualTab').isVisible(), false);
        assert.equal(new URL(page.url()).searchParams.get('metodo'), 'tabela');
        await page.locator('#pavimentosInput').fill('5');
        await page.locator('#addressInput').fill('Curitiba');
        await page.locator('#searchBtn').click();
        await page.waitForSelector('#mapid .leaflet-marker-icon');
      } else {
        await page.locator('#manualPressaoInput').fill('1350');
        if (path === '/calculo-completo/' || path === '/resistencia-perfis/') {
          await page.locator('#frameWidthInput').fill('2400');
          await page.locator('#frameHeightInput').fill('2100');
          await page.locator('#frameLeavesInput').fill('2');
        }
        if (path === '/calculo-completo/' || path === '/espessura-vidro/') {
          if (path === '/calculo-completo/') await page.locator('#includeGlassInput').check();
          await page.locator('#glassWidthInput').fill('1200');
          await page.locator('#glassHeightInput').fill('2100');
        }
      }
      await page.locator('#calculateBtn').click();
      await page.waitForFunction(() => !document.querySelector('#calculateBtn').disabled);
      for (const width of [1440, 1280, 1024, 768, 390, 320]) {
        await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${path} overflows at ${width}px`);
        if ([1440, 390].includes(width)) await page.screenshot({ path: `tests/artifacts/${path.replaceAll('/', '') || 'complete'}-${width}.png`, fullPage: true });
      }
    }

    await page.locator('.app-navigation [data-tool="profiles"]').click();
    await page.locator('#manualTab').click();
    await page.goBack();
    assert.equal(await page.locator('#manualTab').isVisible(), false);
    assert.equal(await page.locator('#tabledTab').getAttribute('aria-selected'), 'true');

    await page.route('**/pressaovento', (route) => route.fulfill({ status: 500, contentType: 'text/html', body: '<!doctype html><h1>Server error</h1>' }));
    await page.locator('#calculateBtn').click();
    await page.waitForFunction(() => !document.querySelector('#calculationError').hidden);
    assert.equal(await page.locator('#results [data-pressure-details]').count(), 0);
    assert.deepEqual(errors, []);
    console.log('OK: complete, profiles, glass, wind, pressure methods, dialogs, navigation preserves inputs, reload resets inputs, routes, API errors, desktop/mobile. API responses mocked.');
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
