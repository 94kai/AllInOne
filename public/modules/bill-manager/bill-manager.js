const bmApiBase = window.allinoneApiBase || '';
const bmNode = id => document.getElementById(id);
const bmEscape = value => String(value).replace(/[&<>'"]/g, char => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' })[char]);
let bmData = { sources: [], config: { fieldRules: {}, recordActions: {}, categoryRules: [], alipayFilterRules: [] }, mappings: {}, exportPreview: {} };
let bmRole = localStorage.getItem('allinone-bill-role') || 'wechat';
let bmTemporaryOnly = false;

async function bmRequest(path = '', options = {}) {
  const response = await fetch(`${bmApiBase}/api/modules/bill-manager${path}`, { ...options, credentials:'include', headers: options.body ? { 'Content-Type':'application/json' } : undefined });
  const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || `请求失败（${response.status}）`); return data;
}
function bmToast(message) { const node = bmNode('toast'); node.textContent = message; node.classList.add('show'); clearTimeout(bmToast.timer); bmToast.timer = setTimeout(() => node.classList.remove('show'), 2600); }
function bmSource() { return bmData.sources.find(source => source.role === bmRole) || bmData.sources.find(source => ['wechat', 'alipay', 'cmb'].includes(source.role)); }
function bmMask(column, value) {
  if (!value) return '—';
  if (column.includes('单号') && value.length > 10) return `${value.slice(0,4)}…${value.slice(-4)}`;
  return value;
}
function bmColumnClass(column) {
  if (['备注', '商品', '商品说明'].includes(column)) return 'bm-column-wide';
  if (['交易对方', '对方账号', '收/付款方式'].includes(column)) return 'bm-column-medium';
  return '';
}
function bmPreviewKey(role) { return role === 'alipay' ? 'alipay' : role === 'cmb' ? 'cmb' : 'bills'; }
function bmRenderTable(source) {
  const isWechat = source.role === 'wechat';
  const rules = bmData.config.fieldRules[source.role] || {};
  const columns = isWechat ? source.columns.filter(column => !(rules[column]?.locked && rules[column]?.mode === 'delete')) : source.columns.filter(column => rules[column]?.mode !== 'delete');
  const rows = ['wechat', 'alipay', 'cmb'].includes(source.role) ? source.rows : source.rows.slice(0, 5);
  const displayValue = (row, column) => !isWechat && rules[column]?.mode === 'fixed' ? rules[column].value : row.values[column];
  bmNode('bm-table-wrap').innerHTML = `<table class="bm-table"><thead><tr>${columns.map(column => `<th class="${bmColumnClass(column)}">${bmEscape(column)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${columns.map(column => { const value = displayValue(row, column); return `<td class="${bmColumnClass(column)}" title="${bmEscape(value || '')}">${bmEscape(bmMask(column, value))}</td>`; }).join('')}</tr>`).join('')}</tbody></table>`;
}
function bmRenderExport(source) {
  const group = bmData.exportPreview?.[bmPreviewKey(source.role)] || { columns:[], rows:[] };
  const rows = bmTemporaryOnly ? group.rows.filter(row => String(row['类别'] || '').startsWith('临时')) : group.rows;
  const total = (bmData.exportPreview?.bills?.rows.length || 0) + (bmData.exportPreview?.alipay?.rows.length || 0) + (bmData.exportPreview?.cmb?.rows.length || 0);
  bmNode('bm-export-note').textContent = bmTemporaryOnly ? `临时分类 ${rows.length} / ${group.rows.length} 条` : `当前 ${group.rows.length} 条 · 统一导出 ${total} 条`;
  bmNode('bm-export').hidden = false;
  bmNode('bm-preview-temporary').classList.toggle('active', bmTemporaryOnly);
  bmNode('bm-preview-temporary').setAttribute('aria-pressed', String(bmTemporaryOnly));
  bmNode('bm-preview-temporary').textContent = bmTemporaryOnly ? '显示全部' : '只看临时分类';
  bmNode('bm-export-table').innerHTML = rows.length ? `<table class="bm-table"><thead><tr>${group.columns.map(column => `<th class="${bmColumnClass(column)}">${bmEscape(column)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${group.columns.map(column => `<td class="${bmColumnClass(column)}" title="${bmEscape(row[column] || '')}">${bmEscape(bmMask(column, row[column] || '—'))}</td>`).join('')}</tr>`).join('')}</tbody></table>` : '<div class="empty-state">当前没有临时分类记录</div>';
}
function bmRenderCategoryRules() {
  const rules = bmData.config.categoryRules || [];
  bmNode('bm-category-rules').innerHTML = rules.length ? rules.map((rule, index) => `<div class="bm-category-rule"><span>${bmEscape(rule.keyword)}</span><b>→</b><strong>${bmEscape(rule.primary)}</strong><small>${bmEscape(rule.secondary || '二级分类为空')}</small><button type="button" data-bm-rule-delete="${index}" aria-label="删除规则">删除</button></div>`).join('') : '<div class="bm-rule-empty">尚未添加自定义分类规则</div>';
}
function bmRenderRuleMatch() {
  const keyword = bmNode('bm-rule-keyword').value.trim();
  const group = bmData.exportPreview?.[bmPreviewKey(bmRole)] || { rows:[] };
  const label = bmRole === 'alipay' ? '支付宝' : bmRole === 'cmb' ? '招商银行' : '微信';
  const count = keyword ? group.rows.filter(row => String(row['备注'] || '').includes(keyword)).length : 0;
  bmNode('bm-rule-match').textContent = keyword ? `当前${label}账单命中 ${count} / ${group.rows.length} 条` : '输入匹配字符串后显示命中数量';
  bmNode('bm-rule-match').classList.toggle('has-match', count > 0);
}
async function bmSaveCategoryRules(rules) {
  bmData = await bmRequest('/category-rules', { method:'PUT', body:JSON.stringify({ rules }) });
  bmRender();
}
function bmRenderAlipayFilters() {
  const rules = bmData.config.alipayFilterRules || [];
  bmNode('bm-filter-rules').innerHTML = rules.length ? rules.map((rule, index) => `<div class="bm-filter-rule"><span>${bmEscape(rule.keyword)}</span><button type="button" data-bm-filter-delete="${index}">删除</button></div>`).join('') : '<div class="bm-rule-empty">当前不过滤任何收付款方式</div>';
  bmRenderFilterMatch();
}
function bmRenderFilterMatch() {
  const keyword = bmNode('bm-filter-keyword').value.trim();
  const source = bmData.sources.find(item => item.role === 'alipay');
  const count = keyword ? (source?.rows || []).filter(row => String(row.values['收/付款方式'] || '').includes(keyword)).length : 0;
  bmNode('bm-filter-match').textContent = keyword ? `将过滤 ${count} / ${source?.rows.length || 0} 条` : '输入后显示将过滤的数量';
}
async function bmSaveAlipayFilters(rules) {
  bmData = await bmRequest('/alipay-filter-rules', { method:'PUT', body:JSON.stringify({ rules }) });
  bmRender();
}
function bmRender() {
  const source = bmSource();
  document.querySelectorAll('[data-bm-role]').forEach(button => button.classList.toggle('active', button.dataset.bmRole === source?.role));
  if (!source) { bmNode('bm-content').innerHTML = '<div class="empty-state">尚未发现账单文件</div>'; return; }
  bmNode('bm-content').hidden = false; bmNode('bm-empty').hidden = true;
  bmNode('bm-file-name').textContent = source.name;
  bmNode('bm-file-meta').textContent = source.error ? source.error : `${source.rows.length} 条`;
  bmNode('bm-upload-time').textContent = source.uploadedAt ? `上次上传 ${new Date(source.uploadedAt).toLocaleString('zh-CN', { hour12:false })}` : '上次上传时间未知';
  bmNode('bm-upload-input').accept = source.role === 'alipay' ? '.csv,text/csv' : source.role === 'cmb' ? '.pdf,application/pdf' : '.xls,.xlsx';
  bmNode('bm-mapping-card').hidden = !['wechat', 'alipay', 'cmb'].includes(source.role);
  bmNode('bm-filter-card').hidden = source.role !== 'alipay';
  bmNode('bm-category-card').hidden = !['wechat', 'alipay', 'cmb'].includes(source.role);
  bmNode('bm-export-card').hidden = !['wechat', 'alipay', 'cmb'].includes(source.role);
  bmNode('bm-mappings').innerHTML = (bmData.mappings?.[source.role] || []).map(mapping => `<div class="bm-mapping"><span>${mapping.sources.length ? mapping.sources.map(bmEscape).join(' + ') : '固定值'}</span><b>→</b><strong>${bmEscape(mapping.target)}</strong><small>${bmEscape(mapping.transform)}</small></div>`).join('');
  bmRenderCategoryRules();
  bmRenderAlipayFilters();
  bmRenderRuleMatch();
  bmNode('bm-record-note').textContent = source.role === 'cmb' ? `共 ${source.rows.length} 条原始流水` : `共 ${source.rows.length} 条；交易单号已脱敏显示`;
  bmRenderTable(source); if (['wechat', 'alipay', 'cmb'].includes(source.role)) bmRenderExport(source);
}
async function bmLoad() {
  try { bmData = await bmRequest(); if (!['wechat', 'alipay', 'cmb'].includes(bmRole) || !bmData.sources.some(source => source.role === bmRole)) bmRole = 'wechat'; bmRender(); }
  catch (error) { bmNode('bm-empty').hidden = false; bmNode('bm-empty').textContent = error.message; }
}
function bmUpload(file) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', `${bmApiBase}/api/modules/bill-manager/upload?role=${encodeURIComponent(bmRole)}&name=${encodeURIComponent(file.name)}`);
    request.withCredentials = true;
    request.responseType = 'json';
    request.addEventListener('load', () => request.status >= 200 && request.status < 300 ? resolve(request.response) : reject(new Error(request.response?.error || `上传失败（${request.status}）`)));
    request.addEventListener('error', () => reject(new Error('上传失败，请检查网络连接')));
    request.send(file);
  });
}
document.querySelectorAll('[data-bm-role]').forEach(button => button.addEventListener('click', () => { bmRole = button.dataset.bmRole; localStorage.setItem('allinone-bill-role', bmRole); bmRender(); }));
bmNode('bm-upload').addEventListener('click', () => bmNode('bm-upload-input').click());
bmNode('bm-upload-input').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  const button = bmNode('bm-upload'); button.disabled = true; button.textContent = '上传中…';
  try {
    const role = bmRole;
    bmData = await bmUpload(file); localStorage.setItem('allinone-bill-role', bmRole); bmRender();
    const source = bmData.sources.find(item => item.role === role);
    const label = role === 'alipay' ? '支付宝' : role === 'cmb' ? '招商银行' : '微信';
    bmToast(`已解析 ${source?.rows.length || 0} 条${label}记录`);
  }
  catch (error) { bmToast(error.message); }
  finally { button.disabled = false; button.textContent = '上传新账单'; event.target.value = ''; }
});
bmNode('bm-export').addEventListener('click', () => { window.location.href = `${bmApiBase}/api/modules/bill-manager/export`; });
bmNode('bm-preview-temporary').addEventListener('click', () => { bmTemporaryOnly = !bmTemporaryOnly; bmRenderExport(bmSource()); });
bmNode('bm-category-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const keyword = bmNode('bm-rule-keyword').value.trim();
  const primary = bmNode('bm-rule-primary').value.trim();
  const secondary = bmNode('bm-rule-secondary').value.trim();
  const button = form.querySelector('button'); button.disabled = true;
  try {
    await bmSaveCategoryRules([{ keyword, primary, secondary }, ...(bmData.config.categoryRules || [])]);
    form.reset(); bmRenderRuleMatch(); bmToast('分类规则已添加');
  } catch (error) { bmToast(error.message); }
  finally { button.disabled = false; }
});
bmNode('bm-rule-keyword').addEventListener('input', bmRenderRuleMatch);
bmNode('bm-category-rules').addEventListener('click', async event => {
  const button = event.target.closest('[data-bm-rule-delete]'); if (!button) return;
  button.disabled = true;
  try { const rules = [...(bmData.config.categoryRules || [])]; rules.splice(Number(button.dataset.bmRuleDelete), 1); await bmSaveCategoryRules(rules); bmToast('分类规则已删除'); }
  catch (error) { button.disabled = false; bmToast(error.message); }
});
bmNode('bm-filter-keyword').addEventListener('input', bmRenderFilterMatch);
bmNode('bm-filter-form').addEventListener('submit', async event => {
  event.preventDefault(); const form = event.currentTarget; const button = form.querySelector('button');
  const keyword = bmNode('bm-filter-keyword').value.trim(); button.disabled = true;
  try { await bmSaveAlipayFilters([{ keyword }, ...(bmData.config.alipayFilterRules || [])]); form.reset(); bmRenderFilterMatch(); bmToast('支付宝过滤规则已添加'); }
  catch (error) { bmToast(error.message); }
  finally { button.disabled = false; }
});
bmNode('bm-filter-rules').addEventListener('click', async event => {
  const button = event.target.closest('[data-bm-filter-delete]'); if (!button) return; button.disabled = true;
  try { const rules = [...(bmData.config.alipayFilterRules || [])]; rules.splice(Number(button.dataset.bmFilterDelete), 1); await bmSaveAlipayFilters(rules); bmToast('支付宝过滤规则已删除'); }
  catch (error) { button.disabled = false; bmToast(error.message); }
});
bmNode('bm-content').addEventListener('click', event => {
  const cell = event.target.closest('.bm-table td');
  if (cell) cell.classList.toggle('is-expanded');
});
document.addEventListener('bill-manager:refresh', bmLoad);
bmLoad();
