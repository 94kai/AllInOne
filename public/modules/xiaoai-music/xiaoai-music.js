const musicState = { profiles: [], selected: '', results: [], loading: false };
const musicNode = id => document.getElementById(id);
const musicApiBase = ({ 'devstudio.xuekai.top': 'https://aio.xuekai.top:8888' })[location.hostname]
  || (location.port === '8787' ? `${location.protocol}//${location.hostname}:2006` : '');

async function musicRequest(url, options = {}) {
  const response = await fetch(`${musicApiBase}${url}`, { ...options, credentials: 'include', headers: options.body ? { 'Content-Type': 'application/json' } : undefined });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `请求失败（${response.status}）`);
  return data;
}

function selectedProfile() { return musicState.profiles.find(profile => profile.id === musicState.selected); }
function musicToast(message) { const node = musicNode('toast'); node.textContent = message; node.classList.add('show'); setTimeout(() => node.classList.remove('show'), 2500); }
function escapeMusic(value) { return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]); }
function formatMusicBytes(value) { return value >= 1073741824 ? `${(value / 1073741824).toFixed(1)} GB` : `${(value / 1048576).toFixed(1)} MB`; }
function formatDuration(seconds) { const value = Math.max(0, Math.round(Number(seconds) || 0)); return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`; }

function renderMusicQueue(profile) {
  const queue = profile.queue || [];
  musicNode('music-queue-panel').hidden = queue.length === 0;
  musicNode('music-queue-count').textContent = queue.length ? `${queue.length} 首` : '';
  musicNode('music-queue').innerHTML = queue.map((song, index) => `<div class="music-queue-item${song.current ? ' current' : ''}"><span class="music-queue-order">${song.current ? '播放中' : index + 1}</span><strong title="${escapeMusic(song.path)}">${escapeMusic(song.name)}</strong><small>${formatDuration(song.durationSec)}</small></div>`).join('');
}

function renderMusicStatus() {
  const profile = selectedProfile(); if (!profile) return;
  musicNode('music-online-dot').classList.toggle('offline', !profile.online);
  musicNode('music-status-text').textContent = profile.online ? `${profile.listenerEnabled ? (profile.speakerConnected ? '音箱已连接' : '等待音箱连接') : '语音监听已关闭'} · WS ${profile.wsPort}` : `离线 · ${profile.processError || '服务未启动'}`;
  musicNode('music-listener').textContent = profile.listenerEnabled ? '关闭语音监听' : '开启语音监听';
  musicNode('music-summary').innerHTML = `<span>曲库 ${profile.librarySize ?? '--'} 首${profile.refreshing ? ' · 刷新中' : ''}</span><span>${profile.currentSong ? `正在播放：${escapeMusic(profile.currentSong)} · 队列 ${profile.queueSize}` : '当前未播放'}</span>`;
  renderMusicQueue(profile);
}

async function loadMusicProfiles(keepSelection = true) {
  try {
    const data = await musicRequest('/api/modules/xiaoai-music/profiles');
    musicState.profiles = data.profiles;
    if (!keepSelection || !data.profiles.some(item => item.id === musicState.selected)) musicState.selected = data.profiles[0]?.id || '';
    musicNode('music-speaker').innerHTML = data.profiles.map(item => `<option value="${escapeMusic(item.id)}">${escapeMusic(item.name)}</option>`).join('');
    musicNode('music-speaker').value = musicState.selected; renderMusicStatus();
  } catch (error) { musicToast(error.message); }
}

function renderMusicResults() {
  musicNode('music-results').innerHTML = musicState.results.map((song, index) => `<article class="music-song"><div class="music-song-index">${index + 1}</div><div><strong>${escapeMusic(song.title || song.name)}</strong><span>${escapeMusic([song.artist, song.album].filter(Boolean).join(' · ') || song.name)}</span><small>${formatMusicBytes(song.size)}</small></div><button class="primary-button" type="button" data-play-path="${escapeMusic(song.path)}">播放</button></article>`).join('') || '<div class="empty-state">没有找到匹配歌曲</div>';
}

async function musicAction(action, payload = {}, success = '') {
  const profile = selectedProfile(); if (!profile?.online) return musicToast('音箱服务当前离线');
  try {
    await musicRequest(`/api/modules/xiaoai-music/profiles/${encodeURIComponent(profile.id)}/${action}`, { method: 'POST', body: JSON.stringify(payload) });
    if (success) musicToast(success); await loadMusicProfiles();
  } catch (error) { musicToast(error.message); }
}

musicNode('music-search-form').addEventListener('submit', async event => {
  event.preventDefault(); const query = musicNode('music-query').value.trim(); if (!query) return;
  try { musicNode('music-results').innerHTML = '<div class="empty-state">正在搜索…</div>'; musicState.results = (await musicRequest(`/api/modules/xiaoai-music/profiles/${encodeURIComponent(musicState.selected)}/search?q=${encodeURIComponent(query)}`)).items; renderMusicResults(); }
  catch (error) { musicToast(error.message); }
});
musicNode('music-results').addEventListener('click', event => { const button = event.target.closest('[data-play-path]'); if (button) musicAction('play', { path: button.dataset.playPath }, '已发送播放指令'); });
musicNode('music-speaker').addEventListener('change', event => { musicState.selected = event.target.value; musicState.results = []; musicNode('music-results').innerHTML = '<div class="empty-state">输入关键词搜索曲库</div>'; renderMusicStatus(); });
musicNode('music-random').addEventListener('click', () => musicAction('random', {}, '已开始随机播放'));
musicNode('music-stop').addEventListener('click', () => musicAction('stop', {}, '已停止播放'));
musicNode('music-refresh-library').addEventListener('click', () => musicAction('refresh', {}, '曲库刷新完成'));
musicNode('music-listener').addEventListener('click', () => { const profile = selectedProfile(); musicAction('listener', { enabled: !profile.listenerEnabled }, profile.listenerEnabled ? '语音监听已关闭' : '语音监听已开启'); });
musicNode('music-settings').addEventListener('click', () => { const profile = selectedProfile(); musicNode('music-config-name').value = profile.name; musicNode('music-config-dirs').value = profile.musicDirs.join('\n'); musicNode('music-config-url').value = profile.baseUrl; musicNode('music-config-limit').value = profile.maxResults; musicNode('music-config-interval').value = profile.refreshInterval; musicNode('music-config-play-keywords').value = profile.playKeywords.join('\n'); musicNode('music-config-stop-keywords').value = profile.stopKeywords.join('\n'); musicNode('music-config-refresh-keywords').value = profile.refreshKeywords.join('\n'); musicNode('music-config-random-keywords').value = profile.randomKeywords.join('\n'); musicNode('music-config-modal').hidden = false; });
document.querySelectorAll('[data-music-close]').forEach(node => node.addEventListener('click', () => { musicNode('music-config-modal').hidden = true; }));
musicNode('music-config-form').addEventListener('submit', async event => {
  event.preventDefault(); const profile = selectedProfile();
  try {
    const lines = id => musicNode(id).value.split(/\r?\n/);
    await musicRequest(`/api/modules/xiaoai-music/profiles/${encodeURIComponent(profile.id)}`, { method: 'PUT', body: JSON.stringify({ name: musicNode('music-config-name').value, musicDirs: lines('music-config-dirs'), baseUrl: musicNode('music-config-url').value, maxResults: Number(musicNode('music-config-limit').value), refreshInterval: Number(musicNode('music-config-interval').value), playKeywords: lines('music-config-play-keywords'), stopKeywords: lines('music-config-stop-keywords'), refreshKeywords: lines('music-config-refresh-keywords'), randomKeywords: lines('music-config-random-keywords') }) });
    musicNode('music-config-modal').hidden = true; musicToast('配置已保存，音箱服务正在重启'); setTimeout(loadMusicProfiles, 3500);
  } catch (error) { musicToast(error.message); }
});
document.addEventListener('xiaoai:refresh', () => loadMusicProfiles());
loadMusicProfiles(false);
setInterval(() => { if (!document.hidden && document.getElementById('music-view').classList.contains('active')) loadMusicProfiles(); }, 10000);
