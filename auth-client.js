import { createFirebaseIdentity } from './firebase-client.js';

export const apiBaseUrl = 'https://api.calculoperfil.gabrielvc.com.br';
let identity = null;
let profile = null;
let currentUser = null;
let observer = null;
let stateRevision = 0;

export const getProfile = () => profile;
export const canUse = (app) => profile?.apps?.[app] === true;

export async function signIn() {
  if (!identity) throw new Error('O login está indisponível. Tente novamente em instantes.');
  await identity.signIn();
}

export async function signOut() {
  await identity?.signOut();
  window.location.replace('/');
}

export async function refreshAccess() {
  const revision = ++stateRevision;
  if (!currentUser) {
    profile = null;
    observer?.({ status: 'signed-out' });
    return;
  }
  try {
    const token = await identity.token();
    if (!token) throw new Error('Entre novamente na sua conta.');
    const response = await fetch(`${apiBaseUrl}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', credentials: 'omit',
    });
    const data = await response.json().catch(() => ({}));
    if (revision !== stateRevision) return;
    if (!response.ok) {
      profile = null;
      observer?.({ status: response.status === 403 ? 'denied' : 'error', message: data.error, code: data.code, email: currentUser.email });
      return;
    }
    profile = data;
    observer?.({ status: 'authorized', profile });
    window.dispatchEvent(new CustomEvent('calculator-permissions-changed'));
  } catch (error) {
    if (revision !== stateRevision) return;
    profile = null;
    observer?.({ status: 'error', message: error.message || 'Não foi possível conferir suas permissões.' });
  }
}

export async function initializeAccess(callback) {
  observer = callback;
  const response = await fetch(`${apiBaseUrl}/auth/config`, { cache: 'no-store', credentials: 'omit' });
  const data = await response.json().catch(() => ({}));
  if (data.contactEmail) window.dispatchEvent(new CustomEvent('calculator-contact', { detail: data.contactEmail }));
  if (!response.ok || !data.firebase) throw new Error(data.error || 'O login está indisponível. Solicite acesso pelo e-mail de contato.');
  identity = await createFirebaseIdentity(data.firebase);
  identity.onChange((user) => { currentUser = user; refreshAccess(); });
  window.addEventListener('focus', () => { if (currentUser) refreshAccess(); });
  window.setInterval(() => { if (currentUser && !document.hidden) refreshAccess(); }, 60000);
}

export async function authorizedFetch(url, options = {}, appId = null) {
  const target = new URL(url, apiBaseUrl);
  if (target.origin !== apiBaseUrl) throw new Error('Destino de API inválido.');
  let token = await identity?.token();
  if (!token) throw new Error('Entre na sua conta para continuar.');
  const headers = new Headers(options.headers);
  if (appId) headers.set('X-Calculator-App', appId);
  const send = () => {
    headers.set('Authorization', `Bearer ${token}`);
    return fetch(target, { ...options, headers, cache: 'no-store', credentials: 'omit' });
  };
  let response = await send();
  if (response.status === 401) {
    token = await identity.token(true);
    if (token) response = await send();
  }
  if (response.status === 401 || response.status === 403) {
    const data = await response.clone().json().catch(() => ({}));
    const error = new Error(data.error || 'Você não tem permissão para esta operação.');
    error.status = response.status;
    window.dispatchEvent(new CustomEvent('calculator-access-denied', { detail: { ...data, status: response.status, email: currentUser?.email } }));
    throw error;
  }
  return response;
}
