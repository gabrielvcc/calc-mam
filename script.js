import { apiBaseUrl, authorizedFetch, canUse, getProfile, signOut } from './auth-client.js';

const dialogButtons = document.querySelectorAll('[data-dialog]');
const closeDialogButtons = document.querySelectorAll('[data-close-dialog]');
const applyFactorButtons = document.querySelectorAll('[data-apply-factor]');

const apiUrl = `${apiBaseUrl}/pressaovento`;
const regionUrl = `${apiBaseUrl}/regiaovento`;
const s2PreviewUrl = `${apiBaseUrl}/nbr6123/s2`;
const nbrCalcUrl = `${apiBaseUrl}/nbr6123/calcular`;

const mapConfigs = {
  tabled: {
    containerId: 'mapid',
    addressSelector: '#addressInput',
    onMarkerChange: null,
  },
  nbr: {
    containerId: 'nbrMapid',
    addressSelector: '#nbrAddressInput',
    onMarkerChange: updateNbrWindRegion,
  },
};

const maps = {
  tabled: { instance: null, marker: null },
  nbr: { instance: null, marker: null, region: null, v0: null },
};

const factorDialogState = {};
const appTitle = 'Resistência de Perfis de Alumínio · Pressão de Vento · Espessura Mínima de Vidro';
const toolDefinitions = {
  complete: { path: '/calculo-completo/', title: 'Cálculo completo', detail: 'Resistência de Perfis de Alumínio + Pressão de Vento + Espessura Mínima de Vidro', scope: '', method: 'tabled' },
  profiles: { path: '/resistencia-perfis/', title: 'Resistência de perfis', scope: 'Wx e Jx', method: 'manual' },
  glass: { path: '/espessura-vidro/', title: 'Espessura de vidro mínima', scope: 'NBR 7199', method: 'manual' },
  wind: { path: '/pressao-vento/', title: 'Pressão de vento', scope: 'Pressão de ensaio', method: 'tabled' },
};
const methodQuery = { tabled: 'tabela', nbr: 'nbr6123', manual: 'manual' };
const frameSelectors = {
  largura: '#frameWidthInput', altura: '#frameHeightInput', folhas: '#frameLeavesInput',
  glassSection: '#glassSection', glassWidth: '#glassWidthInput', glassHeight: '#glassHeightInput',
};
let activeTool = 'complete';
let activeMethod = 'tabled';
let lastCalculation = null;
let resultsDirty = false;
let lastPressure = null;
let inputRevision = 0;
let isCalculating = false;
let regionRequestId = 0;
let lastNbrCalculation = null;
let lastGlassCalculation = null;
let selectedAlloy = '6060-T5';
let selectedGlassType = 'monolitico_float';
let selectedGlassLabel = 'Monolítico float';

function routeTool() {
  const path = location.pathname.replace(/\/index\.html$/, '/').replace(/\/$/, '') || '/';
  return Object.keys(toolDefinitions).find((key) => (toolDefinitions[key].path.replace(/\/$/, '') || '/') === path) || 'complete';
}

function updateRoute() {
  const url = new URL(toolDefinitions[activeTool].path, location.origin);
  url.searchParams.set('metodo', methodQuery[activeMethod]);
  history.replaceState({}, '', url);
}

function updateGlassLayout() {
  const standalone = activeTool === 'glass';
  const section = document.querySelector('#glassSection');
  if (!canUse('glass')) document.querySelector('#includeGlassInput').checked = false;
  section.hidden = !canUse('glass') || activeTool === 'profiles' || activeTool === 'wind';
  section.classList.toggle('is-active', standalone || document.querySelector('#includeGlassInput').checked);
  section.querySelector('.section-number').textContent = standalone ? '02' : '03';
  document.querySelector('#includeGlassControl').hidden = activeTool !== 'complete';
  document.querySelector('#sameGlassControl').hidden = activeTool !== 'complete';
  updateSameGlassDimensions({ checked: activeTool === 'complete' && document.querySelector('#sameGlassInput').checked }, section, frameSelectors);
}

function selectTool(tool) {
  if (!canUse(tool)) {
    window.location.href = toolDefinitions[tool].path;
    return;
  }
  activeTool = tool;
  inputRevision += 1;
  const definition = toolDefinitions[tool];
  document.body.dataset.tool = tool;
  document.title = tool === 'complete' ? appTitle : `${definition.title} | ${appTitle}`;
  const heading = document.querySelector('#toolTitle');
  heading.textContent = definition.title;
  if (definition.detail) {
    const detail = document.createElement('span');
    detail.className = 'tool-title-detail';
    detail.textContent = definition.detail;
    heading.append(' ', detail);
  }
  document.querySelector('#toolScope').textContent = definition.scope;
  document.querySelector('#toolScope').hidden = !definition.scope;
  document.querySelector('#manualTab').hidden = tool === 'wind';
  if (tool === 'wind' && activeMethod === 'manual') selectMethod('tabled', false);
  document.querySelector('#frameSection').hidden = tool === 'glass' || tool === 'wind';
  document.querySelectorAll('.app-navigation a').forEach((link) => {
    link.hidden = !canUse(link.dataset.tool);
    if (link.dataset.tool === tool) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  updateGlassLayout();
  clearError();
  renderResults(lastCalculation);
}

function selectMethod(method, updateUrl = true) {
  if (activeTool === 'wind' && method === 'manual') method = 'tabled';
  const changed = activeMethod !== method;
  activeMethod = method;
  if (changed) invalidateResults(true);
  document.querySelectorAll('[data-method]').forEach((button) => {
    const selected = button.dataset.method === method;
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
    document.getElementById(button.getAttribute('aria-controls')).hidden = !selected;
  });
  document.querySelector('#tabledMapPanel').hidden = method !== 'tabled';
  document.querySelector('#nbrMapPanel').hidden = method !== 'nbr';
  document.querySelector('#calculatorWorkspace').classList.toggle('manual-workspace', method === 'manual');
  if (method !== 'manual') {
    const initialized = Boolean(maps[method].instance);
    initMap(method);
    if (initialized && method === 'nbr' && maps.nbr.marker && !maps.nbr.v0) {
      const point = maps.nbr.marker.getLatLng();
      updateNbrWindRegion(point.lat, point.lng);
    }
    requestAnimationFrame(() => maps[method].instance?.invalidateSize());
  }
  clearError();
  updateReusePressure();
  if (updateUrl) updateRoute();
}

function clearError() {
  document.querySelector('#calculationError').hidden = true;
  document.querySelectorAll('[aria-invalid]').forEach((input) => input.removeAttribute('aria-invalid'));
}

function reportError(message, selector = null) {
  const error = document.querySelector('#calculationError');
  error.textContent = message;
  error.hidden = false;
  const input = selector && document.querySelector(selector);
  if (input) {
    input.setAttribute('aria-invalid', 'true');
    input.focus();
  }
}

function invalidateResults(pressureChanged = false) {
  inputRevision += 1;
  if (lastCalculation) resultsDirty = true;
  if (pressureChanged) {
    setPressureDetailsCollapsed(false);
  }
  updateRecalculationNotice();
}

function updateRecalculationNotice() {
  const results = document.querySelector('#results');
  const previous = results.querySelector('#recalculationNotice');
  if (!resultsDirty || !lastCalculation) {
    previous?.remove();
    return;
  }
  if (previous) return;
  const notice = document.createElement('p');
  notice.id = 'recalculationNotice';
  notice.className = 'result-stale';
  notice.setAttribute('role', 'status');
  notice.textContent = 'Dados alterados. Recalcule para atualizar os resultados.';
  results.querySelector('h2').after(notice);
}

function updateReusePressure() {
  const button = document.querySelector('#reusePressureBtn');
  button.hidden = !Number.isFinite(lastPressure?.value) || activeMethod !== 'manual';
  button.textContent = lastPressure ? `Usar última pressão: ${formatDetailNumber(lastPressure.value)} Pa` : '';
}

document.querySelectorAll('[data-method]').forEach((button) => {
  button.addEventListener('click', () => selectMethod(button.dataset.method));
  button.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const buttons = [...document.querySelectorAll('[data-method]')].filter((tab) => !tab.hidden);
    const index = buttons.indexOf(button);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next].focus();
    buttons[next].click();
  });
});

dialogButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const dialog = document.querySelector(`#${button.dataset.dialog}`);

    if (dialog && typeof dialog.showModal === 'function') {
      snapshotFactorDialog(dialog);
      updateFactorSummaries();
      dialog.showModal();
    }
  });
});

closeDialogButtons.forEach((button) => {
  button.addEventListener('click', () => {
    button.closest('dialog')?.close('cancel');
  });
});

applyFactorButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const dialog = document.querySelector(`#${button.dataset.applyFactor}`);

    if (dialog) {
      factorDialogState[dialog.id] = { ...factorDialogState[dialog.id], applied: true };
      updateFactorSummaries();
      invalidateResults(true);
      dialog.close('apply');
    }
  });
});

document.querySelectorAll('dialog').forEach((dialog) => {
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) {
      dialog.close('cancel');
    }
  });

  const finishDialog = () => {
    if (!factorDialogState[dialog.id]) {
      return;
    }

    if (!factorDialogState[dialog.id].applied) {
      restoreFactorDialog(dialog);
      updateFactorSummaries();
      updateS1SlopeVisibility();
    }

    delete factorDialogState[dialog.id];
  };
  dialog.addEventListener('close', finishDialog);
  dialog.addEventListener('cancel', finishDialog);
});

function initMap(key) {
  const state = maps[key];
  const config = mapConfigs[key];

  if (state.instance || typeof L === 'undefined') {
    return;
  }

  state.instance = L.map(config.containerId).setView([-25.4284, -49.2733], 13);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(state.instance);

  state.instance.on('click', (event) => {
    updateMarker(key, event.latlng.lat, event.latlng.lng, { recenter: false });
  });

  if (state.coordinates) {
    updateMarker(key, state.coordinates.lat, state.coordinates.lng, { recenter: false });
  }
}

function updateMarker(key, lat, lon, options = {}) {
  const state = maps[key];
  const config = mapConfigs[key];
  const { recenter = true } = options;

  if (!state.instance) {
    return;
  }

  if (state.marker) {
    state.marker.setLatLng([lat, lon]);
  } else {
    state.marker = L.marker([lat, lon]).addTo(state.instance);
  }

  if (recenter) {
    state.instance.setView([lat, lon], 13);
  }

  const locationChanged = !state.coordinates || state.coordinates.lat !== lat || state.coordinates.lng !== lon;
  state.coordinates = { lat, lng: lon };
  const other = maps[key === 'tabled' ? 'nbr' : 'tabled'];
  other.coordinates = state.coordinates;
  other.marker?.setLatLng([lat, lon]);
  if (key === 'tabled' && locationChanged) {
    regionRequestId += 1;
    maps.nbr.region = null;
    maps.nbr.v0 = null;
    document.querySelector('#nbrV0Input').value = '';
    document.querySelector('#nbrRegionInput').value = '';
  }
  invalidateResults(true);
  config.onMarkerChange?.(lat, lon);
}

async function searchLocation(key) {
  const config = mapConfigs[key];
  const addressInput = document.querySelector(config.addressSelector);
  const address = addressInput?.value.trim();

  if (!address) {
    alert('Por favor, insira um endereço.');
    return;
  }

  initMap(key);

  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&viewbox=-74.0,-34.0,-34.0,5.3&bounded=1`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    if (!data.length) {
      alert('Endereço não encontrado no Brasil.');
      return;
    }

    const lat = Number(data[0].lat);
    const lon = Number(data[0].lon);

    if (lat < -34 || lat > 5.3 || lon < -74 || lon > -34) {
      alert('O endereço deve estar localizado no Brasil.');
      return;
    }

    updateMarker(key, lat, lon);
  } catch (error) {
    console.error('Erro ao buscar endereço:', error);
    alert('Não foi possível buscar esse endereço agora.');
  }
}

async function updateNbrWindRegion(lat, lon) {
  const requestId = ++regionRequestId;
  maps.nbr.region = null;
  maps.nbr.v0 = null;
  document.querySelector('#nbrRegionInput').value = '';
  document.querySelector('#nbrV0Input').value = '';
  try {
    const response = await authorizedFetch(regionUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ latitude: lat, longitude: lon }),
    }, activeTool);

    if (!response.ok) {
      throw new Error('Ponto fora das regiões cadastradas.');
    }

    const data = await response.json();
    if (requestId !== regionRequestId) return;
    maps.nbr.region = data.regiao;
    maps.nbr.v0 = data.v0;

    document.querySelector('#nbrRegionInput').value = `Região ${data.regiao}`;
    document.querySelector('#nbrV0Input').value = data.v0;
    document.querySelector('#nbrPressureFinalValue').textContent = '-- Pa';
    setPressureDetailsCollapsed(false);
  } catch (error) {
    if (requestId !== regionRequestId) return;
    console.error('Erro ao buscar região de vento:', error);
    maps.nbr.region = null;
    maps.nbr.v0 = null;
    document.querySelector('#nbrRegionInput').value = '';
    document.querySelector('#nbrV0Input').value = '';
    document.querySelector('#nbrPressureFinalValue').textContent = '-- Pa';
    setPressureDetailsCollapsed(false);
    alert('Não foi possível identificar a região de vento para esse ponto.');
  }
}

function getValue(selector) {
  return document.querySelector(selector)?.value.trim() || '';
}

function getCheckedFactor(name) {
  const checked = document.querySelector(`input[name="${name}"]:checked`);

  return {
    value: checked?.value || '',
    title: checked?.dataset.title || '',
  };
}

function getS1Config() {
  const selected = getCheckedFactor('nbrS1');

  if (selected.value !== 'slope') {
    return {
      value: selected.value,
      title: selected.title,
    };
  }

  const mode = getCheckedFactor('nbrS1SlopeMode');
  const manualValue = getValue('#nbrS1ManualInput').replace(',', '.');

  if (mode.value === 'manual') {
    return {
      value: manualValue,
      title: 'Taludes ou morros - valor calculado',
    };
  }

  if (mode.value === 'top') {
    return {
      value: '1.20',
      title: 'Taludes ou morros - meio/topo estimativo',
    };
  }

  return {
    value: '1.0',
    title: 'Taludes ou morros - pé de morro/base',
  };
}

function getNbrFactorState() {
  const s1 = getS1Config();
  const s2 = getCheckedFactor('nbrS2');
  const s3 = getCheckedFactor('nbrS3');
  const s2Dimensions = [
    getValue('#nbrBuildingWidthInput'),
    getValue('#nbrBuildingLengthInput'),
    getValue('#nbrBuildingHeightInput'),
  ];

  return {
    s1: Boolean(s1.value),
    s2: Boolean(s2.value && s2Dimensions.every(Boolean)),
    s3: Boolean(s3.value),
  };
}

function setFactorSummaryState(dialogId, isSelected, selectedText) {
  const summary = document.querySelector(`[data-dialog="${dialogId}"]`);
  const status = summary?.querySelector('em');

  summary?.classList.toggle('is-selected', isSelected);

  if (status) {
    status.textContent = isSelected ? selectedText : 'Clique para escolher';
  }
}

function snapshotFactorDialog(dialog) {
  const inputs = [...dialog.querySelectorAll('input')];

  if (!inputs.length) {
    return;
  }

  factorDialogState[dialog.id] = {
    applied: false,
    inputs: inputs.map((input, index) => ({
      index,
      id: input.id,
      name: input.name,
      type: input.type,
      value: input.value,
      checked: input.checked,
    })),
  };
}

function restoreFactorDialog(dialog) {
  const snapshot = factorDialogState[dialog.id];

  snapshot.inputs.forEach((item) => {
    const input = dialog.querySelectorAll('input')[item.index];

    if (!input) {
      return;
    }

    if (item.type === 'radio' || item.type === 'checkbox') {
      input.checked = item.checked;
    } else {
      input.value = item.value;
    }
  });
}

function markFactorDialogsDirty() {
  const openDialog = document.querySelector('dialog[open].factor-dialog');

  if (openDialog && factorDialogState[openDialog.id]) {
    factorDialogState[openDialog.id].applied = false;
  }

  if (openDialog?.id === 's2Dialog') {
    requestS2Preview().then(renderS2Preview);
  }
}

function updateS1SlopeVisibility() {
  const selected = getCheckedFactor('nbrS1');
  const slopeOptions = document.querySelector('#nbrS1SlopeOptions');

  slopeOptions?.classList.toggle('is-visible', selected.value === 'slope');
}

function addFrameData(requestData, selectors = frameSelectors) {
  const larguratotal = getValue(selectors.largura);
  const quantidadefol = getValue(selectors.folhas);
  const alturafol = getValue(selectors.altura);

  const needsFrame = activeTool === 'profiles' || (activeTool === 'complete' && [larguratotal, quantidadefol, alturafol].some(Boolean));
  if (needsFrame) {
    const fields = [[selectors.largura, larguratotal, 'largura'], [selectors.altura, alturafol, 'altura'], [selectors.folhas, quantidadefol, 'quantidade de folhas']];
    for (const [selector, value, label] of fields) {
      if (!value || !Number.isFinite(Number(value)) || Number(value) <= 0) {
        reportError(`Informe uma ${label} válida para a esquadria.`, selector);
        return false;
      }
    }
    if (!Number.isInteger(Number(quantidadefol))) {
      reportError('A quantidade de folhas deve ser um número inteiro.', selectors.folhas);
      return false;
    }
    requestData.larguratotal = larguratotal;
    requestData.quantidadefol = quantidadefol;
    requestData.alturafol = alturafol;
    requestData.liga = selectedAlloy;
  }

  const glassSection = selectors.glassSection ? document.querySelector(selectors.glassSection) : null;

  if (!canUse('glass') || (activeTool !== 'glass' && !(activeTool === 'complete' && glassSection?.classList.contains('is-active')))) {
    return true;
  }

  const sameGlassDimensions = activeTool === 'complete' && document.querySelector('#sameGlassInput').checked;
  let glassWidth = getValue(selectors.glassWidth);
  let glassHeight = getValue(selectors.glassHeight);

  if (sameGlassDimensions) {
    const dimensions = getFrameGlassDimensions(selectors);

    if (!dimensions) {
      reportError('Preencha largura, altura e folhas da esquadria para usar a mesma dimensão no vidro.', selectors.largura);
      return false;
    }

    glassWidth = dimensions.width;
    glassHeight = dimensions.height;
    syncGlassDimensionFields(glassSection, dimensions);
  }

  for (const [selector, value, label] of [[selectors.glassWidth, glassWidth, 'largura'], [selectors.glassHeight, glassHeight, 'altura']]) {
    if (!value || !Number.isFinite(Number(value)) || Number(value) <= 0) {
      reportError(`Informe a ${label} do vidro.`, selector);
      return false;
    }
  }

  requestData.calcular_vidro = true;
  requestData.tipo_vidro = selectedGlassType;
  requestData.largura_vidro = glassWidth;
  requestData.altura_vidro = glassHeight;

  return true;
}

function getFrameGlassDimensions(selectors) {
  const totalWidth = Number(getValue(selectors.largura).replace(',', '.'));
  const leaves = Number(getValue(selectors.folhas).replace(',', '.'));
  const height = Number(getValue(selectors.altura).replace(',', '.'));

  if (![totalWidth, leaves, height].every(Number.isFinite) || totalWidth <= 0 || leaves <= 0 || height <= 0) {
    return null;
  }

  return {
    width: String(totalWidth / leaves),
    height: String(height),
  };
}

function syncGlassDimensionFields(section, dimensions) {
  const inputs = section.querySelectorAll('.optional-glass-body .input-grid input');

  if (inputs[0]) {
    inputs[0].value = formatInputNumber(dimensions.width);
  }

  if (inputs[1]) {
    inputs[1].value = formatInputNumber(dimensions.height);
  }
}

function updateSameGlassDimensions(checkbox, section, selectors) {
  const inputs = section?.querySelectorAll('.optional-glass-body .input-grid input') || [];
  const isChecked = checkbox.checked;

  inputs.forEach((input) => {
    input.readOnly = isChecked;
  });

  section?.classList.toggle('uses-frame-glass-size', isChecked);

  if (!isChecked) {
    return;
  }

  const dimensions = getFrameGlassDimensions(selectors);

  if (dimensions) {
    syncGlassDimensionFields(section, dimensions);
  }
}

function formatInputNumber(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return '';
  }

  return Number.isInteger(number) ? String(number) : number.toFixed(2);
}

function setSelectedAlloy(alloy) {
  selectedAlloy = alloy;

  document.querySelectorAll('[data-alloy-label]').forEach((label) => {
    label.textContent = alloy;
  });
}

function setSelectedGlass(button) {
  selectedGlassType = button.dataset.glassType;
  selectedGlassLabel = button.dataset.glassName;

  document.querySelectorAll('[data-glass-label]').forEach((label) => {
    label.textContent = selectedGlassLabel;
  });
}

async function requestCalculation(url, payload) {
  const response = await authorizedFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }, activeTool);
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new Error(data?.error || 'Não foi possível calcular. Tente novamente.');
  if (!Number.isFinite(data.pressao_ensaio)) throw new Error('O servidor não retornou uma pressão válida.');
  if (payload.calcular_vidro && !data.vidro) throw new Error('O servidor não retornou o cálculo de vidro. Confira as medidas informadas.');
  if (payload.larguratotal && (!Number.isFinite(data.wx) || !Number.isFinite(data.jx))) {
    throw new Error('O servidor não retornou o cálculo do perfil. Confira as medidas e a liga.');
  }
  return data;
}

function renderResults(response = null) {
  const results = document.querySelector('#results');
  const hasPressure = Number.isFinite(response?.pressao_ensaio);
  const frameVisible = activeTool === 'complete' || activeTool === 'profiles';
  const glassVisible = canUse('glass') && (activeTool === 'glass' || (activeTool === 'complete' && (response ? Boolean(response.vidro) : document.querySelector('#includeGlassInput').checked)));
  const glass = response?.vidro;
  lastNbrCalculation = response?.cp ? response : null;
  lastGlassCalculation = glass || null;
  const frameHtml = frameVisible ? `
    <div class="result-highlight"><dt>Wx necessário</dt><dd><span>${Number.isFinite(response?.wx) ? Math.ceil(response.wx).toLocaleString('pt-BR') : '--'}</span><small>mm³</small></dd></div>
    <div class="result-highlight"><dt>Jx necessário</dt><dd><span>${Number.isFinite(response?.jx) ? Number.parseInt(response.jx, 10).toLocaleString('pt-BR') : '--'}</span><small>mm⁴</small></dd></div>
  ` : '';
  const glassHtml = glassVisible ? `
    <div class="result-with-action ${activeTool === 'glass' ? 'result-highlight' : ''}">
      <dt>Vidro mínimo</dt>
      <dd><span>${glass ? formatGlassResult(glass) : '--'}</span>${glass ? `<small>${getGlassCompositionLabel(glass)}</small>` : ''}</dd>
      ${glass ? '<button class="detail-btn" type="button" data-glass-details>Detalhes</button>' : ''}
    </div>
  ` : '';
  results.innerHTML = `
    <h2>Resultados</h2>
    <dl>
      ${frameHtml}
      ${glassHtml}
      <div class="result-with-action ${activeTool === 'wind' ? 'result-highlight' : ''}">
        <dt>Pressão de ensaio</dt>
        <dd><span>${hasPressure ? Math.round(response.pressao_ensaio).toLocaleString('pt-BR') : '--'}</span><small>Pa</small></dd>
        ${response?.cp ? '<button class="detail-btn" type="button" data-pressure-details>Detalhes</button>' : ''}
      </div>
    </dl>
    ${!hasPressure ? '<p class="result-empty">Aguardando cálculo</p>' : ''}
    ${hasPressure && activeTool === 'wind' && (canUse('profiles') || canUse('glass')) ? `
      <nav class="result-next" aria-label="Continuar cálculo">
        ${canUse('profiles') ? '<a href="/resistencia-perfis/" data-tool="profiles">Calcular perfis <span aria-hidden="true">→</span></a>' : ''}
        ${canUse('glass') ? '<a href="/espessura-vidro/" data-tool="glass">Calcular vidro <span aria-hidden="true">→</span></a>' : ''}
      </nav>
    ` : ''}
  `;
  updateRecalculationNotice();
  results.querySelector('[data-glass-details]')?.addEventListener('click', openGlassDetails);
  results.querySelector('[data-pressure-details]')?.addEventListener('click', openCalculationDetails);
}

function logGlassCalculation(response) {
  if (!response?.vidro) {
    return;
  }

  const glass = response.vidro;

  console.groupCollapsed('Memória do cálculo do vidro');
  console.table({
    tipo: glass.tipo,
    largura_vidro_mm: glass.largura_vidro,
    altura_vidro_mm: glass.altura_vidro,
    pressao_vento_Pv_Pa: glass.pressao_vento,
    fator_pressao_calculo: glass.fator_pressao_calculo,
    pressao_calculo_P_Pa: glass.pressao,
    relacao_L_l: glass.relacao_L_l,
    relacao_l_L: glass.relacao_l_L,
    e1_mm: glass.e1,
    c: glass.c,
    e3: glass.e3,
    alpha: glass.alpha,
    eR_mm: glass.eR,
    eF_mm: glass.eF,
    flecha_mm: glass.flecha,
    flecha_limite_mm: glass.flecha_limite,
    espessura_calculada_mm: glass.espessura_calculada,
    espessura_requerida_mm: glass.espessura_requerida,
    espessura_comercial_mm: glass.espessura_minima,
    composicao_mm: glass.vidros?.join(' + '),
    componentes: glass.componentes?.join(' | '),
    observacao_camera: glass.observacao_camera,
    fora_catalogo: glass.fora_catalogo,
  });
  console.groupEnd();
}

function formatGlassThickness(value) {
  return Number(value).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatGlassResult(glass) {
  if (glass.fora_catalogo) {
    return `> ${(glass.max_catalogo || Math.max(...glass.catalogo)).toLocaleString('pt-BR')} mm`;
  }

  return `${Number(glass.espessura_minima).toLocaleString('pt-BR')} mm`;
}

async function calculate(event) {
  event.preventDefault();
  if (isCalculating) return;
  clearError();
  let payload;
  if (activeMethod === 'tabled') {
    if (!maps.tabled.marker) return reportError('Selecione o local da edificação no mapa.', '#addressInput');
    const floors = Number(getValue('#pavimentosInput'));
    if (!Number.isInteger(floors) || floors <= 0) return reportError('Informe a quantidade de pavimentos.', '#pavimentosInput');
    const point = maps.tabled.marker.getLatLng();
    payload = { latitude: point.lat, longitude: point.lng, pavimentos: floors };
  } else if (activeMethod === 'nbr') {
    const missing = Object.entries(getNbrFactorState()).filter(([, complete]) => !complete).map(([factor]) => factor.toUpperCase());
    if (missing.length) return reportError(`Preencha ${missing.join(', ')} antes de calcular.`);
    if (!maps.nbr.marker || !maps.nbr.v0) return reportError('Selecione o local da edificação no mapa para definir V0.', '#nbrAddressInput');
    payload = getNbrPayload();
  } else {
    const pressure = Number(getValue('#manualPressaoInput'));
    if (!Number.isFinite(pressure) || pressure <= 0) return reportError('Informe uma pressão de ensaio maior que zero.', '#manualPressaoInput');
    payload = { pressao_personalizada: pressure };
  }
  if (!addFrameData(payload)) return;
  const revision = inputRevision;
  const method = activeMethod;
  const tool = activeTool;
  const button = document.querySelector('#calculateBtn');
  isCalculating = true;
  button.disabled = true;
  button.querySelector('span').textContent = 'Calculando...';
  document.querySelector('#results').setAttribute('aria-busy', 'true');
  try {
    const data = await requestCalculation(method === 'nbr' ? nbrCalcUrl : apiUrl, payload);
    if (method !== activeMethod || tool !== activeTool) return;
    lastCalculation = data;
    resultsDirty = revision !== inputRevision;
    lastPressure = { value: data.pressao_ensaio, method };
    renderResults(data);
    logGlassCalculation(data);
    if (method === 'nbr') {
      document.querySelector('#nbrPressureFinalValue').textContent = `${Math.round(data.pressao_ensaio).toLocaleString('pt-BR')} Pa`;
      setPressureDetailsCollapsed(!resultsDirty);
    }
    updateReusePressure();
  } catch (error) {
    if (revision === inputRevision) reportError(error.message || 'Não foi possível calcular agora.');
  } finally {
    isCalculating = false;
    button.disabled = false;
    button.querySelector('span').textContent = 'Calcular';
    document.querySelector('#results').removeAttribute('aria-busy');
  }
}

function getNbrPayload() {
  const marker = maps.nbr.marker;
  const s1 = getS1Config();
  const s2 = getCheckedFactor('nbrS2');
  const s3 = getCheckedFactor('nbrS3');
  const payload = {
    s1: s1.value,
    s1_titulo: s1.title,
    s2_categoria: s2.value,
    s2_titulo: s2.title,
    s2_largura_1: getValue('#nbrBuildingWidthInput'),
    s2_largura_2: getValue('#nbrBuildingLengthInput'),
    s2_altura: getValue('#nbrBuildingHeightInput'),
    s3: s3.value,
    s3_titulo: s3.title,
    s3_vedacao: document.querySelector('#nbrS3SealingCheckbox')?.checked || false,
  };

  if (marker) {
    payload.latitude = marker.getLatLng().lat;
    payload.longitude = marker.getLatLng().lng;
  }

  return payload;
}


function getGlassCompositionLabel(glass) {
  if (glass?.componentes?.length) {
    return glass.componentes.join(' + ');
  }

  if (!glass?.vidros?.length) {
    return selectedGlassLabel;
  }

  if (glass.vidros.length === 1) {
    return glass.tipo;
  }

  return `${glass.tipo}: ${glass.vidros.map((value) => `${formatGlassThickness(value)} mm`).join(' + ')}`;
}

function detailItem(label, value) {
  return `
    <div>
      <dt>${label}</dt>
      <dd>${value ?? '--'}</dd>
    </div>
  `;
}

function formatDetailNumber(value, digits = 2) {
  if (typeof value !== 'number') {
    return '--';
  }

  return value.toLocaleString('pt-BR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function openCalculationDetails() {
  if (!lastNbrCalculation) {
    return;
  }

  const dialog = document.querySelector('#calculationDetailsDialog');
  const content = document.querySelector('#calculationDetailsContent');
  const cp = lastNbrCalculation.cp;
  const s2 = lastNbrCalculation.s2;
  const s3 = lastNbrCalculation.s3;
  const glass = lastNbrCalculation.vidro;

  content.innerHTML = `
    <section>
      <h3>Pressao de vento</h3>
      <dl>
        ${detailItem('Tabela / criterio', 'NBR 6123:2023 - fatores S1, S2, S3')}
        ${detailItem('Regiao de vento', `Regiao ${lastNbrCalculation.regiao}`)}
        ${detailItem('V0', `${lastNbrCalculation.v0} m/s`)}
        ${detailItem('S1', formatDetailNumber(lastNbrCalculation.s1))}
        ${detailItem('S2', formatDetailNumber(s2.value))}
        ${detailItem('S3 aplicado', formatDetailNumber(s3.effective))}
        ${detailItem('Pressao dinamica q', `${Math.round(lastNbrCalculation.q).toLocaleString('pt-BR')} Pa`)}
      </dl>
    </section>

    <section>
      <h3>S2</h3>
      <dl>
        ${detailItem('Classe', `Classe ${s2.class} para vedações`)}
        ${detailItem('Bm', formatDetailNumber(s2.meteorological?.bm))}
        ${detailItem('p', formatDetailNumber(s2.meteorological?.p, 3))}
        ${detailItem('Fr', formatDetailNumber(s2.gust_factor))}
      </dl>
    </section>

    <section>
      <h3>Coeficiente de pressao</h3>
      <dl>
        ${detailItem('Tabela / criterio', 'Tabela 6 - Cpe paredes retangulares')}
        ${detailItem('h/b', formatDetailNumber(cp.governing.h_over_b, 3))}
        ${detailItem('a/b', formatDetailNumber(cp.governing.a_over_b, 3))}
        ${cp.interpolation ? detailItem('Interpolação', `${cp.interpolation.note}; valor ${formatDetailNumber(cp.interpolation.value, 3)} entre ${formatDetailNumber(cp.interpolation.from, 2)} e ${formatDetailNumber(cp.interpolation.to, 2)}`) : ''}
        ${detailItem('Cpe médio', formatDetailNumber(cp.average_cpe, 3))}
        ${detailItem('Direcao', cp.governing.wind_angle)}
        ${detailItem('Zona critica', cp.governing.zone)}
        ${detailItem('Cpe', formatDetailNumber(cp.governing.cpe))}
        ${detailItem('Cpi', formatDetailNumber(cp.governing.cpi))}
        ${detailItem('Cp usado', formatDetailNumber(Math.abs(cp.governing.cp), 3))}
      </dl>
    </section>

    <section>
      <h3>Pressao na esquadria</h3>
      <dl>
        ${detailItem('Pressao positiva', `${Math.round(cp.positive_pressure).toLocaleString('pt-BR')} Pa`)}
        ${detailItem('Pressao negativa', `${Math.round(cp.negative_pressure).toLocaleString('pt-BR')} Pa`)}
        ${detailItem('Maior absoluto', `${Math.round(lastNbrCalculation.pressao_ensaio).toLocaleString('pt-BR')} Pa`)}
      </dl>
    </section>

    ${glass ? `
      <section>
        <h3>Vidro</h3>
        <dl>
          ${detailItem('Tabela / criterio', 'NBR 7199: item 4.7 - quatro lados apoiados')}
          ${detailItem('Tipo', glass.tipo)}
          ${detailItem('Dimensao do modulo', `${formatGlassThickness(glass.largura_vidro)} x ${formatGlassThickness(glass.altura_vidro)} mm`)}
          ${detailItem('e1', `${formatGlassThickness(glass.e1)} mm`)}
          ${detailItem('Espessura total calculada', `${formatGlassThickness(glass.espessura_calculada)} mm`)}
          ${detailItem('Espessura requerida', `${formatGlassThickness(glass.espessura_requerida)} mm`)}
          ${detailItem('eR', `${formatGlassThickness(glass.eR)} mm`)}
          ${detailItem('eF', `${formatGlassThickness(glass.eF)} mm`)}
          ${detailItem('Flecha', `${formatGlassThickness(glass.flecha)} mm / limite ${formatGlassThickness(glass.flecha_limite)} mm`)}
          ${detailItem('Espessura comercial', formatGlassResult(glass))}
          ${glass.observacao_camera ? detailItem('Câmara', 'Não incluída na espessura calculada do vidro') : ''}
        </dl>
      </section>
    ` : ''}
  `;

  dialog?.showModal();
}

function openGlassDetails() {
  const glass = lastGlassCalculation;

  if (!glass) {
    return;
  }

  const dialog = document.querySelector('#glassDetailsDialog');
  const content = document.querySelector('#glassDetailsContent');
  const isLongGlass = glass.relacao_L_l > 2.5;
  const baseFormula = isLongGlass
    ? 'e1 = l x raiz(P) / 6,3'
    : 'e1 = raiz((S x P) / 100)';
  const baseValues = isLongGlass
    ? `l = ${formatDetailNumber(Math.min(glass.largura_vidro, glass.altura_vidro) / 1000, 3)} m / P = ${Math.round(glass.pressao).toLocaleString('pt-BR')} Pa`
    : `S = ${formatDetailNumber((glass.largura_vidro / 1000) * (glass.altura_vidro / 1000), 3)} m² / P = ${Math.round(glass.pressao).toLocaleString('pt-BR')} Pa`;

  content.innerHTML = `
    <section>
      <h3>Entrada</h3>
      <dl>
        ${detailItem('Tipo escolhido', glass.tipo)}
        ${detailItem('Composição', getGlassCompositionLabel(glass))}
        ${detailItem('Dimensão do vidro', `${formatGlassThickness(glass.largura_vidro)} x ${formatGlassThickness(glass.altura_vidro)} mm`)}
        ${detailItem('Pressão de vento Pv', `${Math.round(glass.pressao_vento).toLocaleString('pt-BR')} Pa`)}
        ${detailItem('Pressão de cálculo P', `${Math.round(glass.pressao).toLocaleString('pt-BR')} Pa`)}
        ${detailItem('Apoio', '4 lados apoiados')}
      </dl>
    </section>

    <section>
      <h3>Espessura e1</h3>
      <dl>
        ${detailItem('Critério', `L/l = ${formatDetailNumber(glass.relacao_L_l, 3)} ${isLongGlass ? '> 2,5' : '<= 2,5'}`)}
        ${detailItem('Pressão', `P = Pv x ${formatDetailNumber(glass.fator_pressao_calculo)} = ${Math.round(glass.pressao).toLocaleString('pt-BR')} Pa`)}
        ${detailItem('Fórmula', baseFormula)}
        ${detailItem('Valores', baseValues)}
        ${detailItem('e1 calculado', `${formatGlassThickness(glass.e1)} mm`)}
        ${detailItem('Fator c', formatDetailNumber(glass.c))}
      </dl>
    </section>

    <section>
      <h3>Resistência</h3>
      <dl>
        ${detailItem('Verificação', 'eR >= e1 x c')}
        ${detailItem('e1 x c', `${formatGlassThickness(glass.e1 * glass.c)} mm`)}
        ${detailItem('eR equivalente da composição', `${formatGlassThickness(glass.eR)} mm`)}
        ${glass.espessura_resistencia != null ? detailItem('Espessura total mínima por resistência', `${formatGlassThickness(glass.espessura_resistencia)} mm`) : ''}
        ${detailItem('Fator ε3', formatDetailNumber(glass.e3))}
      </dl>
    </section>

    <section>
      <h3>Flecha</h3>
      <dl>
        ${detailItem('Fórmula', 'f = α x (P / 1,5) x b⁴ / eF³')}
        ${detailItem('l/L', formatDetailNumber(glass.relacao_l_L, 3))}
        ${detailItem('α', formatDetailNumber(glass.alpha, 4))}
        ${glass.eF_minimo != null ? detailItem('eF equivalente mínimo', `${formatGlassThickness(glass.eF_minimo)} mm`) : ''}
        ${detailItem('eF equivalente da composição', `${formatGlassThickness(glass.eF)} mm`)}
        ${glass.espessura_flecha != null ? detailItem('Espessura total mínima por flecha', `${formatGlassThickness(glass.espessura_flecha)} mm`) : ''}
        ${detailItem('Flecha calculada', `${formatGlassThickness(glass.flecha)} mm`)}
        ${detailItem('Flecha limite', `${formatGlassThickness(glass.flecha_limite)} mm`)}
      </dl>
    </section>

    <section>
      <h3>Resultado</h3>
      <dl>
        ${detailItem('Espessura total calculada', `${formatGlassThickness(glass.espessura_calculada)} mm`)}
        ${detailItem('Após mínimo por lâmina', `${formatGlassThickness(glass.espessura_requerida)} mm`)}
        ${detailItem('Espessura comercial', formatGlassResult(glass))}
        ${detailItem('Catálogo usado', glass.catalogo.map((value) => `${value} mm`).join(', '))}
        ${glass.observacao_camera ? detailItem('Câmara', 'A câmara do insulado é definida à parte e não entra nessa espessura de vidro') : ''}
      </dl>
    </section>
  `;

  dialog?.showModal();
}

async function updateFactorSummaries() {
  const s1 = getS1Config();
  const s2 = getCheckedFactor('nbrS2');
  const s3 = getCheckedFactor('nbrS3');
  const factorState = getNbrFactorState();
  const s2Preview = await requestS2Preview();
  const s2Dimensions = [
    getValue('#nbrBuildingWidthInput'),
    getValue('#nbrBuildingLengthInput'),
    getValue('#nbrBuildingHeightInput'),
  ].filter(Boolean);

  document.querySelector('#nbrS1Summary').textContent = s1.title || '';
  document.querySelector('#nbrS1Value').textContent = formatFactorValue(s1.value) || '--';
  document.querySelector('#nbrS2Summary').textContent = s2Dimensions.length
    ? `${s2.title || 'Categoria não escolhida'} - ${s2Dimensions.join(' x ')} m - Classe A para vedações`
    : s2.title || '';
  document.querySelector('#nbrS2Value').textContent = formatFactorValue(s2Preview?.value) || '--';
  document.querySelector('#nbrS3Summary').textContent = s3.title || '';
  document.querySelector('#nbrS3Summary').textContent += s3.value && document.querySelector('#nbrS3SealingCheckbox')?.checked
    ? ' - vedações 0,92 x S3'
    : '';
  document.querySelector('#nbrS3Value').textContent = formatFactorValue(getEffectiveS3Value(s3.value)) || '--';
  setFactorSummaryState('s1Dialog', factorState.s1, 'S1 escolhido');
  setFactorSummaryState('s2Dialog', factorState.s2, 'S2 escolhido');
  setFactorSummaryState('s3Dialog', factorState.s3, 'S3 escolhido');
  renderS2Preview(s2Preview);
}

function formatFactorValue(value) {
  return value ? Number(value).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 2 }) : '';
}

function getEffectiveS3Value(value) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return '';
  }

  return document.querySelector('#nbrS3SealingCheckbox')?.checked ? numericValue * 0.92 : numericValue;
}

async function requestS2Preview() {
  const s2 = getCheckedFactor('nbrS2');
  const height = getValue('#nbrBuildingHeightInput');

  if (!s2.value || !height) {
    return null;
  }

  try {
    const response = await authorizedFetch(s2PreviewUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        categoria: s2.value,
        altura: height,
      }),
    }, activeTool);

    if (!response.ok) {
      return null;
    }

    return await response.json();
  } catch (error) {
    console.error('Erro ao buscar S2:', error);
    return null;
  }
}

function renderS2Preview(result = null) {
  const classPreview = document.querySelector('#nbrS2ClassPreview');
  const meteorPreview = document.querySelector('#nbrS2MeteorPreview');
  const gustPreview = document.querySelector('#nbrS2GustPreview');
  const resultPreview = document.querySelector('#nbrS2ResultPreview');

  if (!classPreview || !meteorPreview || !gustPreview || !resultPreview) {
    return;
  }

  classPreview.textContent = result?.class ? `Classe ${result.class} para vedações` : 'Classe A para vedações';
  meteorPreview.textContent = result?.meteorological
    ? `Bm ${formatDecimal(result.meteorological.bm)} / p ${formatDecimal(result.meteorological.p, 3)}`
    : '--';
  gustPreview.textContent = result?.gust_factor ? `Fr ${formatDecimal(result.gust_factor)}` : '--';
  resultPreview.textContent = result?.value ? formatFactorValue(result.value) : '--';
}

function formatDecimal(value, maximumFractionDigits = 2) {
  return Number(value).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits,
  });
}

function setPressureDetailsCollapsed(isCollapsed) {
  const panel = document.querySelector('#nbrPressurePanel');
  const button = document.querySelector('#togglePressureDetailsBtn');

  panel.classList.toggle('is-collapsed', isCollapsed);
  button.textContent = isCollapsed ? 'Editar parametros' : 'Minimizar';
}


document.querySelector('#searchBtn')?.addEventListener('click', () => searchLocation('tabled'));
document.querySelector('#addressInput')?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    searchLocation('tabled');
  }
});

document.querySelector('#nbrSearchBtn')?.addEventListener('click', () => searchLocation('nbr'));
document.querySelector('#nbrAddressInput')?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    searchLocation('nbr');
  }
});

document.querySelector('#calculatorForm').addEventListener('submit', calculate);
document.querySelector('#reusePressureBtn').addEventListener('click', () => {
  if (!lastPressure) return;
  document.querySelector('#manualPressaoInput').value = lastPressure.value;
  invalidateResults(true);
});
document.querySelector('#togglePressureDetailsBtn')?.addEventListener('click', () => {
  const panel = document.querySelector('#nbrPressurePanel');
  setPressureDetailsCollapsed(!panel.classList.contains('is-collapsed'));
});
document.querySelectorAll('input[name="nbrS1"], input[name="nbrS2"], input[name="nbrS3"]').forEach((input) => {
  input.addEventListener('change', () => {
    updateS1SlopeVisibility();
    markFactorDialogsDirty();
  });
});
document.querySelectorAll('input[name="nbrS1SlopeMode"]').forEach((input) => {
  input.addEventListener('change', markFactorDialogsDirty);
});
document.querySelector('#nbrS1ManualInput')?.addEventListener('input', () => {
  const manualMode = document.querySelector('input[name="nbrS1SlopeMode"][value="manual"]');
  const slopeMode = document.querySelector('input[name="nbrS1"][value="slope"]');

  if (manualMode && slopeMode) {
    manualMode.checked = true;
    slopeMode.checked = true;
    updateS1SlopeVisibility();
  }

  markFactorDialogsDirty();
});
document.querySelector('#nbrS3SealingCheckbox')?.addEventListener('change', markFactorDialogsDirty);
document.querySelectorAll('.alloy-option').forEach((button) => {
  button.addEventListener('click', () => {
    if (!button.dataset.alloy) {
      return;
    }

    setSelectedAlloy(button.dataset.alloy);
    invalidateResults();
    button.closest('dialog')?.close('apply');
  });
});
document.querySelectorAll('.glass-option').forEach((button) => {
  button.addEventListener('click', () => {
    setSelectedGlass(button);
    invalidateResults();
    button.closest('dialog')?.close('apply');
  });
});
document.querySelectorAll('#calculatorForm input:not([readonly])').forEach((input) => {
  input.addEventListener('input', () => {
    clearError();
    updateGlassLayout();
    invalidateResults(Boolean(input.closest('.pressure-method-panel')));
  });
});
document.querySelectorAll('#nbrBuildingWidthInput, #nbrBuildingLengthInput, #nbrBuildingHeightInput').forEach((input) => {
  input.addEventListener('input', markFactorDialogsDirty);
});

document.querySelectorAll('#top-bar [data-sign-out]').forEach((button) => button.addEventListener('click', signOut));
document.querySelector('#calculatorUserEmail').textContent = getProfile()?.email || '';
window.addEventListener('calculator-permissions-changed', () => {
  document.querySelectorAll('.app-navigation a').forEach((link) => { link.hidden = !canUse(link.dataset.tool); });
  updateGlassLayout();
  renderResults(lastCalculation);
});

let calculatorInitialized = false;
export function showCalculatorRoute() {
  const tool = routeTool();
  const requestedMethod = new URLSearchParams(location.search).get('metodo');
  let method = Object.keys(methodQuery).find((key) => methodQuery[key] === requestedMethod)
    || (calculatorInitialized ? activeMethod : toolDefinitions[tool].method);
  if (tool === 'wind' && method === 'manual') method = 'tabled';
  if (!calculatorInitialized || activeTool !== tool || document.body.dataset.tool !== tool) selectTool(tool);
  if (!calculatorInitialized || activeMethod !== method) selectMethod(method, false);
  calculatorInitialized = true;
  updateRoute();
  requestAnimationFrame(() => maps[activeMethod]?.instance?.invalidateSize());
}

updateFactorSummaries();
updateS1SlopeVisibility();
setSelectedAlloy(selectedAlloy);
document.querySelectorAll('[data-glass-label]').forEach((label) => {
  label.textContent = selectedGlassLabel;
});
setPressureDetailsCollapsed(false);
