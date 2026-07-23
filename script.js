const views = document.querySelectorAll('.view');
const homeView = document.querySelector('#homeView');
const openButtons = document.querySelectorAll('.open-view, .choice-panel');
const backButtons = document.querySelectorAll('.back-btn');
const dialogButtons = document.querySelectorAll('[data-dialog]');
const closeDialogButtons = document.querySelectorAll('[data-close-dialog]');
const applyFactorButtons = document.querySelectorAll('[data-apply-factor]');

const apiBaseUrl = 'https://api.calculoperfil.gabrielvc.com.br';
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
let lastNbrCalculation = null;
let lastGlassCalculation = null;
let selectedAlloy = '6060-T5';
let selectedGlassType = 'monolitico_float';
let selectedGlassLabel = 'Monolítico float';

function showView(viewId) {
  views.forEach((view) => {
    view.classList.toggle('active', view.id === viewId);
  });

  if (viewId === 'tabledView') {
    initMap('tabled');
    setTimeout(() => maps.tabled.instance?.invalidateSize(), 0);
  }

  if (viewId === 'nbrView') {
    initMap('nbr');
    setTimeout(() => maps.nbr.instance?.invalidateSize(), 0);
  }
}

openButtons.forEach((element) => {
  element.addEventListener('click', (event) => {
    event.stopPropagation();

    const target = event.currentTarget.dataset.target;

    if (target) {
      showView(target);
    }
  });
});

backButtons.forEach((button) => {
  button.addEventListener('click', () => showView(homeView.id));
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

  dialog.addEventListener('close', () => {
    if (!factorDialogState[dialog.id]) {
      return;
    }

    if (!factorDialogState[dialog.id].applied) {
      restoreFactorDialog(dialog);
    }

    delete factorDialogState[dialog.id];
  });
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    showView(homeView.id);
  }
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
  try {
    const response = await fetch(regionUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ latitude: lat, longitude: lon }),
    });

    if (!response.ok) {
      throw new Error('Ponto fora das regiões cadastradas.');
    }

    const data = await response.json();
    maps.nbr.region = data.regiao;
    maps.nbr.v0 = data.v0;

    document.querySelector('#nbrRegionInput').value = `Região ${data.regiao}`;
    document.querySelector('#nbrV0Input').value = data.v0;
    document.querySelector('#nbrPressureFinalValue').textContent = '-- Pa';
    setPressureDetailsCollapsed(false);
    renderNbrDraftResult();
  } catch (error) {
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

function addFrameData(requestData, selectors) {
  const larguratotal = getValue(selectors.largura);
  const quantidadefol = getValue(selectors.folhas);
  const alturafol = getValue(selectors.altura);

  if (larguratotal && quantidadefol && alturafol) {
    requestData.larguratotal = larguratotal;
    requestData.quantidadefol = quantidadefol;
    requestData.alturafol = alturafol;
    requestData.liga = selectedAlloy;
    requestData.tipo_vidro = selectedGlassType;
  }
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

async function sendToServer(requestData) {
  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestData),
    });

    if (!response.ok) {
      throw new Error('Erro ao se comunicar com o servidor.');
    }

    return await response.json();
  } catch (error) {
    console.error('Erro:', error);
    return { pressao_ensaio: 'Erro', wx: 'N/A', jx: 'N/A' };
  }
}

function formatNumber(value, formatter) {
  return value !== undefined && value !== null && value !== 'N/A' ? formatter(value) : 'N/A';
}

function displayResult(containerSelector, response) {
  const resultsSection = document.querySelector(containerSelector);
  const pressao = response.pressao_ensaio;
  const wx = response.wx;
  const jx = response.jx;
  const vidro = response.vidro;

  logGlassCalculation(response);
  lastGlassCalculation = vidro || null;

  const pressaoFormatada = typeof pressao === 'number' ? Math.round(pressao).toLocaleString('pt-BR') : pressao;
  const wxFormatado = formatNumber(wx, (value) => Math.ceil(value).toLocaleString('pt-BR'));
  const jxFormatado = formatNumber(jx, (value) => Number.parseInt(value, 10).toLocaleString('pt-BR'));
  const vidroFormatado = vidro?.espessura_minima
    ? formatGlassResult(vidro)
    : 'N/A';
  const vidroDescricao = vidro ? getGlassCompositionLabel(vidro) : selectedGlassLabel;

  resultsSection.innerHTML = `
    <h2>Resultados</h2>
    <dl>
      <div><dt>Pressao de ensaio</dt><dd><span>${pressaoFormatada}</span><small>Pa</small></dd></div>
      <div class="${vidro ? 'result-with-action' : ''}">
        <dt>Vidro mínimo</dt>
        <dd><span>${vidroFormatado}</span><small>${vidroDescricao}</small></dd>
        ${vidro ? '<button class="detail-btn" type="button" data-glass-details>Detalhes</button>' : ''}
      </div>
      <div class="result-highlight"><dt>Wx necessario</dt><dd><span>${wxFormatado}</span><small>mm³</small></dd></div>
      <div class="result-highlight"><dt>Jx necessario</dt><dd><span>${jxFormatado}</span><small>mm⁴</small></dd></div>
    </dl>
  `;

  resultsSection.querySelector('[data-glass-details]')?.addEventListener('click', openGlassDetails);
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
    pressao_Pa: glass.pressao,
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

async function calculateByLocation() {
  const marker = maps.tabled.marker;

  if (!marker) {
    alert('Por favor, selecione um local no mapa.');
    return;
  }

  const pavimentos = getValue('#pavimentosInput');

  if (!pavimentos) {
    alert('Por favor, insira a quantidade de pavimentos.');
    return;
  }

  const requestData = {
    latitude: marker.getLatLng().lat,
    longitude: marker.getLatLng().lng,
    pavimentos,
  };

  addFrameData(requestData, {
    largura: '#larguraInput',
    altura: '#alturafolInput',
    folhas: '#quantidadefolInput',
  });

  const response = await sendToServer(requestData);

  if (response.pressao_ensaio) {
    displayResult('#results', response);
  } else {
    alert('Erro ao calcular. Verifique os dados inseridos.');
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

  addFrameData(payload, {
    largura: '#nbrLarguraInput',
    altura: '#nbrAlturaInput',
    folhas: '#nbrFolhasInput',
  });

  return payload;
}

function renderNbrDraftResult() {
  const resultsSection = document.querySelector('#nbrResults');
  resultsSection.innerHTML = `
    <h2>Resultados</h2>
    <dl>
      <div><dt>Pressao de ensaio</dt><dd><span>Aguardando</span><small>calculo</small></dd></div>
      <div><dt>Esquadria</dt><dd>Nao calculada</dd></div>
    </dl>
  `;
}

function renderNbrCalculatedResult(response) {
  const resultsSection = document.querySelector('#nbrResults');
  const pressureLabel = `${Math.round(response.pressao_ensaio).toLocaleString('pt-BR')} Pa`;
  lastNbrCalculation = response;
  lastGlassCalculation = response.vidro || null;
  logGlassCalculation(response);
  const frameHtml = response.wx && response.jx
    ? `
      <div class="result-with-action">
        <dt>Vidro mínimo</dt>
        <dd><span>${formatGlassResult(response.vidro)}</span><small>${getGlassCompositionLabel(response.vidro)}</small></dd>
        <button class="detail-btn" type="button" data-glass-details>Detalhes</button>
      </div>
      <div class="result-highlight"><dt>Wx necessario</dt><dd><span>${Math.ceil(response.wx).toLocaleString('pt-BR')}</span><small>mm³</small></dd></div>
      <div class="result-highlight"><dt>Jx necessario</dt><dd><span>${Number.parseInt(response.jx, 10).toLocaleString('pt-BR')}</span><small>mm⁴</small></dd></div>
    `
    : '<div><dt>Esquadria</dt><dd>Preencha largura, altura e folhas para calcular.</dd></div>';

  resultsSection.innerHTML = `
    <h2>Resultados</h2>
    <dl>
      <div class="result-with-action">
        <dt>Pressao de ensaio</dt>
        <dd><span>${Math.round(response.pressao_ensaio).toLocaleString('pt-BR')}</span><small>Pa</small></dd>
        <button class="detail-btn" type="button" id="calculationDetailsBtn">Detalhes</button>
      </div>
      ${frameHtml}
    </dl>
  `;

  document.querySelector('#nbrPressureFinalValue').textContent = pressureLabel;
  document.querySelector('#calculationDetailsBtn')?.addEventListener('click', openCalculationDetails);
  resultsSection.querySelector('[data-glass-details]')?.addEventListener('click', openGlassDetails);
}

function getGlassCompositionLabel(glass) {
  if (glass?.componentes?.length) {
    const composition = glass.componentes.join(' + ');
    return glass.observacao_camera ? `${composition}. Câmara a definir.` : composition;
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
        ${detailItem('Classe', `Classe ${s2.class}`)}
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
          ${detailItem('Espessura calculada', `${formatGlassThickness(glass.espessura_calculada)} mm`)}
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
        ${detailItem('Pressão usada', `${Math.round(glass.pressao).toLocaleString('pt-BR')} Pa`)}
        ${detailItem('Apoio', '4 lados apoiados')}
      </dl>
    </section>

    <section>
      <h3>Espessura e1</h3>
      <dl>
        ${detailItem('Critério', `L/l = ${formatDetailNumber(glass.relacao_L_l, 3)} ${isLongGlass ? '> 2,5' : '<= 2,5'}`)}
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
        ${detailItem('eR da composição', `${formatGlassThickness(glass.eR)} mm`)}
        ${detailItem('Fator ε3', formatDetailNumber(glass.e3))}
      </dl>
    </section>

    <section>
      <h3>Flecha</h3>
      <dl>
        ${detailItem('Fórmula', 'f = α x (P / 1,5) x b⁴ / eF³')}
        ${detailItem('l/L', formatDetailNumber(glass.relacao_l_L, 3))}
        ${detailItem('α', formatDetailNumber(glass.alpha, 4))}
        ${detailItem('eF da composição', `${formatGlassThickness(glass.eF)} mm`)}
        ${detailItem('Flecha calculada', `${formatGlassThickness(glass.flecha)} mm`)}
        ${detailItem('Flecha limite', `${formatGlassThickness(glass.flecha_limite)} mm`)}
      </dl>
    </section>

    <section>
      <h3>Resultado</h3>
      <dl>
        ${detailItem('Espessura calculada', `${formatGlassThickness(glass.espessura_calculada)} mm`)}
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
  const s2Preview = await requestS2Preview();
  const s2Dimensions = [
    getValue('#nbrBuildingWidthInput'),
    getValue('#nbrBuildingLengthInput'),
    getValue('#nbrBuildingHeightInput'),
  ].filter(Boolean);

  document.querySelector('#nbrS1Summary').textContent = s1.title || 'Escolha o fator topografico';
  document.querySelector('#nbrS1Value').textContent = formatFactorValue(s1.value);
  document.querySelector('#nbrS2Summary').textContent = s2Dimensions.length
    ? `${s2.title || 'Categoria a definir'} - ${s2Dimensions.join(' x ')} m${s2Preview?.class ? ` - Classe ${s2Preview.class}` : ''}`
    : s2.title || 'Categoria a definir';
  document.querySelector('#nbrS2Value').textContent = formatFactorValue(s2Preview?.value) || '--';
  document.querySelector('#nbrS3Summary').textContent = s3.title || 'Escolha o fator estatistico';
  document.querySelector('#nbrS3Summary').textContent += document.querySelector('#nbrS3SealingCheckbox')?.checked
    ? ' - vedações 0,92 x S3'
    : '';
  document.querySelector('#nbrS3Value').textContent = formatFactorValue(getEffectiveS3Value(s3.value));
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
    const response = await fetch(s2PreviewUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        categoria: s2.value,
        altura: height,
      }),
    });

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

  classPreview.textContent = result?.class ? `Classe ${result.class}` : 'Informe a altura';
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

async function prepareNbrCalculation() {
  if (!maps.nbr.marker || !maps.nbr.v0) {
    alert('Por favor, selecione um local no mapa para definir V0.');
    return;
  }

  const payload = getNbrPayload();

  try {
    const response = await fetch(nbrCalcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok) {
      alert(data.error || 'Erro ao calcular pela NBR 6123.');
      return;
    }

    renderNbrCalculatedResult(data);
    setPressureDetailsCollapsed(true);
  } catch (error) {
    console.error('Erro ao calcular NBR 6123:', error);
    alert('Não foi possível calcular agora.');
  }
}

async function calculateManualPressure() {
  const pressaoPersonalizada = getValue('#manualPressaoInput');

  if (!pressaoPersonalizada) {
    alert('Por favor, insira a pressão informada.');
    return;
  }

  const requestData = {
    pressao_personalizada: pressaoPersonalizada,
  };

  addFrameData(requestData, {
    largura: '#manualLarguraInput',
    altura: '#manualAlturaInput',
    folhas: '#manualFolhasInput',
  });

  const response = await sendToServer(requestData);

  if (response.pressao_ensaio) {
    displayResult('#manualResults', response);
  } else {
    alert('Erro ao calcular. Verifique os dados inseridos.');
  }
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

document.querySelector('#generateJsonBtn')?.addEventListener('click', calculateByLocation);
document.querySelector('#manualCalculateBtn')?.addEventListener('click', calculateManualPressure);
document.querySelector('#nbrCalculateBtn')?.addEventListener('click', prepareNbrCalculation);
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
    button.closest('dialog')?.close('apply');
  });
});
document.querySelectorAll('.glass-option').forEach((button) => {
  button.addEventListener('click', () => {
    setSelectedGlass(button);
    button.closest('dialog')?.close('apply');
  });
});
document.querySelectorAll('#nbrBuildingWidthInput, #nbrBuildingLengthInput, #nbrBuildingHeightInput').forEach((input) => {
  input.addEventListener('input', markFactorDialogsDirty);
});

updateFactorSummaries();
updateS1SlopeVisibility();
setSelectedAlloy(selectedAlloy);
document.querySelectorAll('[data-glass-label]').forEach((label) => {
  label.textContent = selectedGlassLabel;
});
setPressureDetailsCollapsed(false);
