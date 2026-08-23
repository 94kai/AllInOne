const xaState = { profiles: [], controls: [], history: {}, selected: localStorage.getItem('allinone-xa-speaker') || '', mode: 'speak' };
const xaNode = id => document.getElementById(id);
const xaApiBase = ({ 'devstudio.xuekai.top': 'https://aio.xuekai.top:8888' })[location.hostname]
  || (location.port === '8787' ? `${location.protocol}//${location.hostname}:2006` : '');

async function xaRequest(url, options = {}) {
  const response = await fetch(`${xaApiBase}${url}`, { ...options, credentials: 'include', headers: options.body ? { 'Content-Type': 'application/json' } : undefined });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `请求失败（${response.status}）`);
  return data;
}
function xaEscape(value) { return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]); }
function xaToast(message) { const node = xaNode('toast'); node.textContent = message; node.classList.add('show'); setTimeout(() => node.classList.remove('show'), 2500); }
function xaProfile() { return xaState.profiles.find(item => item.id === xaState.selected); }
function xaHistory() { return xaState.history[xaState.selected] || []; }
const categoryNames = { light: '灯光', aircon: '空调', scene: '场景', custom: '其他' };
const categoryIcons = { light: '☀', aircon: '❄', scene: '◇', custom: '✦' };

function renderXaSpeakers() {
  xaNode('xa-speakers').innerHTML = xaState.profiles.map(item => `<button class="${item.id === xaState.selected ? 'active' : ''}" type="button" data-xa-speaker="${xaEscape(item.id)}"><span class="status-dot${item.speakerConnected ? '' : ' offline'}"></span><span><strong>${xaEscape(item.name)}</strong><small>${item.speakerConnected ? '已连接' : item.online ? '等待连接' : '离线'}</small></span></button>`).join('') || '<span>未配置音箱</span>';
  const volume = xaProfile()?.volume ?? 30; xaNode('xa-volume').value = volume; xaNode('xa-volume-value').value = volume;
}
function renderXaHistory() {
  const items = xaHistory(); xaNode('xa-clear-history').hidden = items.length === 0;
  xaNode('xa-history').innerHTML = items.map((item, index) => `<button type="button" data-xa-history="${index}"><span>${xaEscape(item.text)}</span><em>${item.mode === 'speak' ? '播报' : '指令'}</em></button>`).join('') || '<span>还没有历史记录</span>';
}
function renderXaControls() {
  xaNode('xa-controls').innerHTML = xaState.controls.map(item => `<article class="xa-control">
    <div class="xa-control-icon ${xaEscape(item.category)}">${categoryIcons[item.category] || categoryIcons.custom}</div>
    <div class="xa-control-copy"><small>${categoryNames[item.category] || categoryNames.custom}</small><strong>${xaEscape(item.name)}</strong></div>
    <div class="xa-control-actions">${item.mode === 'pair'
      ? `<button type="button" data-xa-run="${xaEscape(item.id)}" data-operation="on">${xaEscape(item.onLabel)}</button><button type="button" data-xa-run="${xaEscape(item.id)}" data-operation="off">${xaEscape(item.offLabel)}</button>`
      : `<button class="primary" type="button" data-xa-run="${xaEscape(item.id)}" data-operation="action">执行</button>`}</div>
    <button class="xa-edit" type="button" data-xa-configure="${xaEscape(item.id)}" aria-label="编辑 ${xaEscape(item.name)}">•••</button>
  </article>`).join('') || '<div class="xa-empty"><span>还没有快捷设备，点击添加进行配置</span></div>';
}
function setXaMode(mode) {
  xaState.mode = mode === 'speak' ? 'speak' : 'ask';
  document.querySelectorAll('[data-xa-mode]').forEach(node => node.classList.toggle('active', node.dataset.xaMode === xaState.mode));
  xaNode('xa-compose-hint').textContent = xaState.mode === 'speak' ? '音箱会原样读出这段文字' : '小爱会理解并执行这句话';
  xaNode('xa-text').placeholder = xaState.mode === 'speak' ? '例如：饭做好了，大家来吃饭吧' : '例如：打开客厅的灯';
  xaNode('xa-text').maxLength = xaState.mode === 'speak' ? 500 : 200;
}
async function loadXaState() {
  try {
    const data = await xaRequest('/api/modules/xiaoai-assistant/state');
    xaState.profiles = data.profiles || []; xaState.controls = data.controls || []; xaState.history = data.history || {};
    if (!xaState.profiles.some(item => item.id === xaState.selected)) xaState.selected = xaState.profiles[0]?.id || '';
    if (xaState.selected) localStorage.setItem('allinone-xa-speaker', xaState.selected);
    renderXaSpeakers(); renderXaHistory(); renderXaControls();
  } catch (error) { xaToast(error.message); }
}

document.querySelectorAll('[data-xa-mode]').forEach(node => node.addEventListener('click', () => setXaMode(node.dataset.xaMode)));
xaNode('xa-speakers').addEventListener('click', event => { const item = event.target.closest('[data-xa-speaker]'); if (!item) return; xaState.selected = item.dataset.xaSpeaker; localStorage.setItem('allinone-xa-speaker', xaState.selected); renderXaSpeakers(); renderXaHistory(); });
xaNode('xa-volume').addEventListener('input', event => { xaNode('xa-volume-value').value = event.target.value; });
xaNode('xa-volume').addEventListener('change', async event => {
  const profile = xaProfile(), volume = Number(event.target.value); if (!profile?.speakerConnected) return xaToast('所选音箱尚未连接');
  event.target.disabled = true;
  try { await xaRequest('/api/modules/xiaoai-assistant/volume', { method: 'POST', body: JSON.stringify({ profileId: xaState.selected, volume }) }); profile.volume = volume; xaToast(`音量已调到 ${volume}`); }
  catch (error) { renderXaSpeakers(); xaToast(error.message); } finally { event.target.disabled = false; }
});
async function sendXaText(text, mode, clearAfter = false) {
  const profile = xaProfile(), button = xaNode('xa-send');
  if (button.disabled) return;
  if (!profile?.online) return xaToast('所选音箱服务当前离线');
  if (!profile.speakerConnected) return xaToast('所选音箱尚未连接');
  if (!text) return xaToast('请先输入要发送的内容');
  button.disabled = true; button.textContent = '发送中…';
  try { const data = await xaRequest('/api/modules/xiaoai-assistant/send', { method: 'POST', body: JSON.stringify({ profileId: xaState.selected, mode, text }) }); xaState.history[xaState.selected] = data.history; renderXaHistory(); if (clearAfter) xaNode('xa-text').value = ''; xaToast(mode === 'speak' ? '已发送播报' : '指令已发送'); }
  catch (error) { xaToast(error.message); } finally { button.disabled = false; button.textContent = '发送'; }
}
xaNode('xa-send').addEventListener('click', async () => {
  await sendXaText(xaNode('xa-text').value.trim(), xaState.mode, true);
});
xaNode('xa-history').addEventListener('click', async event => { const item = event.target.closest('[data-xa-history]'); if (!item) return; const record = xaHistory()[Number(item.dataset.xaHistory)]; if (!record) return; xaNode('xa-text').value = record.text; setXaMode(record.mode); await sendXaText(record.text, record.mode); });
xaNode('xa-clear-history').addEventListener('click', async () => { if (!xaState.selected) return; try { await xaRequest(`/api/modules/xiaoai-assistant/history/${encodeURIComponent(xaState.selected)}`, { method: 'DELETE' }); xaState.history[xaState.selected] = []; renderXaHistory(); xaToast('历史记录已清空'); } catch (error) { xaToast(error.message); } });

function updateXaFormMode() { const pair = xaNode('xa-control-mode').value === 'pair'; xaNode('xa-pair-fields').hidden = !pair; xaNode('xa-action-fields').hidden = pair; ['xa-control-on-command', 'xa-control-off-command'].forEach(id => { xaNode(id).required = pair; }); xaNode('xa-control-command').required = !pair; }
function openXaControl(control) {
  xaNode('xa-control-form').reset(); xaNode('xa-control-id').value = control?.id || ''; xaNode('xa-control-title').textContent = control ? '编辑快捷控制' : '添加快捷控制'; xaNode('xa-delete-control').hidden = !control;
  xaNode('xa-control-name').value = control?.name || ''; xaNode('xa-control-category').value = control?.category || 'light'; xaNode('xa-control-mode').value = control?.mode || 'pair'; xaNode('xa-control-on-label').value = control?.onLabel || '开启'; xaNode('xa-control-off-label').value = control?.offLabel || '关闭'; xaNode('xa-control-on-command').value = control?.onCommand || ''; xaNode('xa-control-off-command').value = control?.offCommand || ''; xaNode('xa-control-command').value = control?.command || ''; updateXaFormMode(); xaNode('xa-control-modal').hidden = false;
}
function closeXaControl() { xaNode('xa-control-modal').hidden = true; }
xaNode('xa-add-control').addEventListener('click', () => openXaControl());
xaNode('xa-control-mode').addEventListener('change', updateXaFormMode);
document.querySelectorAll('[data-xa-close]').forEach(node => node.addEventListener('click', closeXaControl));
xaNode('xa-control-modal').addEventListener('click', event => { if (event.target === xaNode('xa-control-modal')) closeXaControl(); });
xaNode('xa-controls').addEventListener('click', async event => {
  const configure = event.target.closest('[data-xa-configure]'); if (configure) return openXaControl(xaState.controls.find(item => item.id === configure.dataset.xaConfigure));
  const run = event.target.closest('[data-xa-run]'); if (!run) return; const profile = xaProfile(); if (!profile?.speakerConnected) return xaToast('所选音箱尚未连接');
  run.disabled = true; try { await xaRequest('/api/modules/xiaoai-assistant/execute', { method: 'POST', body: JSON.stringify({ profileId: xaState.selected, controlId: run.dataset.xaRun, operation: run.dataset.operation }) }); xaToast('指令已发送'); } catch (error) { xaToast(error.message); } finally { run.disabled = false; }
});
xaNode('xa-control-form').addEventListener('submit', async event => {
  event.preventDefault(); const id = xaNode('xa-control-id').value; const body = { name: xaNode('xa-control-name').value, category: xaNode('xa-control-category').value, mode: xaNode('xa-control-mode').value, onLabel: xaNode('xa-control-on-label').value, offLabel: xaNode('xa-control-off-label').value, onCommand: xaNode('xa-control-on-command').value, offCommand: xaNode('xa-control-off-command').value, command: xaNode('xa-control-command').value };
  try { await xaRequest(id ? `/api/modules/xiaoai-assistant/controls/${encodeURIComponent(id)}` : '/api/modules/xiaoai-assistant/controls', { method: id ? 'PUT' : 'POST', body: JSON.stringify(body) }); closeXaControl(); await loadXaState(); xaToast('快捷控制已保存'); } catch (error) { xaToast(error.message); }
});
xaNode('xa-delete-control').addEventListener('click', async () => { const id = xaNode('xa-control-id').value; if (!id || !confirm('确定删除这个快捷控制吗？')) return; try { await xaRequest(`/api/modules/xiaoai-assistant/controls/${encodeURIComponent(id)}`, { method: 'DELETE' }); closeXaControl(); await loadXaState(); xaToast('快捷控制已删除'); } catch (error) { xaToast(error.message); } });
document.addEventListener('xiaoai-assistant:refresh', loadXaState);
setXaMode('speak'); loadXaState();
