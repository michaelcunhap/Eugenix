'use strict';

const STORAGE_KEY = 'eugenix.registros.v1';
const FIELDS = { encargos: ['nome', 'portaria', 'inicio', 'fim'], docentes: ['nome', 'colegiado'] };
const TYPES = Object.keys(FIELDS);
const byId = id => document.getElementById(id);
const normalized = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').trim();
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const statusOf = item => item.inicio > today() ? 'programado' : item.fim < today() ? 'encerrado' : 'vigente';
const dateLabel = value => validDate(value) ? value.slice(8, 10) + '/' + value.slice(5, 7) + '/' + value.slice(0, 4) : '—';
const parseDate = value => {
  const parts = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!parts) return '';
  const iso = `${parts[3]}-${parts[2]}-${parts[1]}`;
  return validDate(iso) ? iso : '';
};
const maskDate = value => {
  const digits = value.replace(/\D/g, '').slice(0, 8);
  return [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4)].filter(Boolean).join('/');
};
const newId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;

function loadData() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (TYPES.every(kind => Array.isArray(saved?.[kind]))) {
      return {
        encargos: saved.encargos.filter(x => x && typeof x.id === 'string' && typeof x.nome === 'string' && typeof x.portaria === 'string' && validDate(x.inicio) && validDate(x.fim)),
        docentes: saved.docentes.filter(x => x && typeof x.id === 'string' && typeof x.nome === 'string' && typeof x.colegiado === 'string')
      };
    }
  } catch (_) {}
  return { encargos: [], docentes: [] };
}

const data = loadData();
const editing = { encargos: null, docentes: null };
let pendingDelete = null;
let noticeTimer;

function notify(message) {
  const el = byId('notice');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { el.hidden = true; }, 2800);
}

function store() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch (_) {
    notify('Não foi possível salvar o registro');
    return false;
  }
}

function filtered(kind) {
  const search = normalized(byId(`${kind}-search`).value);
  const filter = byId(`${kind}-filter`).value;
  return data[kind].filter(row => {
    const label = normalized(FIELDS[kind].map(field => kind === 'encargos' && ['inicio', 'fim'].includes(field) ? dateLabel(row[field]) : row[field]).join(' '));
    return label.includes(search) && (filter === 'todos' || (kind === 'encargos' ? statusOf(row) : normalized(row.colegiado)) === filter);
  }).sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
}

function renderFilters() {
  const select = byId('docentes-filter');
  const current = select.value;
  const colegiados = [...new Set(data.docentes.map(row => row.colegiado.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  select.innerHTML = '<option value="todos">Todos os colegiados</option>' + colegiados.map(value => `<option value="${escapeHtml(normalized(value))}">${escapeHtml(value)}</option>`).join('');
  select.value = [...select.options].some(option => option.value === current) ? current : 'todos';
}

function itemHtml(kind, row) {
  const id = escapeHtml(row.id);
  const name = escapeHtml(row.nome);
  const buttons = `<div class="item-actions"><button type="button" data-action="edit" data-kind="${kind}" data-id="${id}" aria-label="Editar ${name}">Editar</button><button type="button" class="remove" data-action="delete" data-kind="${kind}" data-id="${id}" aria-label="Excluir ${name}">Excluir</button></div>`;
  const info = kind === 'docentes' ? escapeHtml(row.colegiado) : `Portaria ${escapeHtml(row.portaria)}<br>Vigência: ${dateLabel(row.inicio)} a ${dateLabel(row.fim)}`;
  const status = kind === 'encargos' ? `<span class="item-status ${statusOf(row)}">${{ vigente: 'Vigente', programado: 'Programado', encerrado: 'Encerrado' }[statusOf(row)]}</span>` : '';
  return `<article class="item"><div class="item-top"><div class="item-name">${name}</div>${buttons}</div><div class="item-info">${info}</div>${status}</article>`;
}

function renderKind(kind) {
  const rows = filtered(kind);
  const searching = byId(`${kind}-search`).value.trim() || byId(`${kind}-filter`).value !== 'todos';
  byId(`${kind}-count`).textContent = data[kind].length;
  byId(`${kind}-list`).innerHTML = rows.length ? rows.map(row => itemHtml(kind, row)).join('') : `<div class="empty">${searching ? 'Nenhum resultado encontrado' : `Nenhum ${kind === 'encargos' ? 'encargo' : 'docente'} cadastrado`}</div>`;
  byId(`${kind}-footer`).textContent = `${rows.length} ${rows.length === 1 ? 'registro' : 'registros'}`;
}

function render() {
  renderFilters();
  TYPES.forEach(renderKind);
}

function closeForm(kind) {
  editing[kind] = null;
  closeCalendar();
  byId(`${kind}-form-wrap`).hidden = true;
  byId(`${kind}-error`).hidden = true;
}

function showForm(kind, id = null) {
  const row = id ? data[kind].find(item => item.id === id) : null;
  if (id && !row) return notify('Registro não encontrado');
  editing[kind] = row?.id ?? null;
  const form = byId(`${kind}-form`);
  form.reset();
  byId(`${kind}-error`).hidden = true;
  if (row) FIELDS[kind].forEach(field => { form.elements.namedItem(field).value = kind === 'encargos' && ['inicio', 'fim'].includes(field) ? dateLabel(row[field]) : row[field]; });
  byId(`${kind}-form-title`).textContent = `${row ? 'Editar' : 'Novo'} ${kind === 'encargos' ? 'encargo' : 'docente'}`;
  byId(`${kind}-form-wrap`).hidden = false;
  byId(`${kind}-nome`).focus();
}

function validate(kind, row) {
  if (row.nome.length < 3) return ['Informe um nome com pelo menos 3 caracteres', 'nome'];
  if (kind === 'docentes') return row.colegiado.length < 2 ? ['Informe o colegiado', 'colegiado'] : null;
  if (!row.portaria) return ['Informe o número da portaria', 'portaria'];
  if (!validDate(row.inicio)) return ['Informe uma data de início válida no formato dd/mm/aaaa', 'inicio'];
  if (!validDate(row.fim)) return ['Informe uma data de fim válida no formato dd/mm/aaaa', 'fim'];
  return row.fim < row.inicio ? ['A data final deve ser igual ou posterior à inicial', 'fim'] : null;
}

function save(kind, event) {
  event.preventDefault();
  const form = byId(`${kind}-form`);
  const values = Object.fromEntries(FIELDS[kind].map(field => [field, String(form.elements.namedItem(field).value).trim()]));
  if (kind === 'encargos') ['inicio', 'fim'].forEach(field => { values[field] = parseDate(values[field]); });
  const error = validate(kind, values);
  if (error) {
    const message = byId(`${kind}-error`);
    message.textContent = error[0];
    message.hidden = false;
    byId(`${kind}-${error[1]}`).focus();
    return;
  }
  const index = editing[kind] ? data[kind].findIndex(row => row.id === editing[kind]) : -1;
  if (editing[kind] && index < 0) return notify('Registro não encontrado');
  const old = data[kind][index];
  const now = new Date().toISOString();
  const record = { ...old, ...values, id: old?.id ?? newId(), createdAt: old?.createdAt ?? now, updatedAt: now };
  if (index < 0) data[kind].push(record);
  else data[kind][index] = record;
  if (!store()) {
    if (index < 0) data[kind].pop();
    else data[kind][index] = old;
    return;
  }
  closeForm(kind);
  render();
  notify(index < 0 ? 'Registro adicionado' : 'Registro atualizado');
}

function askDelete(kind, id) {
  const row = data[kind].find(item => item.id === id);
  if (!row) return notify('Registro não encontrado');
  pendingDelete = { kind, id };
  byId('confirm-message').textContent = `Confirme a exclusão de: "${row.nome}"\nEsta ação não poderá ser revertida`;
  byId('confirm-dialog').showModal();
}

function confirmDelete() {
  if (!pendingDelete) return;
  const { kind, id } = pendingDelete;
  const previous = data[kind];
  data[kind] = previous.filter(row => row.id !== id);
  if (!store()) {
    data[kind] = previous;
    return;
  }
  byId('confirm-dialog').close();
  render();
  notify('Registro excluído');
}

let calendarInput = null;
let calendarMonth;

function closeCalendar() {
  if (calendarInput) calendarInput.parentElement.querySelector('.calendar-button').setAttribute('aria-expanded', 'false');
  byId('date-calendar')?.remove();
  calendarInput = null;
}

function positionCalendar() {
  const popup = byId('date-calendar');
  if (!calendarInput || !popup) return;
  const field = calendarInput.parentElement.getBoundingClientRect();
  const width = popup.offsetWidth;
  const height = popup.offsetHeight;
  const margin = 12;
  const gap = 8;
  const viewportWidth = document.documentElement.clientWidth;
  const viewportHeight = window.innerHeight;
  const left = calendarInput.id.endsWith('fim') ? field.right - width : field.left;
  const roomBelow = viewportHeight - field.bottom - gap;
  const roomAbove = field.top - gap;
  const top = roomBelow >= height || roomBelow >= roomAbove ? field.bottom + gap : field.top - height - gap;
  popup.style.left = `${Math.max(margin, Math.min(left, viewportWidth - width - margin))}px`;
  popup.style.top = `${Math.max(margin, Math.min(top, viewportHeight - height - margin))}px`;
}

function renderCalendar() {
  const year = calendarMonth.getFullYear();
  const month = calendarMonth.getMonth();
  const selected = parseDate(calendarInput.value);
  const firstDay = (new Date(year, month, 1).getDay() + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  const title = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(calendarMonth);
  const cells = Array.from({ length: firstDay }, () => '<span></span>');
  for (let day = 1; day <= days; day++) {
    const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    cells.push(`<button type="button" data-calendar-date="${iso}" aria-label="Escolher ${dateLabel(iso)}" aria-pressed="${iso === selected}" ${iso === today() ? 'aria-current="date"' : ''}>${day}</button>`);
  }
  byId('date-calendar').innerHTML = `<div class="calendar-header"><button type="button" data-calendar-month="-1" aria-label="Mês anterior">‹</button><span>${title}</span><button type="button" data-calendar-month="1" aria-label="Próximo mês">›</button></div><div class="calendar-grid">${['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'].map(label => `<span>${label}</span>`).join('')}${cells.join('')}</div>`;
  positionCalendar();
}

function toggleCalendar(id) {
  const input = byId(id);
  if (calendarInput === input) return closeCalendar();
  closeCalendar();
  calendarInput = input;
  const date = parseDate(input.value) || today();
  calendarMonth = new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, 1);
  const popup = document.createElement('div');
  popup.id = 'date-calendar';
  popup.className = 'date-calendar';
  popup.setAttribute('role', 'group');
  popup.setAttribute('aria-label', 'Calendário');
  document.body.appendChild(popup);
  input.parentElement.querySelector('.calendar-button').setAttribute('aria-expanded', 'true');
  renderCalendar();
}

['encargos-inicio', 'encargos-fim'].forEach(id => {
  byId(id).addEventListener('input', event => { event.target.value = maskDate(event.target.value); });
});

byId('start-button').addEventListener('click', () => {
  byId('boas-vindas').hidden = true;
  byId('app-header').hidden = false;
  byId('inicio').hidden = false;
  window.scrollTo(0, 0);
});

TYPES.forEach(kind => {
  byId(`${kind}-search`).addEventListener('input', () => renderKind(kind));
  byId(`${kind}-filter`).addEventListener('change', () => renderKind(kind));
  byId(`${kind}-form`).addEventListener('submit', event => save(kind, event));
});

document.addEventListener('click', event => {
  const calendarButton = event.target.closest('[data-calendar-for]');
  if (calendarButton) return toggleCalendar(calendarButton.dataset.calendarFor);
  const monthButton = event.target.closest('[data-calendar-month]');
  if (monthButton) {
    calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + Number(monthButton.dataset.calendarMonth), 1);
    return renderCalendar();
  }
  const dayButton = event.target.closest('[data-calendar-date]');
  if (dayButton) {
    calendarInput.value = dateLabel(dayButton.dataset.calendarDate);
    calendarInput.dispatchEvent(new Event('input', { bubbles: true }));
    closeCalendar();
    return;
  }
  if (calendarInput && !event.target.closest('.date-control, #date-calendar')) closeCalendar();
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const { action, kind, id } = button.dataset;
  if (!TYPES.includes(kind)) return;
  if (action === 'new') showForm(kind);
  if (action === 'edit') showForm(kind, id);
  if (action === 'cancel') closeForm(kind);
  if (action === 'delete') askDelete(kind, id);
});

document.addEventListener('keydown', event => { if (event.key === 'Escape') closeCalendar(); });
window.addEventListener('resize', positionCalendar);
window.addEventListener('scroll', positionCalendar, true);

const dialog = byId('confirm-dialog');
byId('confirm-cancel').addEventListener('click', () => dialog.close());
byId('confirm-yes').addEventListener('click', confirmDelete);
dialog.addEventListener('close', () => { pendingDelete = null; });
dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
render();
