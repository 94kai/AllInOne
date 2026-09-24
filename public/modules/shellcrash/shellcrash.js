const sc = id => document.getElementById(id);
const previewBases = { 'devstudio.xuekai.top': 'https://aio.xuekai.top:8888' };
const apiBase = previewBases[window.location.hostname] || (window.location.port === '8787' ? `${window.location.protocol}//${window.location.hostname}:2006` : '');
const endpoint = path => `${apiBase}/api/modules/shellcrash${path}`;
let loading = false;

async function scRequest(path, options = {}) {
  const response = await fetch(endpoint(path), { ...options, credentials: 'include', headers: options.body ? { 'Content-Type': 'application/json' } : undefined });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `请求失败（${response.status}）`);
  return data;
}
function esc(value) { return String(value ?? '').replace(/[&<>'"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' })[c]); }
function time(value) { return value ? new Date(value).toLocaleString('zh-CN', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit' }) : '尚未检测'; }
function relative(value) {
  if (!value) return '等待计划';
  const seconds = Math.round((Date.parse(value) - Date.now()) / 1000);
  if (seconds <= 0) return '即将检测';
  return `${Math.ceil(seconds / 60)} 分钟后检测`;
}
function ensureOption(select, value) {
  if (![...select.options].some(option => option.value === String(value))) select.add(new Option(`${value} 秒`, value));
  select.value = String(value);
}
function render(data) {
  const runtime = data.runtime || {}, config = data.config || {}, available = runtime.available;
  sc('sc-status-dot').className = `sc-status-dot ${runtime.running ? 'busy' : available && !runtime.lastError ? 'ok' : 'bad'}`;
  sc('sc-status-title').textContent = runtime.running ? '正在检测' : available && !runtime.lastError ? '守护运行正常' : '需要检查';
  sc('sc-status-detail').textContent = runtime.lastError || `通过 ${config.group || '--'} 代理组检测 ChatGPT`;
  sc('sc-current').textContent = runtime.current || '--';
  sc('sc-node-count').textContent = `${data.total || 0} 个候选节点`;
  sc('sc-delay').textContent = Number.isFinite(runtime.lastDelay) ? `${runtime.lastDelay} ms` : '--';
  sc('sc-last-check').textContent = time(runtime.lastCheckAt);
  sc('sc-failures').textContent = runtime.failures || 0;
  sc('sc-next-check').textContent = config.enabled ? relative(runtime.nextCheckAt) : '自动守护已关闭';
  sc('sc-enabled').checked = Boolean(config.enabled);
  ensureOption(sc('sc-interval'), config.intervalSeconds || 180);
  ensureOption(sc('sc-threshold'), config.failureThreshold || 3);
  ensureOption(sc('sc-cooldown'), config.cooldownSeconds || 600);
  const selected = sc('sc-node-select').value;
  sc('sc-node-select').innerHTML = (data.nodes || []).map(name => `<option value="${esc(name)}"${name === runtime.current ? ' selected' : ''}>${esc(name)}${name === runtime.current ? '（当前）' : ''}</option>`).join('') || '<option value="">没有可用节点</option>';
  if (selected && data.nodes?.includes(selected)) sc('sc-node-select').value = selected;
  const history = runtime.history || [];
  sc('sc-history').innerHTML = history.map(item => {
    const label = item.type === 'switch' ? '自动/手动切换' : item.type === 'failure' ? '检测失败' : '检测成功';
    const detail = item.type === 'switch' ? `${item.from || '--'} → ${item.to}` : item.node || '--';
    const extra = item.type === 'success' ? `${item.delay} ms` : item.reason || (item.failures ? `连续 ${item.failures} 次` : '');
    return `<div class="sc-history-item ${esc(item.type)}"><span>${time(item.at)}</span><strong>${label} · ${esc(detail)}</strong><em>${esc(extra)}</em></div>`;
  }).join('') || '<div class="empty-state">暂无检测记录</div>';
}
async function load() {
  if (loading) return;
  loading = true;
  try { render(await scRequest('')); }
  catch (error) { sc('sc-status-title').textContent = '读取失败'; sc('sc-status-detail').textContent = error.message; sc('sc-status-dot').className = 'sc-status-dot bad'; }
  finally { loading = false; }
}
sc('sc-check').addEventListener('click', async () => {
  const button = sc('sc-check'); button.disabled = true; button.textContent = '检测中…'; sc('sc-status-dot').className = 'sc-status-dot busy';
  try { const data = await scRequest('/check', { method:'POST' }); render(data); }
  catch (error) { sc('sc-status-detail').textContent = error.message; }
  finally { button.disabled = false; button.textContent = '立即检测'; }
});
sc('sc-save').addEventListener('click', async () => {
  const button = sc('sc-save'); button.disabled = true;
  try { render(await scRequest('/config', { method:'PUT', body:JSON.stringify({ enabled:sc('sc-enabled').checked, intervalSeconds:Number(sc('sc-interval').value), failureThreshold:Number(sc('sc-threshold').value), cooldownSeconds:Number(sc('sc-cooldown').value) }) })); button.textContent = '已保存'; setTimeout(() => { button.textContent = '保存守护设置'; }, 1200); }
  catch (error) { sc('sc-status-detail').textContent = error.message; }
  finally { button.disabled = false; }
});
sc('sc-switch').addEventListener('click', async () => {
  const name = sc('sc-node-select').value;
  if (!name || !confirm(`确定将当前代理组切换到“${name}”吗？`)) return;
  const button = sc('sc-switch'); button.disabled = true;
  try { render(await scRequest('/switch', { method:'POST', body:JSON.stringify({ name }) })); }
  catch (error) { sc('sc-status-detail').textContent = error.message; }
  finally { button.disabled = false; }
});
document.addEventListener('shellcrash:refresh', load);
