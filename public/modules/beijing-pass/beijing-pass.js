const apiBase = window.allinoneApiBase || '';
const $ = selector => document.querySelector(selector);
let config;

async function request(path, options = {}) {
  const response = await fetch(`${apiBase}/api/modules/beijing-pass${path}`, { ...options, credentials: 'include', headers: options.body ? { 'Content-Type': 'application/json' } : undefined });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(data.error || `请求失败（${response.status}）`); error.data = data; throw error; }
  return data;
}
function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, character => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' })[character]); }
function time(value) { return value ? new Date(value).toLocaleString('zh-CN') : '暂无'; }
function pathLabel(value) { return ({ direct:'状态接口直查', 'sso-refresh':'JWT 换取 Auth 后重试', failed:'全部链路失败' })[value] || '尚无记录'; }
function maskToken(value) {
  const token = String(value || '');
  if (!token) return '未配置';
  return token.length <= 12 ? `${token.slice(0, 3)}•••` : `${token.slice(0, 6)}••••${token.slice(-4)}`;
}
function renderInterfaces(path = '', attempts = [], running = false) {
  if (!config) return;
  const failed = new Set(attempts.map(item => item.step));
  const used = path === 'direct' ? ['state'] : path === 'sso-refresh' ? ['state', 'sso'] : [];
  const cards = [
    { id:'state', step:'direct', name:'① 状态查询', url:config.stateUrl, auth:config.stateAuth },
    { id:'sso', step:'sso-refresh', name:'② JWT 换取 Auth', url:config.ssoUrl, auth:config.ssoAuth }
  ];
  $('#bp-interface-flow').innerHTML = cards.map(card => {
    const isFailed = failed.has(card.step), isUsed = used.includes(card.id);
    const state = running && card.id === 'state' ? '查询中' : isFailed ? '失败' : isUsed ? (card.id === 'state' && path !== 'direct' ? '已重试' : '已使用') : '备用';
    const css = isFailed ? 'failed' : isUsed ? (card.id === used.at(-1) ? 'active' : 'success') : '';
    return `<article class="bp-interface-card ${css}"><div class="bp-interface-top"><strong>${card.name}</strong><span class="bp-interface-state">${state}</span></div><span class="bp-interface-url" title="${escapeHtml(card.url)}">${escapeHtml(card.url)}</span><span class="bp-interface-auth">Auth · ${escapeHtml(maskToken(card.auth))}</span></article>`;
  }).join('');
  const badge = $('#bp-final-route');
  badge.className = path === 'failed' ? 'failed' : path ? 'success' : '';
  badge.textContent = running ? '正在执行直查' : path ? `最终：${pathLabel(path)}` : '等待查询';
}
function showMeta(meta = {}, attempts = []) {
  $('#bp-meta').innerHTML = `最近查询：${time(meta.lastQueryAt)}<br>最近成功：${time(meta.lastSuccessAt)}<br>最近直查成功：${time(meta.lastDirectSuccessAt)}<br>当前 Auth 首次直查失败：${time(meta.firstDirectFailureAt)}<br>状态 Auth 换取：${time(meta.stateAuthUpdatedAt)}<br>成功路径：${escapeHtml(pathLabel(meta.lastPath))}${attempts.length ? `<br>本次降级记录：${attempts.map(item => `${escapeHtml(item.step)}：${escapeHtml(item.error)}`).join('；')}` : ''}`;
}
async function loadConfig() {
  try { config = await request('/config'); showMeta(config.meta); renderInterfaces(config.meta?.lastPath); }
  catch (error) { $('#bp-meta').textContent = error.message; }
}
function renderResult(data, path) {
  const source = data?.data ?? data?.result ?? data;
  const vehicles = Array.isArray(source?.bzclxx) ? source.bzclxx : Array.isArray(source) ? source : [];
  const permitHtml = permit => {
    const status = permit.blztmc || permit.statusName || permit.stateName || '状态未知';
    const tone = /(成功|有效|通过|已办)/.test(status) ? 'ok' : /(失败|驳回|过期|作废)/.test(status) ? 'bad' : /(审核|办理|等待|申请)/.test(status) ? 'warn' : '';
    const fields = [
      ['有效期', permit.yxqs && permit.yxqz ? `${permit.yxqs} 至 ${permit.yxqz}` : permit.sxrqmc],
      ['进京证类型', permit.jjzzlmc || permit.jjzzl],
      ['申请时间', permit.sqsj],
      ['进京证号', permit.jjzh],
      ['驾驶人', permit.jsrxm],
      ['审核说明', permit.shsbyyms || permit.shsbyy]
    ].filter(([, value]) => value !== null && value !== undefined && String(value).trim());
    return `<section class="bp-permit"><div class="bp-permit-status"><strong>${escapeHtml(permit.jjzzlmc || '进京证记录')}</strong><span class="bp-status-chip ${tone}">${escapeHtml(status)}</span></div><div class="bp-permit-grid">${fields.map(([label,value]) => `<div class="bp-info"><span>${label}</span><strong>${escapeHtml(value)}</strong></div>`).join('')}</div></section>`;
  };
  const summary = vehicles.length ? `查询到 ${vehicles.length} 辆车辆` : '未查询到车辆或进京证记录';
  $('#bp-summary').textContent = `${summary} · ${pathLabel(path)}`;
  $('#bp-result').innerHTML = vehicles.length ? `<div class="bp-result-list">${vehicles.map(vehicle => {
    const permits = [...(Array.isArray(vehicle.bzxx) ? vehicle.bzxx : []), ...(Array.isArray(vehicle.ecbzxx) ? vehicle.ecbzxx : [])];
    const quotas = [['本年已办', vehicle.ybcs], ['剩余次数', vehicle.sycs], ['剩余天数', vehicle.syts], ['可进京天数', vehicle.kjts]].filter(([,value]) => value !== null && value !== undefined && value !== '');
    return `<article class="bp-vehicle-card"><header class="bp-vehicle-head"><div class="bp-plate"><span class="bp-plate-icon">京</span><div><strong>${escapeHtml(vehicle.hphm || '未知车牌')}</strong><small>${escapeHtml(vehicle.cllx || vehicle.hpzl || '车辆')}</small></div></div><span class="bp-count">${permits.length} 条进京证记录</span></header><div class="bp-vehicle-quota">${quotas.map(([label,value]) => `<span>${label} ${escapeHtml(value)}</span>`).join('')}</div>${permits.length ? permits.map(permitHtml).join('') : '<div class="bp-no-permit">当前没有进京证办理记录</div>'}</article>`;
  }).join('')}</div>` : `<div class="empty-state">${escapeHtml(data?.msg || summary)}</div>`;
}
$('#bp-query').addEventListener('click', async () => {
  const button = $('#bp-query'); button.disabled = true; button.textContent = '正在查询…'; $('#bp-summary').textContent = '优先使用状态接口直查'; renderInterfaces('', [], true);
  try { const result = await request('/state', { method:'POST' }); renderResult(result.data, result.path); showMeta(result.meta, result.attempts); renderInterfaces(result.path, result.attempts); }
  catch (error) { $('#bp-summary').textContent = '查询失败'; $('#bp-result').innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`; showMeta(error.data?.meta, error.data?.attempts); renderInterfaces('failed', error.data?.attempts || []); }
  finally { button.disabled = false; button.textContent = '查询进京证'; }
});
$('#bp-settings').addEventListener('click', async () => {
  if (!config) await loadConfig(); if (!config) return;
  const form = $('#bp-config-form'); ['stateUrl','stateAuth','ssoUrl','ssoAuth'].forEach(key => { form.elements[key].value = config[key] || ''; });
  $('#bp-config-modal').hidden = false; document.body.style.overflow = 'hidden';
});
document.querySelectorAll('[data-bp-close]').forEach(button => button.addEventListener('click', () => { $('#bp-config-modal').hidden = true; document.body.style.overflow = ''; }));
$('#bp-config-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = event.submitter; button.disabled = true;
  const fields = new FormData(event.currentTarget);
  try { config = await request('/config', { method:'PUT', body:JSON.stringify({ stateAuth:fields.get('stateAuth'), ssoAuth:fields.get('ssoAuth') }) }); $('#bp-config-modal').hidden = true; document.body.style.overflow = ''; showMeta(config.meta); renderInterfaces(config.meta?.lastPath); }
  catch (error) { alert(error.message); } finally { button.disabled = false; }
});
document.addEventListener('beijing-pass:refresh', loadConfig);
loadConfig();
