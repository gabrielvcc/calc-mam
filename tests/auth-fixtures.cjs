const allApps = { complete: true, profiles: true, glass: true, wind: true };

async function mockFirebase(page, { initialUser = 'member', configured = true } = {}) {
  const profiles = {
    member: { uid: 'member', email: 'member@example.com', name: 'Usuário', admin: false, apps: { ...allApps } },
    owner: { uid: 'owner', email: 'owner@example.com', name: 'Administrador', admin: true, apps: { ...allApps } },
    limited: { uid: 'limited', email: 'limited@example.com', name: 'Usuário restrito', admin: false, apps: { ...allApps, glass: false } },
    blocked: null,
  };
  const grants = [];
  const attempts = [];
  await page.route('**/firebase-client.js', (route) => route.fulfill({ contentType: 'text/javascript', body: `
    export async function createFirebaseIdentity() {
      const key = '__test_firebase_identity';
      if (localStorage.getItem(key) === null) localStorage.setItem(key, JSON.stringify(${JSON.stringify(initialUser)}));
      let listener;
      const current = () => JSON.parse(localStorage.getItem(key));
      const notify = () => listener?.(current() ? { email: current() + '@example.com' } : null);
      window.addEventListener('storage', (event) => { if (event.key === key) notify(); });
      return {
        onChange(callback) { listener = callback; queueMicrotask(notify); },
        async token(refresh) { if (refresh) window.__testTokenRefreshes = (window.__testTokenRefreshes || 0) + 1; return current() ? 'test-' + current() : null; },
        async signIn() { localStorage.setItem(key, JSON.stringify(window.__testLoginAs || 'member')); notify(); },
        async signOut() { localStorage.setItem(key, 'null'); notify(); },
      };
    }
  ` }));

  return {
    profiles, grants, attempts,
    async handle(route) {
      const path = new URL(route.request().url()).pathname;
      if (!path.startsWith('/auth/')) return false;
      const user = (route.request().headers().authorization || '').replace('Bearer test-', '');
      const profile = profiles[user];
      if (path === '/auth/config') {
        await route.fulfill(configured ? { json: { firebase: { apiKey: 'test', authDomain: 'test.firebaseapp.com', projectId: 'test', appId: 'test' }, contactEmail: 'eng@gabrielvc.com.br' } }
          : { status: 503, json: { error: 'O login ainda não foi configurado.', code: 'auth_unavailable' } });
      } else if (!profile) {
        await route.fulfill({ status: user ? 403 : 401, json: { error: 'Seu e-mail não está autorizado.', code: 'not_allowlisted' } });
      } else if (path === '/auth/me') {
        await route.fulfill({ json: profile });
      } else if (!profile.admin) {
        await route.fulfill({ status: 403, json: { error: 'Acesso restrito ao administrador.', code: 'admin_required' } });
      } else if (path === '/auth/attempts' && route.request().method() === 'GET') {
        await route.fulfill({ json: { attempts } });
      } else if (route.request().method() === 'GET') {
        await route.fulfill({ json: { users: grants } });
      } else {
        const data = route.request().postDataJSON();
        const index = grants.findIndex((entry) => entry.email === data.email);
        const entry = { id: 'a'.repeat(64), ...data };
        if (index === -1) grants.push(entry);
        else grants[index] = entry;
        await route.fulfill({ json: entry });
      }
      return true;
    },
  };
}

module.exports = { mockFirebase };
