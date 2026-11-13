import { authorizedFetch } from './auth-client.js';

const appLabels = { complete: 'Completo', profiles: 'Perfis', glass: 'Vidro', wind: 'Vento' };

export function initializeAdmin() {
  const form = document.querySelector('#accessEditor');
  const message = document.querySelector('#adminMessage');
  const list = document.querySelector('#grantsList');
  const notify = (text, error = false) => {
    message.textContent = text;
    message.hidden = false;
    message.classList.toggle('access-error', error);
  };

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
        edit.addEventListener('click', () => {
          form.querySelector('#grantEmail').value = entry.email;
          form.querySelector('#grantActive').checked = entry.active;
          form.querySelectorAll('[name="grantApp"]').forEach((input) => { input.checked = entry.apps?.[input.value] === true; });
          form.querySelector('#grantEmail').focus();
        });
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
  load();
}
