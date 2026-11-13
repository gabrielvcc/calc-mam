import { initializeAccess, getProfile, canUse, signIn, signOut, refreshAccess } from './auth-client.js';

const mount = document.querySelector('#app');
const apps = {
  complete: { path: '/calculo-completo/', title: 'Cálculo completo', note: 'Perfis e pressão de vento', icon: 'layout-dashboard' },
  profiles: { path: '/resistencia-perfis/', title: 'Resistência de perfis', note: 'Wx e Jx', icon: 'columns-2' },
  glass: { path: '/espessura-vidro/', title: 'Espessura de vidro', note: 'NBR 7199', icon: 'panels-top-left' },
  wind: { path: '/pressao-vento/', title: 'Pressão de vento', note: 'NBR 6123 e NBR 10821', icon: 'wind' },
};
const accessView = document.createElement('div');
accessView.className = 'app-view';
accessView.id = 'accessView';
const calculatorView = document.createElement('div');
calculatorView.className = 'app-view is-preparing';
calculatorView.id = 'calculatorView';
calculatorView.hidden = true;
let contactEmail = 'eng@gabrielvc.com.br';
let accountEmail = '';
let accessState = null;
let authorizedUid = null;
let calculatorPromise = null;
let adminInitialized = false;
let renderRevision = 0;
let accessViewKey = '';

const stylesheet = document.createElement('link');
stylesheet.rel = 'stylesheet';
stylesheet.href = new URL('./access.css', import.meta.url);
document.head.append(stylesheet);

function routePath(pathname = location.pathname) {
  return pathname.replace(/\/index\.html$/, '/').replace(/\/$/, '') || '/';
}

function isAppRoute(url) {
  const path = routePath(url.pathname);
  return url.origin === location.origin && (path === '/' || path === '/administracao' || Object.values(apps).some((app) => routePath(app.path) === path));
}

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
  accessView.querySelectorAll('[data-sign-out]').forEach((button) => button.addEventListener('click', signOut));
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
  for (const key of ['checkingAccessSection', 'loginSection', 'deniedSection', 'portalSection', 'adminSection']) {
    document.getElementById(key).hidden = key !== id;
  }
}

function renderPortal(profile) {
  showAccessSection('portalSection');
  document.querySelector('#adminLink').hidden = !profile.admin;
  const list = document.querySelector('#portalApps');
  list.replaceChildren();
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

async function loadCalculator() {
  if (!calculatorPromise) {
    calculatorPromise = (async () => {
      calculatorView.innerHTML = await loadMarkup('./calculator.html');
      return import('./script.js');
    })();
  }
  return calculatorPromise;
}

function focusHeading() {
  const heading = document.body.dataset.screen === 'calculator'
    ? calculatorView.querySelector('#toolTitle')
    : accessView.querySelector('.access-main > section:not([hidden]) h1');
  if (heading) {
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }
}

async function renderState(state, { focus = false } = {}) {
  const revision = ++renderRevision;
  const currentPath = routePath();
  const routeApp = Object.keys(apps).find((key) => routePath(apps[key].path) === currentPath);
  if (authorizedUid && (state.status !== 'authorized' || state.profile.uid !== authorizedUid)) return window.location.reload();
  if (state.status === 'authorized') authorizedUid = state.profile.uid;
  accountEmail = state.profile?.email || state.email || '';
  accessView.querySelectorAll('[data-account-email]').forEach((element) => { element.textContent = accountEmail; });
  document.querySelector('#accessAccount').hidden = !accountEmail;
  if (state.status === 'authorized' && routeApp && canUse(routeApp)) {
    mount.setAttribute('aria-busy', 'true');
    try {
      const calculator = await loadCalculator();
      if (revision !== renderRevision) return;
      accessView.hidden = true;
      calculatorView.hidden = false;
      document.body.dataset.screen = 'calculator';
      calculator.showCalculatorRoute();
      calculatorView.classList.remove('is-preparing');
      window.lucide?.createIcons();
      if (focus) focusHeading();
    } catch (error) {
      if (revision === renderRevision) throw error;
    } finally { if (revision === renderRevision) mount.removeAttribute('aria-busy'); }
    return;
  }
  mount.removeAttribute('aria-busy');
  if (!calculatorView.hidden) closeDialogs();
  accessView.hidden = false;
  calculatorView.hidden = true;
  delete document.body.dataset.tool;
  document.body.dataset.screen = 'access';
  const title = accessView.querySelector('.brand strong').firstChild.textContent;
  document.title = currentPath === '/administracao' ? `Permissões de acesso | ${title}` : title;
  const viewKey = JSON.stringify({ path: currentPath, ...state });
  if (accessViewKey === viewKey && !(currentPath === '/administracao' && !adminInitialized)) {
    if (focus) focusHeading();
    return;
  }
  accessViewKey = viewKey;
  if (state.status === 'authorized') {
    if (routeApp || (currentPath === '/administracao' && !state.profile.admin)) {
      showAccessSection('deniedSection');
      document.querySelector('#deniedTitle').textContent = 'Calculadora não liberada';
      document.querySelector('#deniedMessage').textContent = 'Sua conta não tem permissão para esta área. Solicite a liberação ao responsável.';
    } else if (currentPath === '/administracao') {
      showAccessSection('adminSection');
      if (!adminInitialized) {
        const { initializeAdmin } = await import('./admin-access.js');
        if (revision !== renderRevision) return;
        initializeAdmin();
        adminInitialized = true;
      }
    } else renderPortal(state.profile);
  } else if (state.status === 'denied') {
    showAccessSection('deniedSection');
    document.querySelector('#deniedTitle').textContent = state.code === 'app_forbidden' ? 'Calculadora não liberada' : 'Você não está na lista de acesso';
    document.querySelector('#deniedMessage').textContent = `${state.message || 'Seu e-mail ainda não está autorizado.'} Entre em contato com o responsável para solicitar acesso.`;
  } else {
    showAccessSection('loginSection');
    document.querySelector('#googleLoginBtn').disabled = false;
    if (state.status === 'error') showLoginError(state.message || 'Não foi possível conferir o acesso. Tente novamente.');
  }
  if (focus) focusHeading();
}

function showPageError() {
  mount.removeAttribute('aria-busy');
  accessView.hidden = false;
  calculatorView.hidden = true;
  delete document.body.dataset.tool;
  document.body.dataset.screen = 'access';
  accessViewKey = '';
  showAccessSection('deniedSection');
  document.querySelector('#deniedTitle').textContent = 'Não foi possível abrir esta página';
  document.querySelector('#deniedMessage').textContent = 'Recarregue a página para tentar novamente.';
}

function closeDialogs() {
  document.querySelectorAll('dialog[open]').forEach((dialog) => dialog.close('cancel'));
}

document.addEventListener('click', (event) => {
  const link = event.target.closest('a[href]');
  if (!accessState || !link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  if (link.hasAttribute('download') || (link.target && link.target !== '_self') || link.getAttribute('href').startsWith('#')) return;
  const url = new URL(link.href);
  if (!isAppRoute(url)) return;
  event.preventDefault();
  closeDialogs();
  if (url.href !== location.href) history.pushState({}, '', url);
  renderState(accessState, { focus: true }).catch(showPageError);
  if (accessState.status === 'authorized') refreshAccess();
});

window.addEventListener('popstate', () => {
  if (!accessState) return;
  if (!isAppRoute(new URL(location.href))) return window.location.reload();
  closeDialogs();
  renderState(accessState, { focus: true }).catch(showPageError);
});

window.addEventListener('calculator-contact', (event) => { contactEmail = event.detail; updateContact(); });
window.addEventListener('calculator-access-denied', (event) => {
  renderState({ ...event.detail, status: event.detail.status === 403 ? 'denied' : 'error', message: event.detail.error });
});

try {
  accessView.innerHTML = await loadMarkup('./access.html');
  mount.replaceChildren(accessView, calculatorView);
  document.body.dataset.screen = 'access';
  bindAccessPage();
  showAccessSection('checkingAccessSection');
  await initializeAccess((state) => {
    accessState = state;
    renderState(state).catch(showPageError);
  });
} catch (error) {
  if (accessView.childElementCount) {
    showAccessSection('loginSection');
    showLoginError(error.message || 'O login está indisponível.');
  }
  else {
    mount.innerHTML = '<main class="app-loading"><p>Não foi possível abrir o site.</p><a href="mailto:eng@gabrielvc.com.br">Solicitar acesso por e-mail</a></main>';
  }
}
