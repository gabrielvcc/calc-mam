const views = document.querySelectorAll('.view');
const homeView = document.querySelector('#homeView');
const openButtons = document.querySelectorAll('.open-view, .choice-panel');
const backButtons = document.querySelectorAll('.back-btn');
const dialogButtons = document.querySelectorAll('[data-dialog]');
const closeDialogButtons = document.querySelectorAll('[data-close-dialog]');

const apiBaseUrl = 'https://api.calculoperfil.gabrielvc.com.br';
const apiUrl = `${apiBaseUrl}/pressaovento`;
const regionUrl = `${apiBaseUrl}/regiaovento`;

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
      dialog.showModal();
    }
  });
});

closeDialogButtons.forEach((button) => {
  button.addEventListener('click', () => {
    button.closest('dialog')?.close();
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
    updateMarker(key, event.latlng.lat, event.latlng.lng);
  });
}

function updateMarker(key, lat, lon) {
  const state = maps[key];
  const config = mapConfigs[key];

  if (!state.instance) {
    return;
  }

  if (state.marker) {
    state.marker.setLatLng([lat, lon]);
  } else {
    state.marker = L.marker([lat, lon]).addTo(state.instance);
  }

  state.instance.setView([lat, lon], 13);
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
    renderNbrDraftResult();
  } catch (error) {
    console.error('Erro ao buscar região de vento:', error);
    maps.nbr.region = null;
    maps.nbr.v0 = null;
    document.querySelector('#nbrRegionInput').value = '';
    document.querySelector('#nbrV0Input').value = '';
    alert('Não foi possível identificar a região de vento para esse ponto.');
  }
}

function getValue(selector) {
  return document.querySelector(selector)?.value.trim() || '';
}

function addFrameData(requestData, selectors) {
  const larguratotal = getValue(selectors.largura);
  const quantidadefol = getValue(selectors.folhas);
  const alturafol = getValue(selectors.altura);

  if (larguratotal && quantidadefol && alturafol) {
    requestData.larguratotal = larguratotal;
    requestData.quantidadefol = quantidadefol;
    requestData.alturafol = alturafol;
  }
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

  const pressaoFormatada = typeof pressao === 'number' ? Math.round(pressao).toLocaleString('pt-BR') : pressao;
  const wxFormatado = formatNumber(wx, (value) => Math.ceil(value).toLocaleString('pt-BR'));
  const jxFormatado = formatNumber(jx, (value) => Number.parseInt(value, 10).toLocaleString('pt-BR'));

  resultsSection.innerHTML = `
    <h2>Resultados</h2>
    <dl>
      <div><dt>Pressao de ensaio</dt><dd>${pressaoFormatada} Pa</dd></div>
      <div><dt>Wx necessario</dt><dd>${wxFormatado} mm³</dd></div>
      <div><dt>Jx necessario</dt><dd>${jxFormatado} mm⁴</dd></div>
    </dl>
  `;
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
  const payload = {
    regiao: maps.nbr.region,
    v0: getValue('#nbrV0Input'),
    s1: getValue('#nbrS1Select'),
    s2: getValue('#nbrS2Select'),
    s3: getValue('#nbrS3Select'),
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
  const payload = getNbrPayload();
  const regionLabel = payload.regiao ? `Região ${payload.regiao}` : 'Selecione um ponto no mapa';
  const v0Label = payload.v0 ? `${payload.v0} m/s` : '-- m/s';

  resultsSection.innerHTML = `
    <h2>Resultados</h2>
    <dl>
      <div><dt>Regiao</dt><dd>${regionLabel}</dd></div>
      <div><dt>V0</dt><dd>${v0Label}</dd></div>
      <div><dt>S1</dt><dd>${payload.s1}</dd></div>
      <div><dt>S2</dt><dd>${payload.s2}</dd></div>
      <div><dt>S3</dt><dd>${payload.s3}</dd></div>
    </dl>
  `;
}

function prepareNbrCalculation() {
  if (!maps.nbr.marker || !maps.nbr.v0) {
    alert('Por favor, selecione um local no mapa para definir V0.');
    return;
  }

  renderNbrDraftResult();
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
document.querySelector('#nbrS1Select')?.addEventListener('change', renderNbrDraftResult);
document.querySelector('#nbrS2Select')?.addEventListener('change', renderNbrDraftResult);
document.querySelector('#nbrS3Select')?.addEventListener('change', renderNbrDraftResult);
