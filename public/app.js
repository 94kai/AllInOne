const icons = {
  home: '<path d="M3 10.8 12 3l9 7.8v9.7a.5.5 0 0 1-.5.5H15v-7H9v7H3.5a.5.5 0 0 1-.5-.5z"/>',
  folder: '<path d="M3 6.5h6l2 2h10v9.8a1.7 1.7 0 0 1-1.7 1.7H4.7A1.7 1.7 0 0 1 3 18.3z"/><path d="M3 9V5.7A1.7 1.7 0 0 1 4.7 4H9l2 2h7"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
  speed: '<path d="M4.2 18a9 9 0 1 1 15.6 0"/><path d="m12 15 4.5-5.5"/><circle cx="12" cy="15" r="1.5"/>',
  refresh: '<path d="M20 6v5h-5"/><path d="M18.2 15a7 7 0 1 1-.3-6.3L20 11"/>',
  server: '<rect x="4" y="3" width="16" height="7" rx="2"/><rect x="4" y="14" width="16" height="7" rx="2"/><path d="M8 6.5h.01M8 17.5h.01M12 6.5h5M12 17.5h5"/>',
  cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3M10 10h4v4h-4z"/>',
  memory: '<rect x="3" y="7" width="18" height="10" rx="2"/><path d="M7 10v4M11 10v4M15 10v4M19 10v4M6 4v3M10 4v3M14 4v3M18 4v3"/>',
  database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v7c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7"/>',
  arrow: '<path d="M5 12h14M14 7l5 5-5 5"/>', chevron: '<path d="m8 10 4 4 4-4"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', close: '<path d="m6 6 12 12M18 6 6 18"/>', download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z"/>',
  eye: '<path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z"/><circle cx="12" cy="12" r="2.7"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  file: '<path d="M6 2h8l5 5v15H6z"/><path d="M14 2v6h5"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 15-5-4-8 7"/>',
  audio: '<path d="M9 18V5l10-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/>',
  video: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m10 9 5 3-5 3z"/>',
  text: '<path d="M6 2h8l5 5v15H6zM14 2v6h5M9 13h6M9 17h6"/>',
  pdf: '<path d="M6 2h8l5 5v15H6zM14 2v6h5"/><path d="M8 17h2a2 2 0 0 0 0-4H8v6M13 13h1.5a2 2 0 0 1 0 4H13zM18 13h3M18 16h2"/>',
  archive: '<path d="M5 3h14v18H5zM10 3v3h4V3M10 9h4v3h-4M10 15h4v3h-4"/>'
};

document.querySelectorAll('[data-icon]').forEach(node => {
  node.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[node.dataset.icon] || icons.file}</svg>`;
});

const state = { view: 'home', roots: [], root: '', path: '', absolutePath: '', entries: [], bookmarks: [], favorites: [], grid: false, showHidden: localStorage.getItem('allinone-show-hidden') === '1', lastSystemUpdate: 0 };
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
// DevStudio 托管预览时跨域连接 Allinone 的反向代理地址
const previewApiBases = {
  'devstudio.xuekai.top': 'https://aio.xuekai.top:8888'
};
const apiBase = previewApiBases[window.location.hostname]
  || (window.location.port === '8787' ? `${window.location.protocol}//${window.location.hostname}:2006` : '');
window.allinoneApiBase = apiBase;

function apiUrl(url) {
  return url.startsWith('/api/') ? `${apiBase}${url}` : url;
}

async function request(url, options = {}) {
  const response = await fetch(apiUrl(url), { ...options, credentials: 'include', headers: options.body ? { 'Content-Type': 'application/json', ...options.headers } : options.headers });
  const type = response.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await response.json() : null;
  if (!response.ok) throw new Error(data?.error || `请求失败（${response.status}）`);
  return data;
}

let toastTimer;
function toast(message) {
  const node = $('#toast'); node.textContent = message; node.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => node.classList.remove('show'), 2400);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

async function copyPath(value) {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const input = document.createElement('textarea'); input.value = value; input.style.position = 'fixed'; input.style.opacity = '0';
    document.body.append(input); input.select(); document.execCommand('copy'); input.remove();
  }
  toast('路径已复制');
}

function formatBytes(value) {
  if (!Number.isFinite(value)) return '--';
  if (value === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** index).toFixed(index > 2 ? 1 : 0)} ${units[index]}`;
}

function setGreeting() {
  $('#page-title').textContent = state.view === 'home' ? '概览' : state.view === 'files' ? '文件空间' : state.view === 'links' ? '地址导航' : '网络测速';
}

function switchView(view) {
  state.view = view;
  $$('.page').forEach(node => node.classList.toggle('active', node.id === `${view}-view`));
  $$('.nav-item[data-view]').forEach(node => node.classList.toggle('active', node.dataset.view === view));
  setGreeting(); window.scrollTo({ top: 0, behavior: 'smooth' });
  if (view === 'home' && Date.now() - state.lastSystemUpdate > 60000) loadSystem();
  if (view === 'files' && !state.entries.length) loadFiles();
}

async function loadSystem() {
  $('#monitor-note').textContent = '正在按需采样…';
  try {
    const data = await request('/api/system'); state.lastSystemUpdate = Date.now();
    $('#cpu-value').textContent = `${data.cpu}%`; $('#cpu-temperature').textContent = data.cpuTemperature == null ? '--°' : `${Math.round(data.cpuTemperature)}°`; $('#cpu-temperature').title = data.cpuTemperature == null ? '暂无 CPU 温度' : `CPU ${data.cpuTemperature}°C`; $('#cpu-meta').textContent = `${data.cores} 核 · 单次采样`;
    const memoryPercent = data.memory.used / data.memory.total * 100;
    $('#memory-label').textContent = data.memory.source === 'pressure' ? '内存压力' : '内存占用';
    $('#memory-value').textContent = `${memoryPercent.toFixed(0)}%`; $('#memory-meta').textContent = `${formatBytes(data.memory.used)} / ${formatBytes(data.memory.total)}`;
    $('#disk-list').innerHTML = data.disks.map(disk => {
      const percent = disk.total ? Math.max(0, Math.min(100, disk.used / disk.total * 100)) : 0;
      const temperature = disk.temperature == null ? '--°' : `${Math.round(disk.temperature)}°`;
      const volumeName = disk.mounts?.find(mount => /^\/vol[^/]*$/.test(mount)) || disk.mounts?.[0] || disk.target || disk.label;
      return `<article class="metric-card disk-metric-card"><div class="metric-icon coral"><svg viewBox="0 0 24 24">${icons.database}</svg></div><div><span title="${escapeHtml(volumeName)}">磁盘信息 · ${escapeHtml(volumeName)}</span><div class="metric-value-line"><strong>${percent.toFixed(0)}%</strong><em class="disk-temperature" title="${disk.temperature == null ? '暂无硬盘温度，需要 SMART 读取权限' : `硬盘 ${disk.temperature}°C`}">· ${temperature}</em></div><small>${formatBytes(disk.used)} / ${formatBytes(disk.total)}</small></div></article>`;
    }).join('') || '<article class="metric-card"><div class="metric-icon coral"><svg viewBox="0 0 24 24">${icons.database}</svg></div><div><span>磁盘信息</span><strong>不可用</strong><small>未读取到存储卷</small></div></article>';
    $('#host-status').textContent = `${data.hostname} 在线`;
    $('#monitor-note').textContent = `更新于 ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
  } catch (error) { $('#monitor-note').textContent = '读取失败，点击刷新重试'; toast(error.message); }
}

function fileUrl(entry, download = false) {
  const params = new URLSearchParams({ root: state.root, path: entry.path }); if (download) params.set('download', '1');
  return apiUrl(`/api/file?${params}`);
}

function renderBreadcrumbs() {
  const segments = state.path ? state.path.split('/') : [];
  const parts = [{ name: state.roots.find(root => root.id === state.root)?.label || '目录', path: '' }];
  segments.forEach((name, index) => parts.push({ name, path: segments.slice(0, index + 1).join('/') }));
  $('#breadcrumbs').innerHTML = parts.map((part, index) => `${index ? '<span class="crumb-separator">/</span>' : ''}<button class="crumb" data-path="${escapeHtml(part.path)}">${escapeHtml(part.name)}</button>`).join('');
}

function renderFiles() {
  renderBreadcrumbs(); renderFavorites(); $('#file-count').textContent = `${state.entries.length} 个项目`;
  const container = $('#file-list'); container.classList.toggle('grid', state.grid);
  if (!state.entries.length) { container.innerHTML = '<div class="empty-state">这个目录还是空的</div>'; return; }
  container.innerHTML = state.entries.map(entry => {
    const icon = icons[entry.type] || icons.file;
    const date = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(entry.modified));
    return `<div class="file-row" data-file-path="${escapeHtml(entry.path)}" role="button" tabindex="0"><span class="file-main"><span class="file-icon ${entry.type}"><svg viewBox="0 0 24 24">${icon}</svg></span><span class="file-name">${escapeHtml(entry.name)}</span></span><span class="file-size">${entry.type === 'folder' ? '文件夹' : formatBytes(entry.size)}</span><span class="file-date">${date}</span><button class="path-copy" type="button" data-copy-path="${escapeHtml(entry.absolutePath)}" aria-label="复制 ${escapeHtml(entry.name)} 的路径" title="复制路径"><svg viewBox="0 0 24 24">${icons.copy}</svg></button></div>`;
  }).join('');
}

function renderFavorites() {
  const isCurrent = item => item.root === state.root && item.path === state.path;
  $('#favorite-list').innerHTML = state.favorites.map(item => `<button class="favorite-chip${isCurrent(item) ? ' active' : ''}" data-favorite-id="${escapeHtml(item.id)}" title="${escapeHtml(item.path || item.title)}"><span>${escapeHtml(item.title)}</span><span class="favorite-remove" data-remove-favorite="${escapeHtml(item.id)}" role="button" aria-label="取消收藏 ${escapeHtml(item.title)}"><svg viewBox="0 0 24 24">${icons.close}</svg></span></button>`).join('') || '<span class="muted">暂无收藏</span>';
  const currentFavorite = state.favorites.some(isCurrent);
  $('#favorite-current').disabled = currentFavorite;
  $('#favorite-current').title = currentFavorite ? '当前目录已收藏' : '收藏当前目录';
}

async function loadFavorites() {
  try { state.favorites = (await request('/api/favorites')).items; renderFavorites(); } catch (error) { toast(error.message); }
}

async function loadFiles(nextPath = state.path) {
  if (!state.root) return;
  $('#copy-current-path').disabled = true;
  $('#file-list').innerHTML = '<div class="empty-state">正在打开目录…</div>';
  try {
    const data = await request(`/api/files?${new URLSearchParams({ root: state.root, path: nextPath, hidden: state.showHidden ? '1' : '0' })}`);
    state.path = data.path; state.absolutePath = data.absolutePath; state.entries = data.entries; renderFiles();
    $('#copy-current-path').disabled = !state.absolutePath;
    $('#file-hint').textContent = data.truncated ? '仅显示前 5000 项' : !state.showHidden && data.hiddenCount ? `已隐藏 ${data.hiddenCount} 项` : '安全只读模式';
  } catch (error) { $('#file-list').innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`; toast(error.message); }
}

async function openPreview(entry) {
  const modal = $('#preview-modal'); $('#preview-title').textContent = entry.name;
  $('#preview-meta').textContent = `${formatBytes(entry.size)} · 修改于 ${new Date(entry.modified).toLocaleString('zh-CN')}`; $('#download-file').href = fileUrl(entry, true);
  const body = $('#preview-body'); body.innerHTML = '<div class="preview-placeholder">正在准备预览…</div>'; modal.hidden = false; document.body.style.overflow = 'hidden';
  const source = fileUrl(entry);
  if (entry.type === 'image') body.innerHTML = `<img src="${source}" alt="${escapeHtml(entry.name)}">`;
  else if (entry.type === 'audio') body.innerHTML = `<audio src="${source}" controls autoplay></audio>`;
  else if (entry.type === 'video') body.innerHTML = `<video src="${source}" controls playsinline></video>`;
  else if (entry.type === 'pdf') body.innerHTML = `<iframe src="${source}" title="${escapeHtml(entry.name)}"></iframe>`;
  else if (entry.type === 'text') {
    try { const data = await request(`/api/text?${new URLSearchParams({ root: state.root, path: entry.path })}`); body.innerHTML = `<pre>${escapeHtml(data.content)}</pre>`; }
    catch (error) { body.innerHTML = `<div class="preview-placeholder">${escapeHtml(error.message)}</div>`; }
  } else {
    // 未知扩展名也尝试按 UTF-8 文本打开，服务端会拒绝二进制内容。
    try {
      const data = await request(`/api/text?${new URLSearchParams({ root: state.root, path: entry.path })}`);
      body.innerHTML = `<pre>${escapeHtml(data.content)}</pre>`;
    } catch {
      body.innerHTML = `<div class="preview-placeholder"><svg viewBox="0 0 24 24">${icons.file}</svg><p>暂不支持在线预览此格式</p><a class="primary-button" href="${fileUrl(entry, true)}">下载文件</a></div>`;
    }
  }
}

function closeModal(name) {
  $(`#${name}-modal`).hidden = true; document.body.style.overflow = ''; if (name === 'preview') $('#preview-body').innerHTML = '';
}

function renderLinks() {
  const card = (item, editable) => `<a class="link-card" href="${escapeHtml(item.url)}" target="_blank" rel="noopener"><span class="link-symbol" style="background:${item.color}">${escapeHtml(item.title.slice(0,1).toUpperCase())}</span><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.description || new URL(item.url).host)}</p>${item.notes ? `<button class="link-note" data-note-link="${escapeHtml(item.id)}" aria-label="查看 ${escapeHtml(item.title)} 的备注" title="查看备注"><svg viewBox="0 0 24 24">${icons.info}</svg></button>` : ''}${editable ? `<button class="link-menu" data-edit-link="${escapeHtml(item.id)}" aria-label="编辑 ${escapeHtml(item.title)}"><svg viewBox="0 0 24 24">${icons.more}</svg></button>` : ''}</a>`;
  $('#home-links').innerHTML = state.bookmarks.slice(0, 4).map(item => card(item, false)).join('') || '<div class="empty-state">还没有常用入口</div>';
  $('#link-count').textContent = `${state.bookmarks.length} 个地址`;
  $('#link-grid').innerHTML = state.bookmarks.map(item => card(item, true)).join('') || '<div class="empty-state">点击“添加地址”，创建你的第一个入口</div>';
}

async function loadLinks() {
  try { state.bookmarks = (await request('/api/bookmarks')).items; renderLinks(); } catch (error) { toast(error.message); }
}

function openLinkForm(item) {
  $('#link-form').reset(); $('#link-id').value = item?.id || ''; $('#link-title').value = item?.title || ''; $('#link-url').value = item?.url || '';
  $('#link-description').value = item?.description || ''; $('#link-notes').value = item?.notes || ''; $('#link-color').value = item?.color || '#5b8def'; $('#link-form-title').textContent = item ? '编辑地址' : '添加地址';
  $('#delete-link').hidden = !item; $('#link-modal').hidden = false; document.body.style.overflow = 'hidden'; setTimeout(() => $('#link-title').focus(), 80);
}

function openLinkNote(item) {
  if (!item?.notes) return;
  $('#note-title').textContent = item.title; $('#note-body').textContent = item.notes; $('#note-modal').hidden = false; document.body.style.overflow = 'hidden';
}

async function initialize() {
  setGreeting();
  $('#hidden-mode').classList.toggle('active', state.showHidden);
  $('#hidden-mode').setAttribute('aria-pressed', String(state.showHidden));
  try {
    const config = await request('/api/config'); state.roots = config.roots; state.root = config.roots[0]?.id || '';
    $('#root-select').innerHTML = config.roots.map(root => `<option value="${root.id}">${escapeHtml(root.label)}</option>`).join('');
  } catch (error) { toast(error.message); }
  await Promise.all([loadSystem(), loadLinks(), loadFavorites()]);
}

$$('[data-view]').forEach(node => node.addEventListener('click', () => switchView(node.dataset.view)));
$$('[data-view-target]').forEach(node => node.addEventListener('click', () => switchView(node.dataset.viewTarget)));
$('#refresh-button').addEventListener('click', () => state.view === 'home' ? loadSystem() : state.view === 'files' ? loadFiles() : state.view === 'links' ? loadLinks() : $('#speed-start').click());
$('#root-select').addEventListener('change', event => { state.root = event.target.value; state.path = ''; state.entries = []; loadFiles(''); });
$('#breadcrumbs').addEventListener('click', event => { const button = event.target.closest('[data-path]'); if (button) loadFiles(button.dataset.path); });
$('#favorite-current').addEventListener('click', async () => {
  try {
    await request('/api/favorites', { method: 'POST', body: JSON.stringify({ root: state.root, path: state.path }) });
    await loadFavorites(); toast('目录已收藏');
  } catch (error) { toast(error.message); }
});
$('#favorite-list').addEventListener('click', async event => {
  const remove = event.target.closest('[data-remove-favorite]');
  if (remove) {
    event.stopPropagation();
    try { await request(`/api/favorites/${encodeURIComponent(remove.dataset.removeFavorite)}`, { method: 'DELETE' }); await loadFavorites(); toast('已取消收藏'); } catch (error) { toast(error.message); }
    return;
  }
  const chip = event.target.closest('[data-favorite-id]');
  const favorite = state.favorites.find(item => item.id === chip?.dataset.favoriteId);
  if (!favorite) return;
  state.root = favorite.root; $('#root-select').value = favorite.root; state.entries = []; await loadFiles(favorite.path);
});
$('#file-list').addEventListener('click', event => {
  const copy = event.target.closest('[data-copy-path]');
  if (copy) { event.stopPropagation(); copyPath(copy.dataset.copyPath); return; }
  const row = event.target.closest('[data-file-path]'); if (!row) return; const entry = state.entries.find(item => item.path === row.dataset.filePath);
  if (entry?.type === 'folder') loadFiles(entry.path); else if (entry) openPreview(entry);
});
$('#file-list').addEventListener('keydown', event => {
  if (!['Enter', ' '].includes(event.key) || event.target.closest('[data-copy-path]')) return;
  const row = event.target.closest('[data-file-path]'); if (!row) return; event.preventDefault(); row.click();
});
$('#copy-current-path').addEventListener('click', () => { if (state.absolutePath) copyPath(state.absolutePath); });
$('#list-mode').addEventListener('click', () => { state.grid = false; $('#list-mode').classList.add('active'); $('#grid-mode').classList.remove('active'); renderFiles(); });
$('#grid-mode').addEventListener('click', () => { state.grid = true; $('#grid-mode').classList.add('active'); $('#list-mode').classList.remove('active'); renderFiles(); });
$('#hidden-mode').addEventListener('click', () => {
  state.showHidden = !state.showHidden;
  localStorage.setItem('allinone-show-hidden', state.showHidden ? '1' : '0');
  $('#hidden-mode').classList.toggle('active', state.showHidden);
  $('#hidden-mode').setAttribute('aria-pressed', String(state.showHidden));
  $('#hidden-mode').title = state.showHidden ? '隐藏隐藏项' : '显示隐藏项';
  loadFiles();
});
$$('[data-close]').forEach(node => node.addEventListener('click', () => closeModal(node.dataset.close)));
$$('.modal-backdrop').forEach(node => node.addEventListener('click', event => { if (event.target === node) closeModal(node.id.replace('-modal','')); }));
$('#add-link').addEventListener('click', () => openLinkForm());
$('#link-grid').addEventListener('click', event => {
  const noteButton = event.target.closest('[data-note-link]');
  if (noteButton) {
    event.preventDefault(); event.stopPropagation(); openLinkNote(state.bookmarks.find(link => link.id === noteButton.dataset.noteLink)); return;
  }
  const button = event.target.closest('[data-edit-link]'); if (!button) return; event.preventDefault(); event.stopPropagation();
  openLinkForm(state.bookmarks.find(item => item.id === button.dataset.editLink));
});
$('#home-links').addEventListener('click', event => {
  const noteButton = event.target.closest('[data-note-link]'); if (!noteButton) return;
  event.preventDefault(); event.stopPropagation(); openLinkNote(state.bookmarks.find(link => link.id === noteButton.dataset.noteLink));
});
$('#link-form').addEventListener('submit', async event => {
  event.preventDefault(); const id = $('#link-id').value;
  const body = { title: $('#link-title').value, url: $('#link-url').value, description: $('#link-description').value, notes: $('#link-notes').value, color: $('#link-color').value };
  try {
    await request(id ? `/api/bookmarks/${encodeURIComponent(id)}` : '/api/bookmarks', { method: id ? 'PUT' : 'POST', body: JSON.stringify(body) });
    closeModal('link'); await loadLinks(); toast(id ? '地址已更新' : '地址已添加');
  } catch (error) { toast(error.message); }
});
$('#delete-link').addEventListener('click', async () => {
  const id = $('#link-id').value; if (!id || !confirm('确定删除这个导航地址吗？')) return;
  try { await request(`/api/bookmarks/${encodeURIComponent(id)}`, { method: 'DELETE' }); closeModal('link'); await loadLinks(); toast('地址已删除'); } catch (error) { toast(error.message); }
});
document.addEventListener('keydown', event => { if (event.key === 'Escape') { if (!$('#preview-modal').hidden) closeModal('preview'); if (!$('#link-modal').hidden) closeModal('link'); if (!$('#note-modal').hidden) closeModal('note'); } });
document.addEventListener('visibilitychange', () => { if (!document.hidden && state.view === 'home' && Date.now() - state.lastSystemUpdate > 60000) loadSystem(); });

initialize();
