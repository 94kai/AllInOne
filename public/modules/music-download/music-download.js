const downloadState = { results: [], files: [], jobs: [], roots: [], polling: 0, qrPolling: 0, qrId: '', directoryPath: '', directoryParent: null };
const downloadNode = id => document.getElementById(id);
const downloadApiBase = ({ 'devstudio.xuekai.top': 'https://aio.xuekai.top:8888' })[location.hostname]
  || (location.port === '8787' ? `${location.protocol}//${location.hostname}:2006` : '');

async function downloadRequest(url, options = {}) {
  const response = await fetch(`${downloadApiBase}${url}`, { ...options, credentials: 'include', headers: options.body ? { 'Content-Type': 'application/json' } : undefined });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `请求失败（${response.status}）`);
  return data;
}
function escapeDownload(value) { return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]); }
function formatDownloadBytes(value) { const units = ['B','KB','MB','GB']; let amount = Number(value)||0, index = 0; while(amount >= 1024 && index < units.length-1){ amount/=1024; index++; } return `${amount.toFixed(index ? 1 : 0)} ${units[index]}`; }
function formatDownloadDuration(value) { const seconds = Math.max(0, Math.round(Number(value)||0)); return seconds ? `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}` : '--:--'; }
function downloadToast(message) { const node = downloadNode('toast'); node.textContent = message; node.classList.add('show'); setTimeout(() => node.classList.remove('show'), 2500); }

function renderDownloadResults() {
  downloadNode('download-results').innerHTML = downloadState.results.map((song, index) => `<article class="download-song"><span class="download-source ${song.source==='netease-auth'?'authorized':''}" title="来源：${escapeDownload(song.sourceLabel || song.source)}">${escapeDownload(song.sourceLabel || song.source || '未知')}</span><div class="download-song-info"><strong>${escapeDownload(song.name || '未命名歌曲')}</strong><span>${escapeDownload([song.artist,song.album].filter(Boolean).join(' · ') || '未知歌手')} · ${formatDownloadDuration(song.duration)}${song.actualQuality ? ` · ${escapeDownload(song.actualQuality.toUpperCase())} · ${escapeDownload((song.fileType||'').toUpperCase())}` : ''}</span></div><button class="primary-button" data-download-result="${index}" type="button">下载</button></article>`).join('') || '<div class="empty-state">没有找到确认可下载的结果</div>';
}

function renderDownloadLibrary() {
  const active = downloadState.jobs.filter(job => ['queued','running'].includes(job.status));
  downloadNode('download-library-note').textContent = `${downloadState.files.length} 首${active.length ? ` · ${active.length} 个任务进行中` : ''}`;
  const jobs = downloadState.jobs.filter(job => job.status !== 'finished').map(job => `<div class="download-job ${job.status}"><strong>${escapeDownload(job.title)}</strong><span>${job.status==='queued'?'等待下载':job.status==='running'?'正在下载':escapeDownload(job.error || '下载失败')}</span></div>`).join('');
  const files = downloadState.files.map(file => `<div class="download-file"><input type="checkbox" value="${escapeDownload(file.name)}" aria-label="选择 ${escapeDownload(file.name)}"><div class="download-file-info"><strong>${escapeDownload(file.name)}</strong><span>${new Date(file.modified).toLocaleString('zh-CN')} · ${formatDownloadBytes(file.size)}</span></div><div class="download-file-actions"><button class="secondary-button" data-download-play="${escapeDownload(file.name)}" type="button">试听</button><button class="secondary-button" data-download-metadata="${escapeDownload(file.name)}" type="button">元信息</button><button class="secondary-button danger" data-download-delete="${escapeDownload(file.name)}" type="button">删除</button></div></div>`).join('');
  downloadNode('download-library').innerHTML = jobs + files || '<div class="empty-state">下载目录为空，先搜索一首歌曲吧</div>';
  updateMoveButton();
}

function updateMoveButton() { downloadNode('download-move').disabled = !downloadNode('download-library').querySelector('input:checked'); }

async function loadDownloadStatus() {
  try {
    const status = await downloadRequest('/api/modules/music-download/status');
    downloadNode('download-service-state').textContent = status.ready ? '搜索组件已就绪' : '首次搜索时自动安装组件';
    downloadNode('download-directory').textContent = `默认目录：${status.downloadDir}`;
    downloadNode('download-netease-state').textContent = status.netease.loggedIn ? '已登录，搜索将优先使用会员音质' : status.netease.secureStorageReady ? '未登录，当前使用公开来源' : '缺少安全密钥，暂时不能登录';
    downloadNode('download-netease-login').hidden = status.netease.loggedIn;
    downloadNode('download-netease-logout').hidden = !status.netease.loggedIn;
    downloadState.roots = status.roots;
    downloadNode('download-move-root').innerHTML = status.roots.map(root => `<option value="${escapeDownload(root.id)}">${escapeDownload(root.label)}</option>`).join('');
  } catch (error) { downloadNode('download-service-state').textContent = '组件检查失败'; downloadToast(error.message); }
}

async function loadDownloads() {
  try {
    const data = await downloadRequest('/api/modules/music-download/downloads');
    downloadState.files = data.items; downloadState.jobs = data.jobs; renderDownloadLibrary();
    const running = data.jobs.some(job => ['queued','running'].includes(job.status));
    clearTimeout(downloadState.polling); if (running) downloadState.polling = setTimeout(loadDownloads, 1800);
  } catch (error) { downloadToast(error.message); }
}

downloadNode('download-search-form').addEventListener('submit', async event => {
  event.preventDefault(); const query = downloadNode('download-query').value.trim(); if (!query) return;
  downloadNode('download-results').innerHTML = '<div class="empty-state">正在搜索多个音乐来源，首次使用可能需要安装组件…</div>';
  downloadNode('download-search-note').textContent = '正在搜索';
  try { const quality = downloadNode('download-quality').value; downloadState.results = (await downloadRequest(`/api/modules/music-download/search?q=${encodeURIComponent(query)}&quality=${encodeURIComponent(quality)}`)).items; renderDownloadResults(); downloadNode('download-search-note').textContent = `找到 ${downloadState.results.length} 条结果`; }
  catch (error) { downloadNode('download-results').innerHTML = `<div class="empty-state">${escapeDownload(error.message)}</div>`; downloadNode('download-search-note').textContent = '搜索失败'; downloadToast(error.message); }
});
downloadNode('download-results').addEventListener('click', async event => {
  const button = event.target.closest('[data-download-result]'); if (!button) return;
  const song = downloadState.results[Number(button.dataset.downloadResult)]; if (!song) return;
  button.disabled = true; button.textContent = '已加入';
  try { await downloadRequest('/api/modules/music-download/downloads', { method:'POST', body:JSON.stringify(song) }); downloadToast('已加入下载队列'); await loadDownloads(); }
  catch (error) { button.disabled = false; button.textContent = '下载'; downloadToast(error.message); }
});
downloadNode('download-library').addEventListener('change', updateMoveButton);
downloadNode('download-library').addEventListener('click', async event => {
  const metadata = event.target.closest('[data-download-metadata]'); if (metadata) return openDownloadMetadata(metadata.dataset.downloadMetadata);
  const play = event.target.closest('[data-download-play]');
  if (play) {
    const filename = play.dataset.downloadPlay, audio = downloadNode('download-player-audio');
    downloadState.playingFile = filename; downloadNode('download-player-title').textContent = filename; downloadNode('download-player').hidden = false;
    audio.src = `${downloadApiBase}/api/modules/music-download/audio?file=${encodeURIComponent(filename)}`; audio.play().catch(() => {}); return;
  }
  const remove = event.target.closest('[data-download-delete]');
  if (remove) {
    const filename = remove.dataset.downloadDelete;
    if (!confirm(`确定永久删除“${filename}”吗？此操作不可恢复。`)) return;
    try {
      const audio = downloadNode('download-player-audio');
      if (downloadState.playingFile === filename) { audio.pause(); audio.removeAttribute('src'); audio.load(); downloadState.playingFile = ''; downloadNode('download-player').hidden = true; }
      await downloadRequest(`/api/modules/music-download/downloads?file=${encodeURIComponent(filename)}`, { method:'DELETE' });
      downloadToast('歌曲已删除'); await loadDownloads();
    } catch (error) { downloadToast(error.message); }
  }
});
downloadNode('download-player-close').addEventListener('click', () => { const audio = downloadNode('download-player-audio'); audio.pause(); audio.removeAttribute('src'); audio.load(); downloadState.playingFile = ''; downloadNode('download-player').hidden = true; });
downloadNode('download-refresh').addEventListener('click', loadDownloads);
downloadNode('download-destinations').addEventListener('click', async () => {
  try {
    const data = await downloadRequest('/api/modules/music-download/config');
    downloadNode('download-destinations-value').value = data.moveRoots.map(root => `${root.label}:${root.path}`).join('\n');
    downloadNode('download-destinations-modal').hidden = false; document.body.style.overflow = 'hidden';
  } catch (error) { downloadToast(error.message); }
});
function closeDownloadDestinations() { downloadNode('download-destinations-modal').hidden = true; document.body.style.overflow = ''; }
document.querySelectorAll('[data-download-destinations-close]').forEach(button => button.addEventListener('click', closeDownloadDestinations));
downloadNode('download-destinations-modal').addEventListener('click', event => { if (event.target === downloadNode('download-destinations-modal')) closeDownloadDestinations(); });
downloadNode('download-destinations-form').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const moveRoots = downloadNode('download-destinations-value').value.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
      const separator = line.indexOf(':');
      if (separator < 1) throw new Error(`格式不正确：${line}`);
      return { label: line.slice(0, separator).trim(), path: line.slice(separator + 1).trim() };
    });
    await downloadRequest('/api/modules/music-download/config', { method:'PUT', body:JSON.stringify({ moveRoots }) });
    closeDownloadDestinations(); await loadDownloadStatus(); downloadToast('移动目的地已保存');
  } catch (error) { downloadToast(error.message); }
});
downloadNode('download-move').addEventListener('click', async () => {
  const files = [...downloadNode('download-library').querySelectorAll('input:checked')].map(input => input.value); if (!files.length) return;
  const destination = downloadNode('download-move-root').selectedOptions[0]?.textContent || '目标目录';
  if (!confirm(`将 ${files.length} 首歌曲移动到“${destination}”吗？`)) return;
  try { const data = await downloadRequest('/api/modules/music-download/move', { method:'POST', body:JSON.stringify({ files, root:downloadNode('download-move-root').value, path:downloadNode('download-move-path').value }) }); downloadToast(`已移动 ${data.moved.length} 首歌曲`); await loadDownloads(); }
  catch (error) { downloadToast(error.message); }
});
async function loadMoveDirectories(relative = '') {
  const root = downloadNode('download-move-root').value;
  downloadNode('download-directory-list').innerHTML = '<div class="empty-state">正在读取目录</div>';
  try {
    const data = await downloadRequest(`/api/modules/music-download/directories?root=${encodeURIComponent(root)}&path=${encodeURIComponent(relative)}`);
    downloadState.directoryPath = data.path; downloadState.directoryParent = data.parent;
    downloadNode('download-directory-current').textContent = `${data.root.label} / ${data.path || '根目录'}`;
    downloadNode('download-directory-up').disabled = data.parent === null;
    downloadNode('download-directory-list').innerHTML = data.directories.map(name => `<button type="button" data-download-directory="${escapeDownload(name)}"><span>📁</span><strong>${escapeDownload(name)}</strong><span>›</span></button>`).join('') || '<div class="empty-state">这里没有子目录</div>';
  } catch (error) { downloadNode('download-directory-list').innerHTML = `<div class="empty-state">${escapeDownload(error.message)}</div>`; }
}
function closeMoveDirectory() { downloadNode('download-directory-modal').hidden = true; document.body.style.overflow = ''; }
downloadNode('download-browse').addEventListener('click', () => { downloadNode('download-directory-modal').hidden = false; document.body.style.overflow = 'hidden'; loadMoveDirectories(downloadNode('download-move-path').value.trim()); });
downloadNode('download-directory-list').addEventListener('click', event => { const button = event.target.closest('[data-download-directory]'); if (!button) return; loadMoveDirectories([downloadState.directoryPath, button.dataset.downloadDirectory].filter(Boolean).join('/')); });
downloadNode('download-directory-up').addEventListener('click', () => { if (downloadState.directoryParent !== null) loadMoveDirectories(downloadState.directoryParent); });
downloadNode('download-directory-select').addEventListener('click', () => { downloadNode('download-move-path').value = downloadState.directoryPath; closeMoveDirectory(); });
document.querySelectorAll('[data-download-directory-close]').forEach(button => button.addEventListener('click', closeMoveDirectory));
downloadNode('download-directory-modal').addEventListener('click', event => { if (event.target === downloadNode('download-directory-modal')) closeMoveDirectory(); });
downloadNode('download-move-root').addEventListener('change', () => { downloadNode('download-move-path').value = ''; });
document.addEventListener('music-download:refresh', () => { loadDownloadStatus(); loadDownloads(); });

function closeNeteaseLogin() { clearTimeout(downloadState.qrPolling); downloadState.qrPolling = 0; downloadNode('download-netease-modal').hidden = true; document.body.style.overflow = ''; }
async function pollNeteaseQr() {
  if (!downloadState.qrId || downloadNode('download-netease-modal').hidden) return;
  try {
    const result = await downloadRequest(`/api/modules/music-download/netease/qr?id=${encodeURIComponent(downloadState.qrId)}`);
    downloadNode('download-netease-qr-state').textContent = result.state === 'confirming' ? '已扫码，请在 App 中确认' : result.state === 'authorized' ? '登录成功' : '等待扫码';
    if (result.loggedIn) { setTimeout(closeNeteaseLogin, 700); await loadDownloadStatus(); downloadToast('网易云登录成功'); return; }
    if (result.state === 'expired') return;
    downloadState.qrPolling = setTimeout(pollNeteaseQr, 2000);
  } catch (error) { downloadNode('download-netease-qr-state').textContent = error.message; }
}
async function createNeteaseQr() {
  clearTimeout(downloadState.qrPolling); downloadNode('download-netease-qr-state').textContent = '正在生成二维码'; downloadNode('download-netease-qr-image').removeAttribute('src');
  try { const { qr } = await downloadRequest('/api/modules/music-download/netease/qr', { method:'POST', body:'{}' }); downloadState.qrId = qr.id; downloadNode('download-netease-qr-image').src = qr.image; downloadNode('download-netease-qr-state').textContent = '等待扫码'; pollNeteaseQr(); }
  catch (error) { downloadNode('download-netease-qr-state').textContent = error.message; downloadToast(error.message); }
}
downloadNode('download-netease-login').addEventListener('click', () => { downloadNode('download-netease-modal').hidden = false; document.body.style.overflow = 'hidden'; createNeteaseQr(); });
downloadNode('download-netease-new-qr').addEventListener('click', createNeteaseQr);
downloadNode('download-netease-import').addEventListener('click', async () => {
  const cookie = downloadNode('download-netease-cookie').value.trim(); if (!cookie) return downloadToast('请先粘贴 Cookie');
  const button = downloadNode('download-netease-import'); button.disabled = true; button.textContent = '正在验证';
  try { await downloadRequest('/api/modules/music-download/netease/session', { method:'PUT', body:JSON.stringify({ cookie }) }); downloadNode('download-netease-cookie').value = ''; closeNeteaseLogin(); await loadDownloadStatus(); downloadToast('网易云登录成功'); }
  catch (error) { downloadToast(error.message); }
  finally { button.disabled = false; button.textContent = '导入 Cookie'; }
});
document.querySelectorAll('[data-download-netease-close]').forEach(button => button.addEventListener('click', closeNeteaseLogin));
downloadNode('download-netease-modal').addEventListener('click', event => { if (event.target === downloadNode('download-netease-modal')) closeNeteaseLogin(); });
downloadNode('download-netease-logout').addEventListener('click', async () => { if (!confirm('退出网易云账号并删除本机保存的登录状态吗？')) return; try { await downloadRequest('/api/modules/music-download/netease/session', { method:'DELETE' }); await loadDownloadStatus(); downloadToast('已退出网易云'); } catch (error) { downloadToast(error.message); } });

async function openDownloadMetadata(filename) {
  downloadNode('download-metadata-form').reset(); downloadNode('download-metadata-file').value = filename; downloadNode('download-metadata-token').value = '';
  downloadNode('download-metadata-summary').textContent = '正在读取音频信息…'; downloadNode('download-scrape-preview').hidden = true; downloadNode('download-scrape-candidates').innerHTML = '';
  downloadNode('download-metadata-modal').hidden = false; document.body.style.overflow = 'hidden';
  try {
    const meta = (await downloadRequest(`/api/modules/music-download/metadata?file=${encodeURIComponent(filename)}`)).metadata;
    downloadNode('download-metadata-title').value = meta.title; downloadNode('download-metadata-artist').value = meta.artist; downloadNode('download-metadata-album').value = meta.album;
    downloadNode('download-metadata-date').value = meta.date; downloadNode('download-metadata-genre').value = meta.genre; downloadNode('download-metadata-track').value = meta.track;
    downloadNode('download-metadata-summary').textContent = `${meta.codec?.toUpperCase() || '音频'} · ${formatDownloadDuration(meta.duration)} · ${meta.bitrate ? `${Math.round(meta.bitrate/1000)} kbps` : '未知码率'} · ${meta.hasCover ? '已有封面' : '无封面'}${meta.sourceLabel ? ` · 来源 ${meta.sourceLabel}` : ''}`;
  } catch (error) { downloadToast(error.message); closeDownloadMetadata(); }
}
function closeDownloadMetadata() { downloadNode('download-metadata-modal').hidden = true; document.body.style.overflow = ''; }
document.querySelectorAll('[data-download-metadata-close]').forEach(button => button.addEventListener('click', closeDownloadMetadata));
downloadNode('download-metadata-modal').addEventListener('click', event => { if (event.target === downloadNode('download-metadata-modal')) closeDownloadMetadata(); });
downloadNode('download-scrape').addEventListener('click', async () => {
  const button = downloadNode('download-scrape'); button.disabled = true; button.textContent = '正在匹配…';
  try {
    const title = downloadNode('download-metadata-title').value.trim(); if (!title) throw new Error('请先输入歌曲名再刮削');
    const data = await downloadRequest('/api/modules/music-download/scrape', { method:'POST', body:JSON.stringify({ filename:downloadNode('download-metadata-file').value, title, artist:downloadNode('download-metadata-artist').value.trim() }) });
    downloadNode('download-metadata-token').value = '';
    const preview = downloadNode('download-scrape-preview'); preview.hidden = false;
    downloadNode('download-scrape-candidates').innerHTML = data.candidates.map((song, index) => `<button class="download-scrape-candidate" type="button" data-scrape-candidate="${index}">${song.coverUrl ? `<img src="${escapeDownload(song.coverUrl)}" alt="" referrerpolicy="no-referrer">` : '<span class="download-cover-empty">无封面</span>'}<span class="download-scrape-info"><strong>${escapeDownload(song.name)}</strong><span>${escapeDownload([song.artist,song.album].filter(Boolean).join(' · ') || '未知歌手')}</span><small>${escapeDownload(song.sourceLabel || song.source)} · ${formatDownloadDuration(song.duration)}</small></span></button>`).join('');
    preview._candidates = data.candidates;
    downloadToast(`找到 ${data.candidates.length} 个候选，请选择`);
  } catch (error) { downloadToast(error.message); }
  finally { button.disabled = false; button.textContent = '自动刮削'; }
});
downloadNode('download-scrape-candidates').addEventListener('click', event => {
  const button = event.target.closest('[data-scrape-candidate]'); if (!button) return;
  const preview = downloadNode('download-scrape-preview'); const song = preview._candidates?.[Number(button.dataset.scrapeCandidate)]; if (!song) return;
  preview.querySelectorAll('.download-scrape-candidate').forEach(node => node.classList.toggle('selected', node === button));
  downloadNode('download-metadata-token').value = song.token;
  downloadNode('download-metadata-title').value = song.name || downloadNode('download-metadata-title').value; downloadNode('download-metadata-artist').value = song.artist || downloadNode('download-metadata-artist').value; downloadNode('download-metadata-album').value = song.album || downloadNode('download-metadata-album').value;
  downloadToast('已选择候选，请确认信息后保存');
});
downloadNode('download-metadata-form').addEventListener('submit', async event => {
  event.preventDefault(); const submit = event.submitter; if (submit) submit.disabled = true;
  const value = id => downloadNode(id).value;
  try {
    await downloadRequest('/api/modules/music-download/metadata', { method:'PUT', body:JSON.stringify({ filename:value('download-metadata-file'), scrapeToken:value('download-metadata-token'), title:value('download-metadata-title'), artist:value('download-metadata-artist'), album:value('download-metadata-album'), date:value('download-metadata-date'), genre:value('download-metadata-genre'), track:value('download-metadata-track') }) });
    closeDownloadMetadata(); downloadToast('元信息已写入音频文件'); await loadDownloads();
  } catch (error) { downloadToast(error.message); }
  finally { if (submit) submit.disabled = false; }
});
loadDownloadStatus(); loadDownloads();
