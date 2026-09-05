const apiBase = window.allinoneApiBase || '';
const $ = selector => document.querySelector(selector);
let items = [];
let sortMode = localStorage.getItem('allinone-checklist-sort') === 'pinyin' ? 'pinyin' : 'custom';
let checkedFirst = localStorage.getItem('allinone-checklist-checked-first') === '1';
let personFilter = ['全部', '爸爸', '妈妈', '赞赞', '通用'].includes(localStorage.getItem('allinone-checklist-person')) ? localStorage.getItem('allinone-checklist-person') : '全部';
const collator = new Intl.Collator('zh-CN-u-co-pinyin', { numeric: true, sensitivity: 'base' });

async function request(path = '', options = {}) {
  const response = await fetch(`${apiBase}/api/modules/checklist${path}`, { ...options, credentials: 'include', headers: options.body ? { 'Content-Type': 'application/json' } : undefined });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `请求失败（${response.status}）`);
  return data;
}
function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]); }
function notify(message) {
  const toast = $('#toast'); toast.textContent = message; toast.classList.add('show');
  clearTimeout(notify.timer); notify.timer = setTimeout(() => toast.classList.remove('show'), 2400);
}
function visibleItems() {
  const filtered = personFilter === '全部' ? items : items.filter(item => item.person === personFilter);
  const ordered = sortMode === 'pinyin' ? [...filtered].sort((a, b) => collator.compare(a.text, b.text)) : [...filtered];
  return checkedFirst ? ordered.sort((a, b) => Number(b.checked) - Number(a.checked)) : ordered;
}
function recentRanks() {
  return new Map(items.filter(item => item.checked && item.checkedAt).sort((a, b) => new Date(b.checkedAt) - new Date(a.checkedAt)).slice(0, 10).map((item, index) => [item.id, index + 1]));
}
function render() {
  const shown = personFilter === '全部' ? items : items.filter(item => item.person === personFilter);
  const done = shown.filter(item => item.checked).length;
  $('#checklist-scope-name').textContent = personFilter === '全部' ? '全部清单' : `${personFilter}的清单`;
  $('#checklist-total-value').textContent = shown.length;
  $('#checklist-selected-value').textContent = done;
  document.querySelectorAll('[data-checklist-sort]').forEach(button => button.classList.toggle('active', button.dataset.checklistSort === sortMode));
  document.querySelectorAll('[data-checklist-person]').forEach(button => { const person = button.dataset.checklistPerson; button.classList.toggle('active', person === personFilter); const count = person === '全部' ? items.length : items.filter(item => item.person === person).length; button.innerHTML = `${person}<small>${count}</small>`; });
  $('#checklist-checked-first').checked = checkedFirst;
  $('#checklist-hint').textContent = sortMode === 'custom' ? '自定义排序下，按住右侧把手拖动条目。' : '当前按中文拼音排序；切回自定义可拖动调整。';
  const list = $('#checklist-list'), ranks = recentRanks();
  list.classList.toggle('can-sort', sortMode === 'custom');
  list.innerHTML = visibleItems().map(item => { const rank = ranks.get(item.id); return `<article class="checklist-item${item.checked ? ' checked' : ''}${rank ? ' recently-checked' : ''}" data-id="${item.id}"><button class="checklist-check" type="button" data-check aria-label="${item.checked ? '取消划掉' : '划掉'} ${escapeHtml(item.text)}"><span>✓</span></button><button class="checklist-text" type="button" data-check><span>${escapeHtml(item.text)}</span>${rank ? `<em title="最近第 ${rank} 个划掉">${rank}</em>` : ''}</button><select class="checklist-person-select" data-person aria-label="${escapeHtml(item.text)}的归属人">${['通用', '爸爸', '妈妈', '赞赞'].map(person => `<option${person === item.person ? ' selected' : ''}>${person}</option>`).join('')}</select><button class="checklist-delete" type="button" data-delete aria-label="删除 ${escapeHtml(item.text)}">×</button><span class="checklist-drag" data-drag aria-label="拖动排序">⠿</span></article>`; }).join('') || `<div class="empty-state">${personFilter === '全部' ? '还没有条目，在上方添加出门要带的物品' : `${personFilter}还没有清单条目`}</div>`;
}
async function load() { try { items = (await request()).items || []; render(); } catch (error) { $('#checklist-list').innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`; } }

$('#checklist-add-form').addEventListener('submit', async event => {
  event.preventDefault(); const input = $('#checklist-input'), button = event.submitter; button.disabled = true;
  try { items = (await request('', { method: 'POST', body: JSON.stringify({ text: input.value, person: $('#checklist-add-person').value }) })).items; input.value = ''; render(); input.focus(); }
  catch (error) { notify(error.message); } finally { button.disabled = false; }
});
$('#checklist-list').addEventListener('click', async event => {
  const row = event.target.closest('[data-id]'); if (!row) return;
  const item = items.find(value => value.id === row.dataset.id); if (!item) return;
  if (event.target.closest('[data-check]')) {
    const next = !item.checked, previous = item.checked;
    if (next && checkedFirst) {
      row.classList.add('checked', 'checking');
      row.querySelector('.checklist-check').setAttribute('aria-label', `取消划掉 ${item.text}`);
      const shown = personFilter === '全部' ? items : items.filter(value => value.person === personFilter);
      $('#checklist-selected-value').textContent = shown.filter(value => value.checked).length + 1;
    } else { item.checked = next; item.checkedAt = next ? new Date().toISOString() : ''; render(); }
    try {
      items = (await request(`/${item.id}`, { method: 'PUT', body: JSON.stringify({ checked: next }) })).items;
      if (next && checkedFirst) setTimeout(render, 520); else render();
    } catch (error) { item.checked = previous; item.checkedAt = ''; render(); notify(error.message); }
  } else if (event.target.closest('[data-delete]')) {
    if (!confirm(`删除“${item.text}”？`)) return;
    try { items = (await request(`/${item.id}`, { method: 'DELETE' })).items; render(); }
    catch (error) { notify(error.message); }
  }
});
$('#checklist-list').addEventListener('change', async event => {
  const select = event.target.closest('[data-person]'); if (!select) return;
  const item = items.find(value => value.id === select.closest('[data-id]')?.dataset.id); if (!item) return;
  const previous = item.person; item.person = select.value;
  try { items = (await request(`/${item.id}`, { method: 'PUT', body: JSON.stringify({ person: select.value }) })).items; render(); }
  catch (error) { item.person = previous; render(); notify(error.message); }
});
document.querySelectorAll('[data-checklist-sort]').forEach(button => button.addEventListener('click', () => { sortMode = button.dataset.checklistSort; localStorage.setItem('allinone-checklist-sort', sortMode); render(); }));
document.querySelectorAll('[data-checklist-person]').forEach(button => button.addEventListener('click', () => { personFilter = button.dataset.checklistPerson; localStorage.setItem('allinone-checklist-person', personFilter); $('#checklist-add-person').value = personFilter === '全部' ? '通用' : personFilter; render(); }));
$('#checklist-checked-first').addEventListener('change', event => { checkedFirst = event.target.checked; localStorage.setItem('allinone-checklist-checked-first', checkedFirst ? '1' : '0'); render(); });
$('#checklist-reset').addEventListener('click', async () => {
  if (!items.some(item => item.checked)) return notify('当前没有已划掉的条目');
  try { items = (await request('/reset', { method: 'POST', body: '{}' })).items; render(); notify('全部条目已恢复'); }
  catch (error) { notify(error.message); }
});

let drag = null;
$('#checklist-list').addEventListener('pointerdown', event => {
  const handle = event.target.closest('[data-drag]');
  if (!handle || sortMode !== 'custom') return;
  const row = handle.closest('[data-id]');
  drag = { row, pointerId: event.pointerId };
  row.classList.add('dragging'); handle.setPointerCapture?.(event.pointerId); event.preventDefault();
});
$('#checklist-list').addEventListener('pointermove', event => {
  if (!drag || event.pointerId !== drag.pointerId) return;
  const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('.checklist-item');
  if (!target || target === drag.row || target.parentElement !== drag.row.parentElement) return;
  const rect = target.getBoundingClientRect();
  target.parentElement.insertBefore(drag.row, event.clientY < rect.top + rect.height / 2 ? target : target.nextSibling);
});
async function finishDrag(event) {
  if (!drag || event.pointerId !== drag.pointerId) return;
  drag.row.classList.remove('dragging'); drag = null;
  const visibleIds = [...document.querySelectorAll('#checklist-list [data-id]')].map(row => row.dataset.id);
  let ids = visibleIds;
  if (personFilter !== '全部') {
    let cursor = 0;
    ids = items.map(item => item.person === personFilter ? visibleIds[cursor++] : item.id);
  }
  const byId = new Map(items.map(item => [item.id, item])); items = ids.map(id => byId.get(id));
  try { items = (await request('/order', { method: 'PUT', body: JSON.stringify({ ids }) })).items; render(); }
  catch (error) { notify(error.message); await load(); }
}
$('#checklist-list').addEventListener('pointerup', finishDrag);
$('#checklist-list').addEventListener('pointercancel', finishDrag);
document.addEventListener('checklist:refresh', load);
