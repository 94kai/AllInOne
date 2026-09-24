const apiBase = window.allinoneApiBase || '';
const $ = selector => document.querySelector(selector);
let config;
let preparation;

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
function showMeta(meta = {}, attempts = [], monitor = config?.monitor) {
  const monitorLabel = ({ active:'轮询中', completed:'已取得最终结果', stopped:'已停止' })[monitor?.status] || '无任务';
  const notifyLabel = ({ pending:'等待结果', sending:'发送中', sent:'已发送', failed:'发送失败', 'not-configured':'未配置 SendKey' })[monitor?.notificationStatus] || '无';
  const monitorText = monitor ? `<br><br>后台任务：${monitorLabel}（${monitor.attempts}/${monitor.maxAttempts}）<br>车辆：${escapeHtml(monitor.plate)} · ${escapeHtml(monitor.entryType === '01' ? '六环内' : '六环外')}<br>最后状态：${escapeHtml(monitor.lastStatus || '暂无')}<br>下次查询：${time(monitor.nextPollAt)}<br>微信通知：${notifyLabel}${monitor.lastError ? `<br>最后错误：${escapeHtml(monitor.lastError)}` : ''}` : '<br><br>后台任务：无（仅提交成功后创建）';
  $('#bp-meta').innerHTML = `最近查询：${time(meta.lastQueryAt)}<br>最近成功：${time(meta.lastSuccessAt)}<br>最近直查成功：${time(meta.lastDirectSuccessAt)}<br>当前 Auth 首次直查失败：${time(meta.firstDirectFailureAt)}<br>状态 Auth 换取：${time(meta.stateAuthUpdatedAt)}<br>成功路径：${escapeHtml(pathLabel(meta.lastPath))}${attempts.length ? `<br>本次降级记录：${attempts.map(item => `${escapeHtml(item.step)}：${escapeHtml(item.error)}`).join('；')}` : ''}${monitorText}`;
}
async function loadConfig() {
  try { config = await request('/config'); showMeta(config.meta); renderInterfaces(config.meta?.lastPath); }
  catch (error) { $('#bp-meta').textContent = error.message; }
}
function renderResult(data, path, queriedAt) {
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
  const queryTime = queriedAt || new Date().toISOString();
  $('#bp-summary').textContent = `${summary} · ${pathLabel(path)} · ${time(queryTime)}`;
  const content = vehicles.length ? `<div class="bp-result-list">${vehicles.map(vehicle => {
    const permits = [...(Array.isArray(vehicle.bzxx) ? vehicle.bzxx : []), ...(Array.isArray(vehicle.ecbzxx) ? vehicle.ecbzxx : [])];
    const quotas = [['本年已办', vehicle.ybcs], ['剩余次数', vehicle.sycs], ['剩余天数', vehicle.syts], ['可进京天数', vehicle.kjts]].filter(([,value]) => value !== null && value !== undefined && value !== '');
    return `<article class="bp-vehicle-card"><header class="bp-vehicle-head"><div class="bp-plate"><span class="bp-plate-icon">京</span><div><strong>${escapeHtml(vehicle.hphm || '未知车牌')}</strong><small>${escapeHtml(vehicle.cllx || vehicle.hpzl || '车辆')}</small></div></div><span class="bp-count">${permits.length} 条进京证记录</span></header><div class="bp-vehicle-quota">${quotas.map(([label,value]) => `<span>${label} ${escapeHtml(value)}</span>`).join('')}</div>${permits.length ? permits.map(permitHtml).join('') : '<div class="bp-no-permit">当前没有进京证办理记录</div>'}</article>`;
  }).join('')}</div>` : `<div class="empty-state">${escapeHtml(data?.msg || summary)}</div>`;
  $('#bp-result').innerHTML = `<div class="bp-query-stamp"><span>本次查询时间</span><strong>${escapeHtml(time(queryTime))}</strong><em>服务端实时请求</em></div>${content}`;
}
function dateValue(offset = 0) { const date = new Date(); date.setDate(date.getDate() + offset); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
function selectedVehicle() { return preparation?.vehicles.find(item => item.id === $('#bp-draft-vehicle')?.value) || preparation?.vehicles[0]; }
function updateSubmitState() {
  const vehicle = selectedVehicle(), type = $('#bp-draft-type')?.value, button = $('#bp-submit'); if (!vehicle || !button) return;
  const active = vehicle.records.some(record => /(审核中|生效中|待生效)/.test(record.status));
  const eligible = type === '六环内' ? vehicle.canInner : vehicle.canOuter;
  button.disabled = !preparation.submitEnabled || active || !eligible;
  button.textContent = active ? '已有办理中或生效中的进京证' : !eligible ? `当前不能办理${type}` : '确认并提交办理';
  button.classList.toggle('bp-submit-disabled', button.disabled);
}
function renderDraft() {
  if (!preparation) return;
  const vehicle = selectedVehicle();
  if (!vehicle) return;
  const type = $('#bp-draft-type').value, date = $('#bp-draft-date').value;
  $('#bp-draft-preview').innerHTML = `<div class="bp-draft-head"><strong>待提交申请预览</strong><span>提交后进入官方审核</span></div><div class="bp-draft-grid"><span>车辆</span><b>${escapeHtml(vehicle.plate)} · ${escapeHtml(vehicle.brand || vehicle.vehicleTypeName)}</b><span>驾驶人</span><b>${escapeHtml(preparation.driver.name)} · ${escapeHtml(preparation.driver.identityMasked)}</b><span>生效日期</span><b>${escapeHtml(date)}</b><span>类型</span><b>${escapeHtml(type)}</b><span>进京目的</span><b>${escapeHtml(preparation.destination?.purpose)}</b><span>固定目的地</span><b>${escapeHtml(preparation.destination?.address)}</b><span>剩余额度</span><b>${escapeHtml(vehicle.remainingTimes)} 次 / ${escapeHtml(vehicle.remainingDays)} 天</b><span>车辆资料</span><b>${escapeHtml(vehicle.plateTypeName)} · 注册于 ${escapeHtml(vehicle.registrationDate || '未知')}</b></div>`;
  updateSubmitState();
}
function renderPreparation() {
  const content = $('#bp-prepare-content');
  if (!preparation.vehicles.length) { content.innerHTML = '<div class="empty-state">账号下没有可用车辆</div>'; return; }
  const today = dateValue(), maxDate = dateValue(7);
  content.innerHTML = `<div class="bp-prepare-form"><div class="bp-prepare-profile"><span>驾驶人 ${escapeHtml(preparation.driver.name)}</span><span>证件 ${escapeHtml(preparation.driver.identityMasked)}</span><span>车辆 ${preparation.vehicles.length} 辆</span></div><div class="bp-prepare-fields"><label>办理车辆<select id="bp-draft-vehicle">${preparation.vehicles.map(vehicle => `<option value="${escapeHtml(vehicle.id)}">${escapeHtml(vehicle.plate)} · ${escapeHtml(vehicle.brand || vehicle.vehicleTypeName)}</option>`).join('')}</select></label><label>进京证类型<select id="bp-draft-type"><option>六环内</option><option selected>六环外</option></select></label><label>计划生效日期<input id="bp-draft-date" type="date" min="${today}" max="${maxDate}" value="${today}"></label><label>固定目的地<input value="${escapeHtml(preparation.destination?.detail || '未配置')}" readonly></label></div><div class="bp-draft" id="bp-draft-preview"></div><div class="bp-capture-needed">提交前会重新检查当前状态与办理资格。请求只发送一次；如果发生超时，请先查询状态，不要立即重复办理。</div><button class="primary-button" id="bp-submit" type="button">确认并提交办理</button><div id="bp-apply-result"></div></div>`;
  ['bp-draft-vehicle','bp-draft-type','bp-draft-date'].forEach(id => $(`#${id}`).addEventListener('change', renderDraft)); renderDraft();
  $('#bp-submit').addEventListener('click', submitApply);
}
async function submitApply() {
  const vehicle = selectedVehicle(), type = $('#bp-draft-type').value, date = $('#bp-draft-date').value, button = $('#bp-submit');
  if (!vehicle || button.disabled) return;
  if (!confirm(`确认提交进京证申请？\n\n车辆：${vehicle.plate}\n类型：${type}\n生效日期：${date}\n目的地：${preparation.destination?.address}\n\n提交后将进入官方审核。`)) return;
  button.disabled = true; button.textContent = '正在提交，请勿重复操作…';
  try {
    const result = await request('/apply', { method:'POST', body:JSON.stringify({ vehicleId:vehicle.id, entryType:type === '六环内' ? '01' : '02', applyDate:date, confirmed:true }) });
    $('#bp-apply-result').innerHTML = `<div class="bp-apply-success"><strong>${escapeHtml(result.message)}</strong>${result.notices?.length ? `<ul>${result.notices.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : ''}</div>`;
    button.textContent = '已提交，后台轮询中';
    config = await request('/config'); showMeta(config.meta, [], config.monitor);
    $('#bp-query').click();
  } catch (error) {
    $('#bp-apply-result').innerHTML = `<div class="bp-apply-error">${escapeHtml(error.message)}<br>如果请求超时，请先点击“查询进京证”确认状态。</div>`;
    button.disabled = false; button.textContent = '确认并提交办理'; updateSubmitState();
  }
}
async function queryPassState() {
  const button = $('#bp-query'); button.disabled = true; button.textContent = '正在查询…'; $('#bp-summary').textContent = '优先使用状态接口直查'; renderInterfaces('', [], true);
  try { const result = await request('/state', { method:'POST' }); renderResult(result.data, result.path, result.meta?.lastSuccessAt); showMeta(result.meta, result.attempts); renderInterfaces(result.path, result.attempts); }
  catch (error) { $('#bp-summary').textContent = '查询失败'; $('#bp-result').innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`; showMeta(error.data?.meta, error.data?.attempts); renderInterfaces('failed', error.data?.attempts || []); }
  finally { button.disabled = false; button.textContent = '查询进京证'; }
}
async function loadPreparation(renderState = false) {
  const button = $('#bp-prepare'); button.disabled = true; button.textContent = '正在读取…';
  try {
    preparation = await request('/prepare'); renderPreparation();
    if (renderState && preparation.state) {
      renderResult(preparation.state.data, preparation.state.path, preparation.state.meta?.lastSuccessAt);
      showMeta(preparation.state.meta, preparation.state.attempts);
      renderInterfaces(preparation.state.path, preparation.state.attempts);
    }
  }
  catch (error) { $('#bp-prepare-content').innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`; }
  finally { button.disabled = false; button.textContent = '重新读取'; }
}
$('#bp-query').addEventListener('click', queryPassState);
$('#bp-prepare').addEventListener('click', () => loadPreparation());
$('#bp-settings').addEventListener('click', async () => {
  if (!config) await loadConfig(); if (!config) return;
  const form = $('#bp-config-form'); ['stateUrl','stateAuth','ssoUrl','ssoAuth','serverChanSendKey'].forEach(key => { form.elements[key].value = config[key] || ''; });
  $('#bp-config-modal').hidden = false; document.body.style.overflow = 'hidden';
});
document.querySelectorAll('[data-bp-close]').forEach(button => button.addEventListener('click', () => { $('#bp-config-modal').hidden = true; document.body.style.overflow = ''; }));
$('#bp-config-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = event.submitter; button.disabled = true;
  const fields = new FormData(event.currentTarget);
  try { config = await request('/config', { method:'PUT', body:JSON.stringify({ stateAuth:fields.get('stateAuth'), ssoAuth:fields.get('ssoAuth'), serverChanSendKey:fields.get('serverChanSendKey') }) }); $('#bp-config-modal').hidden = true; document.body.style.overflow = ''; showMeta(config.meta); renderInterfaces(config.meta?.lastPath); }
  catch (error) { alert(error.message); } finally { button.disabled = false; }
});
document.addEventListener('beijing-pass:refresh', () => Promise.all([loadConfig(), loadPreparation(true)]));
loadConfig();
