import { initializeAccess, getProfile, canUse, signIn, signOut } from './auth-client.js';

const mount = document.querySelector('#app');
const apps = {
  complete: { path: '/calculo-completo/', title: 'Cálculo completo', note: 'Perfis e pressão de vento', icon: 'layout-dashboard' },
  profiles: { path: '/resistencia-perfis/', title: 'Resistência de perfis', note: 'Wx e Jx', icon: 'columns-2' },
  glass: { path: '/espessura-vidro/', title: 'Espessura de vidro', note: 'NBR 7199', icon: 'panels-top-left' },
  wind: { path: '/pressao-vento/', title: 'Pressão de vento', note: 'NBR 6123 e NBR 10821', icon: 'wind' },
};
const path = location.pathname.replace(/\/index\.html$/, '/').replace(/\/$/, '') || '/';
let accessMarkup = '';
let contactEmail = 'eng@gabrielvc.com.br';
let accountEmail = '';
let calculatorLoaded = false;
let renderRevision = 0;
let accessViewKey = '';

const stylesheet = document.createElement('link');
stylesheet.rel = 'stylesheet';
stylesheet.href = new URL('./access.css', import.meta.url);
document.head.append(stylesheet);

async function loadMarkup(name) {
  const response = await fetch(new URL(name, import.meta.url));
  if (!response.ok) throw new Error('Não foi possível carregar esta página.');
  return response.text();
}

function updateContact() {
  document.querySelectorAll('[data-contact-email]').forEach((link) => {
    link.textContent = contactEmail;
    link.href = `mailto:${contactEmail}`;
  });
}

function bindAccessPage() {
  const requestDialog = document.querySelector('#requestAccessDialog');
  document.querySelectorAll('[data-account-email]').forEach((element) => { element.textContent = accountEmail; });
  document.querySelector('#accessAccount').hidden = !accountEmail;
  document.querySelectorAll('[data-sign-out]').forEach((button) => button.addEventListener('click', signOut));
  document.querySelectorAll('[data-request-access]').forEach((button) => button.addEventListener('click', () => {
    document.querySelector('#requestEmail').value = accountEmail;
    document.querySelector('#requestName').value = getProfile()?.name || '';
    requestDialog.showModal();
  }));
  document.querySelector('#closeRequestBtn').addEventListener('click', () => requestDialog.close());
  requestDialog.addEventListener('click', (event) => { if (event.target === requestDialog) requestDialog.close(); });
  document.querySelector('#requestAccessForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const name = document.querySelector('#requestName').value.trim();
    const email = document.querySelector('#requestEmail').value.trim();
    const message = document.querySelector('#requestMessage').value.trim();
    const body = `Nome: ${name}\nConta Google: ${email}\n\n${message}`;
    window.location.href = `mailto:${contactEmail}?subject=${encodeURIComponent('Solicitação de acesso às calculadoras')}&body=${encodeURIComponent(body)}`;
  });
  document.querySelector('#googleLoginBtn').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    document.querySelector('#loginError').hidden = true;
    try { await signIn(); }
    catch (error) {
      if (!['auth/popup-closed-by-user', 'auth/cancelled-popup-request'].includes(error.code)) showLoginError('Não foi possível entrar com Google. Tente novamente.');
    } finally { button.disabled = false; }
  });
  document.querySelector('#retryAccessBtn').addEventListener('click', () => window.location.reload());
  updateContact();
  window.lucide?.createIcons();
}

function showLoginError(message) {
  const error = document.querySelector('#loginError');
  if (!error) return;
  error.textContent = message;
  error.hidden = false;
  document.querySelector('#retryAccessBtn').hidden = false;
}

function showAccessSection(id) {
  for (const key of ['loginSection', 'deniedSection', 'portalSection', 'adminSection']) {
    document.getElementById(key).hidden = key !== id;
  }
}

function renderPortal(profile) {
  showAccessSection('portalSection');
  document.querySelector('#adminLink').hidden = !profile.admin;
  const list = document.querySelector('#portalApps');
  Object.entries(apps).forEach(([key, app]) => {
    if (!canUse(key)) return;
    const item = document.createElement('article');
    item.className = 'portal-app';
    const icon = document.createElement('i');
    icon.dataset.lucide = app.icon;
    icon.setAttribute('aria-hidden', 'true');
    const title = document.createElement('h2');
    title.textContent = app.title;
    const note = document.createElement('p');
    note.textContent = app.note;
    const link = document.createElement('a');
    link.className = 'primary-btn';
    link.href = app.path;
    link.textContent = 'Abrir calculadora';
    item.append(icon, title, note, link);
    list.append(item);
  });
  window.lucide?.createIcons();
}

async function renderState(state) {
  const currentPath = location.pathname.replace(/\/index\.html$/, '/').replace(/\/$/, '') || '/';
  const routeApp = Object.keys(apps).find((key) => apps[key].path.replace(/\/$/, '') === currentPath);
  if (calculatorLoaded && (state.status !== 'authorized' || !canUse(routeApp))) return window.location.reload();
  accountEmail = state.profile?.email || state.email || '';
  if (state.status === 'authorized' && routeApp && canUse(routeApp)) {
    if (calculatorLoaded && document.querySelector('#calculatorForm')) return;
    if (calculatorLoaded) return window.location.reload();
    const revision = ++renderRevision;
    const markup = await loadMarkup('./calculator.html');
    if (revision !== renderRevision) return;
    mount.innerHTML = markup;
    document.body.dataset.screen = 'calculator';
    calculatorLoaded = true;
    await import('./script.js');
    window.lucide?.createIcons();
    return;
  }
  const viewKey = JSON.stringify(state);
  if (accessViewKey === viewKey && document.querySelector('#loginSection')) return;
  accessViewKey = viewKey;
  const revision = ++renderRevision;
  delete document.body.dataset.tool;
  document.body.dataset.screen = 'access';
  mount.innerHTML = accessMarkup;
  bindAccessPage();
  if (state.status === 'authorized') {
    if (routeApp || (path === '/administracao' && !state.profile.admin)) {
      showAccessSection('deniedSection');
      document.querySelector('#deniedTitle').textContent = 'Calculadora não liberada';
      document.querySelector('#deniedMessage').textContent = 'Sua conta não tem permissão para esta área. Solicite a liberação ao responsável.';
    } else if (path === '/administracao') {
      showAccessSection('adminSection');
      const { initializeAdmin } = await import('./admin-access.js');
      if (revision === renderRevision) initializeAdmin();
    } else renderPortal(state.profile);
  } else if (state.status === 'denied') {
    showAccessSection('deniedSection');
    if (state.code === 'app_forbidden') document.querySelector('#deniedTitle').textContent = 'Calculadora não liberada';
    if (state.message) document.querySelector('#deniedMessage').textContent = `${state.message} Entre em contato com o responsável para solicitar acesso.`;
  } else {
    document.querySelector('#googleLoginBtn').disabled = false;
    if (state.status === 'error') showLoginError(state.message || 'Não foi possível conferir o acesso. Tente novamente.');
  }
}

window.addEventListener('calculator-contact', (event) => { contactEmail = event.detail; updateContact(); });
window.addEventListener('calculator-access-denied', (event) => {
  renderState({ ...event.detail, status: event.detail.status === 403 ? 'denied' : 'error', message: event.detail.error });
});

try {
  accessMarkup = await loadMarkup('./access.html');
  mount.innerHTML = accessMarkup;
  document.body.dataset.screen = 'access';
  bindAccessPage();
  await initializeAccess((state) => { renderState(state).catch(() => showLoginError('Não foi possível abrir esta página. Recarregue para tentar novamente.')); });
} catch (error) {
  if (accessMarkup) showLoginError(error.message || 'O login está indisponível.');
  else {
    mount.innerHTML = '<main class="app-loading"><p>Não foi possível abrir o site.</p><a href="mailto:eng@gabrielvc.com.br">Solicitar acesso por e-mail</a></main>';
  }
}
