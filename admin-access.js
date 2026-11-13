import { authorizedFetch } from './auth-client.js';

const appLabels = { complete: 'Completo', profiles: 'Perfis', glass: 'Vidro', wind: 'Vento' };
const attemptReasons = { not_allowlisted: 'E-mail não cadastrado', inactive: 'Acesso desativado', no_apps: 'Nenhuma calculadora liberada' };
const attemptDate = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

export function initializeAdmin() {
  const form = document.querySelector('#accessEditor');
  const message = document.querySelector('#adminMessage');
  const list = document.querySelector('#grantsList');
  const attemptsList = document.querySelector('#attemptsList');
  const attemptsMessage = document.querySelector('#attemptsMessage');
  let grants = [];
  const notify = (text, error = false) => {
    message.textContent = text;
    message.hidden = false;
    message.classList.toggle('access-error', error);
  };

  function editGrant(email, active, apps) {
    form.querySelector('#grantEmail').value = email;
    form.querySelector('#grantActive').checked = active;
    form.querySelectorAll('[name="grantApp"]').forEach((input) => { input.checked = apps?.[input.value] === true; });
    form.querySelector('#grantEmail').focus();
  }

  async function save(email, active, apps) {
    const response = await authorizedFetch('/auth/access', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, active, apps }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Não foi possível salvar o acesso.');
  }

  async function load() {
    try {
      const response = await authorizedFetch('/auth/access');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Não foi possível carregar os acessos.');
      grants = data.users;
      list.replaceChildren();
      if (!data.users.length) {
        const row = list.insertRow();
        const cell = row.insertCell();
        cell.colSpan = 4;
        cell.textContent = 'Nenhum e-mail cadastrado.';
      }
      data.users.forEach((entry) => {
        const row = list.insertRow();
        row.insertCell().textContent = entry.email;
        row.insertCell().textContent = entry.active ? 'Ativo' : 'Desativado';
        row.insertCell().textContent = Object.keys(appLabels).filter((key) => entry.apps?.[key] === true).map((key) => appLabels[key]).join(', ') || 'Nenhuma';
        const actions = row.insertCell();
        const edit = document.createElement('button');
        edit.type = 'button'; edit.className = 'secondary-btn'; edit.textContent = 'Editar';
        edit.addEventListener('click', () => editGrant(entry.email, entry.active, entry.apps));
        const toggle = document.createElement('button');
        toggle.type = 'button'; toggle.className = 'secondary-btn'; toggle.textContent = entry.active ? 'Desativar' : 'Ativar';
        toggle.addEventListener('click', async () => {
          toggle.disabled = true;
          try { await save(entry.email, !entry.active, entry.apps || {}); await load(); notify('Permissão atualizada.'); }
          catch (error) { notify(error.message, true); }
          finally { toggle.disabled = false; }
        });
        actions.append(edit, toggle);
      });
    } catch (error) { notify(error.message, true); }
  }

  async function loadAttempts() {
    const button = document.querySelector('#reloadAttemptsBtn');
    button.disabled = true;
    attemptsMessage.hidden = true;
    try {
      const response = await authorizedFetch('/auth/attempts');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Não foi possível carregar as tentativas.');
      attemptsList.replaceChildren();
      if (!data.attempts.length) {
        const cell = attemptsList.insertRow().insertCell();
        cell.colSpan = 5;
        cell.textContent = 'Nenhuma tentativa sem acesso registrada.';
      }
      data.attempts.forEach((entry) => {
        const row = attemptsList.insertRow();
        const account = document.createElement('div');
        account.className = 'attempt-account';
        const name = document.createElement('strong');
        name.textContent = entry.name || 'Nome não informado';
        const email = document.createElement('span');
        email.textContent = entry.email;
        account.append(name, email);
        row.insertCell().append(account);
        const time = document.createElement('time');
        const date = entry.last_attempt_at ? new Date(entry.last_attempt_at) : null;
        if (date && !Number.isNaN(date.getTime())) {
          time.dateTime = entry.last_attempt_at;
          time.textContent = attemptDate.format(date);
        } else time.textContent = '-';
        row.insertCell().append(time);
        row.insertCell().textContent = entry.attempts;
        row.insertCell().textContent = attemptReasons[entry.reason] || 'Sem autorização';
        const configure = document.createElement('button');
        configure.type = 'button';
        configure.className = 'secondary-btn attempt-configure';
        const icon = document.createElement('i');
        icon.dataset.lucide = 'user-plus';
        icon.setAttribute('aria-hidden', 'true');
        configure.append(icon, 'Configurar acesso');
        configure.addEventListener('click', () => editGrant(entry.email, true, grants.find((grant) => grant.email === entry.email)?.apps));
        row.insertCell().append(configure);
      });
      window.lucide?.createIcons();
    } catch (error) {
      attemptsMessage.textContent = error.message;
      attemptsMessage.hidden = false;
      if (attemptsList.textContent.includes('Carregando tentativas...')) attemptsList.replaceChildren();
    } finally { button.disabled = false; }
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = document.querySelector('#saveGrantBtn');
    button.disabled = true;
    const apps = Object.fromEntries([...form.querySelectorAll('[name="grantApp"]')].map((input) => [input.value, input.checked]));
    try {
      await save(form.querySelector('#grantEmail').value.trim(), form.querySelector('#grantActive').checked, apps);
      await load(); notify('Permissão salva.');
    } catch (error) { notify(error.message, true); }
    finally { button.disabled = false; }
  });
  form.addEventListener('reset', () => { message.hidden = true; });
  document.querySelector('#reloadGrantsBtn').addEventListener('click', load);
  document.querySelector('#reloadAttemptsBtn').addEventListener('click', loadAttempts);
  load();
  loadAttempts();
}
