const root = document.querySelector('#health-view');
const $ = selector => root.querySelector(selector);
const api = `${window.allinoneApiBase || ''}/api/modules/health`;
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
let people = [], columns = [], person = null, records = [], loadVersion = 0;
let editing = null, editingPerson = null, configPerson = null;
let savingFocus = false;
const hiddenRows = new Map();
let rowAction = null;
function hiddenFor(id) {
  if (!hiddenRows.has(id)) hiddenRows.set(id, new Set());
  return hiddenRows.get(id);
}

async function request(path, options = {}) {
  const response = await fetch(`${api}${path}`, { ...options, credentials: 'include', headers: options.body ? { 'Content-Type': 'application/json' } : undefined });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `请求失败（${response.status}）`);
  return data;
}
const write = (path, method, body) => request(path, { method, body: JSON.stringify(body) });
function message(text) { $('#health-status').textContent = text; }
function actions(enabled) { root.querySelectorAll('[data-health-ready]').forEach(button => { button.disabled = !enabled; }); }
function render() {
  const shown = columns.filter(column => column.id === 'c0' || person.visible.includes(column.id));
  const focused = person.focused || [];
  const isEmpty = value => value == null || /^[\s\-－—–−]*$/u.test(String(value));
  const matching = person.hideEmpty && focused.length ? records.filter(row => !focused.every(id => isEmpty(row.cells[id]))) : records;
  const hidden = hiddenFor(person.id);
  for (const id of hidden) if (!records.some(row => row.id === id)) hidden.delete(id);
  const filtered = matching.filter(row => !hidden.has(row.id));
  $('#health-reset-hidden').hidden = !hidden.size;
  $('#health-reset-hidden').textContent = `恢复隐藏行（${hidden.size}）`;
  const container = $('#health-table'), { scrollLeft, scrollTop } = container;
  $('#health-hide-empty').checked = Boolean(person.hideEmpty);
  $('#health-focus-note').textContent = focused.length ? `已关注 ${focused.length} 列` : '点击列名旁的星标，关注常看的指标';
  $('#health-focus-note').title = columns.filter(c => focused.includes(c.id)).map(c => c.label).join('、') + '（未显示的关注列也参与筛选）';
  const width = c => c.id === 'c1' ? 196 : ['c10', 'c11', 'c13', 'c14', 'c17', 'c18', 'c37', 'c38'].includes(c.id) ? 288 : 140;
  const heading = c => {
    const match = /^(.*)（([^（）]+)）$/.exec(c.label);
    return match ? `<span>${escape(match[1])}<small>${escape(match[2])}</small></span>` : `<span>${escape(c.label)}</span>`;
  };
  const cell = (row, c) => {
    const value = row.cells[c.id];
    if (c.id === 'c0') return `<td class="health-date"><span class="health-date-value">${escape(value)}</span><button class="health-row-edit" type="button" data-edit="${row.id}" aria-label="编辑 ${escape(value)} 的记录"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15z"/></svg>编辑</button><button class="health-row-more" type="button" data-row-more="${row.id}" aria-label="${escape(value)} 的更多操作：临时隐藏或删除" title="临时隐藏或删除">···</button></td>`;
    if (isEmpty(value)) return '<td class="health-missing"><span>—</span></td>';
    const text = String(value), long = text.length > 65 || text.split('\n').length > 3;
    const contentId = `health-cell-${row.id}-${c.id}`;
    return `<td class="${typeof value === 'number' ? 'health-number' : ''}"><div class="health-cell-copy${long ? ' is-collapsed' : ''}" id="${contentId}">${escape(text)}</div>${long ? `<button class="health-expand" type="button" data-expand aria-expanded="false" aria-controls="${contentId}" aria-label="展开 ${escape(c.label)} 的完整内容">展开全文</button>` : ''}</td>`;
  };
  container.innerHTML = `<table style="width:calc(var(--health-date-width) + ${shown.filter(c => c.id !== 'c0').reduce((sum, c) => sum + width(c), 0)}px)"><caption class="health-sr">${escape(person.name)}的健康记录</caption><colgroup>${shown.map(c => `<col style="width:${c.id === 'c0' ? 'var(--health-date-width)' : `${width(c)}px`}">`).join('')}</colgroup><thead><tr>${shown.map(c => `<th scope="col" class="${c.id === 'c0' ? 'health-date' : ''}${focused.includes(c.id) ? ' is-focused' : ''}"><div class="health-column-heading">${heading(c)}<button class="health-focus-button" type="button" data-focus="${c.id}" aria-pressed="${focused.includes(c.id)}" aria-label="${focused.includes(c.id) ? '取消关注' : '关注'} ${escape(c.label)}" title="${focused.includes(c.id) ? '取消关注' : '设为关注列'}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z"/></svg></button></div></th>`).join('')}</tr></thead><tbody>${filtered.map(row => `<tr>${shown.map(c => cell(row, c)).join('')}</tr>`).join('') || `<tr><td colspan="${shown.length}" class="health-empty">${records.length ? '暂无可见记录，可点击“恢复隐藏行”或关闭关注列空行筛选。' : '还没有健康记录，点击“新增记录”开始填写。'}</td></tr>`}</tbody></table>`;
  container.scrollLeft = scrollLeft; container.scrollTop = scrollTop;
  message(`共 ${records.length} 条 · 当前 ${filtered.length} 条${records.length > filtered.length ? ` · 已隐藏 ${records.length - filtered.length} 条` : ''}${hidden.size ? ` · 手动隐藏 ${hidden.size} 条` : ''} · ${shown.length} 个字段`);
}
async function saveFocus(change) {
  if (!person || savingFocus) return;
  const selected = person, version = loadVersion;
  savingFocus = true;
  $('#health-hide-empty').disabled = true; $('#health-columns').disabled = true;
  root.querySelectorAll('[data-focus]').forEach(button => { button.disabled = true; });
  try {
    const data = await write(`/people/${selected.id}/config`, 'PUT', { ...change, revision: selected.revision });
    if (version === loadVersion && person?.id === selected.id) { person = data.person; render(); }
  } catch (error) {
    if (version === loadVersion && person?.id === selected.id) { render(); message(error.message); }
  } finally {
    savingFocus = false;
    $('#health-hide-empty').disabled = !person; $('#health-columns').disabled = !person;
    root.querySelectorAll('[data-focus]').forEach(button => { button.disabled = false; });
  }
}
$('#health-hide-empty').addEventListener('change', event => saveFocus({ hideEmpty: event.target.checked }));
async function loadPerson(id) {
  const version = ++loadVersion;
  person = null; records = []; actions(false);
  $('#health-reset-hidden').hidden = true;
  $('#health-table').innerHTML = '<div class="empty-state">正在读取健康数据…</div>';
  message('正在读取…');
  try {
    const data = await request(`/people/${id}`);
    if (version !== loadVersion) return;
    person = data.person; columns = data.columns; records = data.records;
    localStorage.setItem('allinone-health-person', String(person.id));
    actions(true); render();
  } catch (error) {
    if (version !== loadVersion) return;
    message(error.message); $('#health-table').innerHTML = '<div class="empty-state">读取失败，请点击刷新重试。</div>';
  }
}
async function load(preferred) {
  const version = ++loadVersion;
  actions(false); $('#health-person').disabled = true; message('正在读取人员…');
  try {
    const data = await request('/people');
    if (version !== loadVersion) return;
    people = data.people; columns = data.columns;
    const id = preferred || $('#health-person').value || localStorage.getItem('allinone-health-person');
    const selected = people.find(p => String(p.id) === String(id)) || people[0];
    $('#health-person').innerHTML = people.map(p => `<option value="${p.id}">${escape(p.name)}</option>`).join('') || '<option value="">请添加人员</option>';
    $('#health-person').disabled = !people.length;
    if (selected) { $('#health-person').value = selected.id; await loadPerson(selected.id); }
    else { person = null; records = []; message('暂无人员'); $('#health-table').innerHTML = '<div class="empty-state">先添加人员，再填写健康记录。</div>'; }
  } catch (error) { message(error.message); $('#health-table').innerHTML = '<div class="empty-state">读取失败，请点击刷新重试。</div>'; }
}

function openEditor(row = null) {
  if (!person) return;
  editing = row; editingPerson = { id: person.id, name: person.name };
  $('#health-edit-title').textContent = `${row ? '编辑记录' : '新增记录'} · ${person.name}`;
  $('#health-edit-error').textContent = '';
  $('#health-field-search').value = '';
  const cells = row?.cells || {};
  const date = cells.c0 || '';
  const uncertain = date && !/^\d{4}-\d{2}-\d{2}$/.test(date);
  $('#health-fields').innerHTML = columns.map(c => `<label class="health-field" data-label="${escape(c.label.toLowerCase())}"><span>${escape(c.label)}</span>${c.id === 'c0' ? `<input name="c0" type="${uncertain ? 'text' : 'date'}" value="${escape(date)}" required maxlength="120"><small>不完整日期可保留原精度和括号说明</small>` : `<textarea name="${c.id}" rows="${['c1','c37','c38'].includes(c.id) || c.id.match(/^c1[0-9]$/) ? 3 : 1}" maxlength="10000">${escape(cells[c.id])}</textarea>`}</label>`).join('');
  $('#health-uncertain-date').checked = Boolean(uncertain);
  $('#health-edit-dialog').showModal();
}
$('#health-person').addEventListener('change', event => loadPerson(event.target.value));
$('#health-refresh').addEventListener('click', () => load());
$('#health-add-person').addEventListener('click', () => { $('#health-person-form').reset(); $('#health-person-error').textContent = ''; $('#health-person-dialog').showModal(); });
$('#health-add-record').addEventListener('click', () => openEditor());
$('#health-reset-hidden').addEventListener('click', () => {
  if (!person) return;
  hiddenFor(person.id).clear(); render();
});
$('#health-hide-row').addEventListener('click', () => {
  if (!rowAction || person?.id !== rowAction.personId) return;
  hiddenFor(rowAction.personId).add(rowAction.row.id);
  $('#health-row-dialog').close(); render();
});
$('#health-delete-row').addEventListener('click', async event => {
  if (!rowAction) return;
  const selected = rowAction, version = loadVersion;
  if (!confirm(`删除 ${selected.name} 在 ${selected.row.cells.c0} 的这条记录？\n来源：${selected.row.cells.c1 || '未填写'}\n记录编号：${selected.row.id}\n删除后无法通过“恢复隐藏行”找回。`)) return;
  const button = event.currentTarget;
  button.disabled = true; $('#health-hide-row').disabled = true;
  $('#health-row-error').textContent = '';
  try {
    await write(`/people/${selected.personId}/records/${selected.row.id}`, 'DELETE', { revision: selected.row.revision });
    hiddenFor(selected.personId).delete(selected.row.id);
    if (rowAction === selected) $('#health-row-dialog').close();
    if (person?.id === selected.personId && version === loadVersion) {
      records = records.filter(row => row.id !== selected.row.id); render();
    }
  } catch (error) {
    if (rowAction === selected) $('#health-row-error').textContent = error.message;
  } finally { button.disabled = false; $('#health-hide-row').disabled = false; }
});
$('#health-table').addEventListener('click', event => {
  const more = event.target.closest('[data-row-more]');
  if (more && person) {
    const row = records.find(item => item.id === Number(more.dataset.rowMore));
    if (!row) return;
    rowAction = { row, personId: person.id, name: person.name };
    $('#health-row-description').textContent = `${person.name} · ${row.cells.c0} · ${row.cells.c1 || '来源未填写'}（记录 ${row.id}）`;
    $('#health-row-error').textContent = '';
    $('#health-row-dialog').showModal(); return;
  }
  const expand = event.target.closest('[data-expand]');
  if (expand) {
    const expanded = expand.getAttribute('aria-expanded') !== 'true';
    expand.setAttribute('aria-expanded', String(expanded));
    expand.textContent = expanded ? '收起' : '展开全文';
    expand.setAttribute('aria-label', expanded ? '收起完整内容' : '展开完整内容');
    expand.previousElementSibling.classList.toggle('is-collapsed', !expanded);
    return;
  }
  const focusButton = event.target.closest('[data-focus]');
  if (focusButton && person) {
    const id = focusButton.dataset.focus, focused = person.focused || [];
    saveFocus({ focused: focused.includes(id) ? focused.filter(value => value !== id) : [...focused, id] });
    return;
  }
  const button = event.target.closest('[data-edit]');
  if (button) openEditor(records.find(row => row.id === Number(button.dataset.edit)));
});
root.querySelectorAll('[data-health-close]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
$('#health-person-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = event.submitter; button.disabled = true;
  try {
    const data = await write('/people', 'POST', { name: $('#health-person-name').value });
    $('#health-person-dialog').close(); await load(data.person.id);
  } catch (error) { $('#health-person-error').textContent = error.message; }
  finally { button.disabled = false; }
});
$('#health-uncertain-date').addEventListener('change', event => {
  const input = $('#health-fields [name="c0"]');
  if (!event.target.checked && input.value && !/^\d{4}-\d{2}-\d{2}$/.test(input.value)) {
    event.target.checked = true; $('#health-edit-error').textContent = '请先填写确定的 YYYY-MM-DD，再切换日期选择器。'; return;
  }
  input.type = event.target.checked ? 'text' : 'date'; input.placeholder = 'YYYY / YYYY-MM / YYYY-MM-DD（说明）';
});
$('#health-field-search').addEventListener('input', event => {
  const query = event.target.value.trim().toLowerCase();
  $('#health-fields').querySelectorAll('.health-field').forEach(label => { label.hidden = !label.querySelector('[name="c0"]') && !label.dataset.label.includes(query); });
});
$('#health-edit-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = event.submitter; button.disabled = true; $('#health-edit-error').textContent = '';
  try {
    const values = new FormData(event.target), cells = {};
    for (const c of columns) {
      const value = String(values.get(c.id) ?? '');
      const original = editing?.cells[c.id];
      // 未修改的数字与空单元格保持原类型，避免编辑备注时改写其他数据。
      cells[c.id] = value === String(original ?? '') ? original ?? null : value === '' ? null : /^-?\d+(?:\.\d+)?$/.test(value) && c.id !== 'c0' ? Number(value) : value;
    }
    await write(`/people/${editingPerson.id}/records${editing ? `/${editing.id}` : ''}`, editing ? 'PUT' : 'POST', { cells, revision: editing?.revision });
    $('#health-edit-dialog').close(); await loadPerson(editingPerson.id);
  } catch (error) { $('#health-edit-error').textContent = error.message; }
  finally { button.disabled = false; }
});

$('#health-columns').addEventListener('click', () => {
  configPerson = { ...person };
  $('#health-columns-error').textContent = '';
  $('#health-columns-list').innerHTML = columns.map(c => `<label><input type="checkbox" name="visible" value="${c.id}"${c.id === 'c0' ? ' checked disabled' : person.visible.includes(c.id) ? ' checked' : ''}><span>${escape(c.label)}${c.id === 'c0' ? ' · 固定' : ''}</span></label>`).join('');
  $('#health-columns-dialog').showModal();
});
$('#health-select-all').addEventListener('click', () => $('#health-columns-list').querySelectorAll('input').forEach(input => { input.checked = true; }));
$('#health-select-basic').addEventListener('click', () => $('#health-columns-list').querySelectorAll('input').forEach(input => { input.checked = ['c0', 'c1', 'c2', 'c3', 'c4', 'c5'].includes(input.value); }));
$('#health-columns-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = event.submitter; button.disabled = true;
  try {
    const visible = ['c0', ...new FormData(event.target).getAll('visible').filter(id => id !== 'c0')];
    if (!visible.length) throw new Error('请至少选择一列');
    const data = await write(`/people/${configPerson.id}/config`, 'PUT', { visible, revision: configPerson.revision });
    person = data.person; render(); $('#health-columns-dialog').close();
  } catch (error) { $('#health-columns-error').textContent = error.message; }
  finally { button.disabled = false; }
});
$('#health-export').addEventListener('click', async event => {
  const button = event.currentTarget, selectedPerson = person;
  button.disabled = true;
  try {
    const response = await fetch(`${api}/people/${selectedPerson.id}/export?scope=${$('#health-export-scope').value}`, { credentials: 'include' });
    if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error || '导出失败'); }
    const url = URL.createObjectURL(await response.blob()), link = document.createElement('a');
    link.href = url; link.download = `${selectedPerson.name}-健康数据.xlsx`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
    message(`已导出 ${selectedPerson.name} 的健康数据`);
  } catch (error) { message(error.message); }
  finally { button.disabled = !person; }
});
document.addEventListener('health:refresh', () => load());
if (root.classList.contains('active')) load();
