const musicState = { profiles: [], selected: '', results: [], playlist: [], favorites: [], libraryTab: 'playlist' };
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
function profileApi(action) { return `/api/modules/xiaoai-music/profiles/${encodeURIComponent(musicState.selected)}/${action}`; }
function musicToast(message) { const node = musicNode('toast'); node.textContent = message; node.classList.add('show'); setTimeout(() => node.classList.remove('show'), 2500); }
function escapeMusic(value) { return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]); }
function formatMusicBytes(value) { return Number(value) >= 1073741824 ? `${(value / 1073741824).toFixed(1)} GB` : `${(Number(value) / 1048576).toFixed(1)} MB`; }
function songTitle(song) { return song.title || song.name || song.path.split('/').pop(); }
function isFavorite(song) { return musicState.favorites.some(item => item.path === song.path); }
function musicRepeat() { const input = musicNode('music-repeat'); const value = Math.max(1, Math.min(20, Number(input.value) || 1)); input.value = value; return value; }

function switchLibraryTab(tab) {
  musicState.libraryTab = ['playlist', 'search', 'favorites'].includes(tab) ? tab : 'playlist';
  document.querySelectorAll('[data-library-tab]').forEach(node => node.classList.toggle('active', node.dataset.libraryTab === musicState.libraryTab));
  document.querySelectorAll('[data-library-panel]').forEach(node => { node.hidden = node.dataset.libraryPanel !== musicState.libraryTab; });
}

function trackMarkup(song, index, context) {
  const favorite = isFavorite(song);
  return `<article class="music-track${song.current ? ' current' : ''}">
    <button class="music-track-play" type="button" data-track-action="play" data-track-context="${context}" data-track-index="${index}" aria-label="播放 ${escapeMusic(songTitle(song))}"><span>▶</span></button>
    <div class="music-track-copy"><strong>${escapeMusic(songTitle(song))}</strong><span>${escapeMusic([song.artist, song.album].filter(Boolean).join(' · ') || song.name || '本地音乐')}</span><small>${song.size ? formatMusicBytes(song.size) : song.current ? '正在播放' : ''}</small></div>
    <div class="music-track-actions">
      ${context === 'search' ? `<button type="button" data-track-action="add" data-track-context="${context}" data-track-index="${index}">加入</button>` : ''}
      <button class="music-heart${favorite ? ' active' : ''}" type="button" data-track-action="favorite" data-track-context="${context}" data-track-index="${index}" aria-label="${favorite ? '取消喜欢' : '添加喜欢'}">${favorite ? '♥' : '♡'}</button>
      ${context === 'playlist' ? `<button class="danger" type="button" data-track-action="remove" data-track-context="${context}" data-track-index="${index}">移除</button>` : ''}
    </div>
  </article>`;
}

function renderCollections() {
  musicNode('music-playlist-count').textContent = musicState.playlist.length;
  musicNode('music-favorites-count').textContent = musicState.favorites.length;
  musicNode('music-playlist').innerHTML = musicState.playlist.map((song, index) => trackMarkup(song, index, 'playlist')).join('') || '<div class="empty-state">播放列表为空，去搜索歌曲添加吧</div>';
  musicNode('music-favorites').innerHTML = musicState.favorites.map((song, index) => trackMarkup(song, index, 'favorites')).join('') || '<div class="empty-state">还没有喜欢的歌曲</div>';
  renderMusicResults();
}

function renderMusicResults() {
  musicNode('music-results').innerHTML = musicState.results.map((song, index) => trackMarkup(song, index, 'search')).join('') || '<div class="empty-state">没有找到匹配歌曲</div>';
  musicNode('music-add-all').hidden = musicState.results.length === 0;
  musicNode('music-search-note').textContent = musicState.results.length ? `找到 ${musicState.results.length} 首歌曲` : '没有搜索结果';
}

function renderMusicStatus() {
  const profile = selectedProfile(); if (!profile) return;
  musicNode('music-online-dot').classList.toggle('offline', !profile.online);
  musicNode('music-status-text').textContent = profile.online ? `${profile.speakerConnected ? '音箱已连接' : '等待音箱连接'}${profile.listenerEnabled ? '' : ' · 语音监听已关闭'} · WS ${profile.wsPort}` : `离线 · ${profile.processError || '服务未启动'}`;
  musicNode('music-listener').textContent = profile.listenerEnabled ? '关闭语音监听' : '开启语音监听';
  musicNode('music-current-song').textContent = profile.currentSong || '当前未播放';
  musicNode('music-library-summary').textContent = `曲库 ${profile.librarySize ?? '--'} 首${profile.queueSize ? ` · 临时队列待播 ${profile.queueSize} 首` : ''}${profile.refreshing ? ' · 刷新中' : ''}`;
  const queue = Array.isArray(profile.queue) ? profile.queue : [];
  musicNode('music-runtime-queue').hidden = queue.length === 0;
  musicNode('music-runtime-queue-count').textContent = queue.length ? `正在播放 1 首 · 后续 ${Math.max(0, queue.length - 1)} 首` : '临时队列';
  musicNode('music-runtime-queue-list').innerHTML = queue.map((song, index) => `<div class="music-queue-item${song.current ? ' current' : ''}"><span class="music-queue-order">${song.current ? '播放中' : `待播 ${index}`}</span><strong>${escapeMusic(song.name || '未命名歌曲')}</strong><small>${song.durationSec ? `${Math.round(song.durationSec)} 秒` : ''}</small></div>`).join('');
  musicNode('music-volume').value = profile.volume ?? 30;
  musicNode('music-volume-value').value = profile.volume ?? 30;
}

async function loadMusicProfiles(keepSelection = true) {
  try {
    const data = await musicRequest('/api/modules/xiaoai-music/profiles'); musicState.profiles = data.profiles;
    if (!keepSelection || !data.profiles.some(item => item.id === musicState.selected)) musicState.selected = data.profiles[0]?.id || '';
    musicNode('music-speaker').innerHTML = data.profiles.map(item => `<option value="${escapeMusic(item.id)}">${escapeMusic(item.name)}</option>`).join('');
    musicNode('music-speaker').value = musicState.selected; renderMusicStatus();
  } catch (error) { musicToast(error.message); }
}

async function loadMusicCollection() {
  if (!musicState.selected) return;
  try { const data = await musicRequest(profileApi('collection')); musicState.playlist = data.playlist || []; musicState.favorites = data.favorites || []; renderCollections(); }
  catch (error) { musicToast(error.message); }
}

async function musicAction(action, payload = {}, success = '') {
  const profile = selectedProfile(); if (!profile?.online) return musicToast('音箱服务当前离线');
  try { await musicRequest(profileApi(action), { method: 'POST', body: JSON.stringify(payload) }); if (success) musicToast(success); await loadMusicProfiles(); }
  catch (error) { musicToast(error.message); }
}

async function updatePlaylist(songs, mode = 'append') {
  const data = await musicRequest(profileApi('playlist'), { method: 'POST', body: JSON.stringify({ songs, mode }) });
  musicState.playlist = data.playlist; renderCollections();
}

async function toggleFavorite(song) {
  const favorite = !isFavorite(song);
  const data = await musicRequest(profileApi('favorites'), { method: 'PUT', body: JSON.stringify({ song, favorite }) });
  musicState.favorites = data.favorites; renderCollections(); musicToast(favorite ? '已添加到我喜欢' : '已取消喜欢');
}

musicNode('music-search-form').addEventListener('submit', async event => {
  event.preventDefault(); const query = musicNode('music-query').value.trim(); if (!query) return;
  try { musicNode('music-results').innerHTML = '<div class="empty-state">正在搜索…</div>'; musicNode('music-search-note').textContent = '正在搜索'; musicNode('music-add-all').hidden = true; musicState.results = (await musicRequest(`${profileApi('search')}?q=${encodeURIComponent(query)}`)).items; renderMusicResults(); }
  catch (error) { musicToast(error.message); }
});

document.querySelectorAll('[data-library-tab]').forEach(node => node.addEventListener('click', () => switchLibraryTab(node.dataset.libraryTab)));
document.querySelectorAll('.music-track-list').forEach(list => list.addEventListener('click', async event => {
  const button = event.target.closest('[data-track-action]'); if (!button) return;
  const context = button.dataset.trackContext;
  const source = context === 'search' ? musicState.results : context === 'favorites' ? musicState.favorites : musicState.playlist;
  const index = Number(button.dataset.trackIndex), song = source[index]; if (!song) return;
  try {
    if (button.dataset.trackAction === 'play') {
      if (context === 'search') await musicAction('play', { path: song.path, repeat: musicRepeat() }, '已开始播放');
      else await musicAction('collection/play', { source: context, index, repeat: musicRepeat() }, '已开始播放列表');
    } else if (button.dataset.trackAction === 'add') { await updatePlaylist([song]); musicToast('已加入播放列表'); }
    else if (button.dataset.trackAction === 'favorite') await toggleFavorite(song);
    else if (button.dataset.trackAction === 'remove') { const data = await musicRequest(`${profileApi('playlist')}?path=${encodeURIComponent(song.path)}`, { method: 'DELETE' }); musicState.playlist = data.playlist; renderCollections(); }
  } catch (error) { musicToast(error.message); }
}));

musicNode('music-add-all').addEventListener('click', async () => { try { await updatePlaylist(musicState.results); musicToast(`已加入 ${musicState.results.length} 首歌曲`); } catch (error) { musicToast(error.message); } });
musicNode('music-play-all').addEventListener('click', () => musicAction('collection/play', { source: 'playlist', index: 0, repeat: musicRepeat() }, '已开始播放列表'));
musicNode('music-play-favorites').addEventListener('click', () => musicAction('collection/play', { source: 'favorites', index: 0, repeat: musicRepeat() }, '已开始播放我喜欢'));
musicNode('music-clear-playlist').addEventListener('click', async () => { if (!musicState.playlist.length || !confirm('确定清空播放列表吗？喜欢的歌曲不会受影响。')) return; try { await updatePlaylist([], 'replace'); musicToast('播放列表已清空'); } catch (error) { musicToast(error.message); } });
musicNode('music-speaker').addEventListener('change', async event => { musicState.selected = event.target.value; musicState.results = []; renderMusicResults(); renderMusicStatus(); await loadMusicCollection(); });
musicNode('music-random').addEventListener('click', () => musicAction('random', { repeat: musicRepeat() }, '已开始随机播放'));
musicNode('music-stop').addEventListener('click', () => musicAction('stop', {}, '已停止播放'));
musicNode('music-refresh-library').addEventListener('click', () => musicAction('refresh', {}, '曲库刷新完成'));
musicNode('music-listener').addEventListener('click', () => { const profile = selectedProfile(); musicAction('listener', { enabled: !profile.listenerEnabled }, profile.listenerEnabled ? '语音监听已关闭' : '语音监听已开启'); });
musicNode('music-volume').addEventListener('input', event => { musicNode('music-volume-value').value = event.target.value; });
musicNode('music-volume').addEventListener('change', event => musicAction('volume', { volume: Number(event.target.value) }, `音量已调到 ${event.target.value}`));

musicNode('music-speak-form').addEventListener('submit', async event => {
  event.preventDefault();
  const profile = selectedProfile(), text = musicNode('music-speak-text').value.trim();
  if (!profile?.online) return musicToast('音箱服务当前离线');
  if (!profile.speakerConnected) return musicToast('当前音箱尚未连接');
  if (!text) return musicToast('请输入要播报的文字');
  const button = musicNode('music-speak-submit');
  button.disabled = true; button.textContent = '发送中…';
  try {
    await musicRequest(profileApi('speak'), { method: 'POST', body: JSON.stringify({ text }) });
    musicNode('music-speak-text').value = '';
    musicToast('文字已发送给音箱');
  } catch (error) { musicToast(error.message); }
  finally { button.disabled = false; button.textContent = '发送播报'; }
});

musicNode('music-settings').addEventListener('click', () => { const profile = selectedProfile(); musicNode('music-config-name').value = profile.name; musicNode('music-config-dirs').value = profile.musicDirs.join('\n'); musicNode('music-config-url').value = profile.baseUrl; musicNode('music-config-limit').value = profile.maxResults; musicNode('music-config-interval').value = profile.refreshInterval; musicNode('music-config-play-keywords').value = profile.playKeywords.join('\n'); musicNode('music-config-stop-keywords').value = profile.stopKeywords.join('\n'); musicNode('music-config-refresh-keywords').value = profile.refreshKeywords.join('\n'); musicNode('music-config-random-keywords').value = profile.randomKeywords.join('\n'); musicNode('music-config-modal').hidden = false; });
document.querySelectorAll('[data-music-close]').forEach(node => node.addEventListener('click', () => { musicNode('music-config-modal').hidden = true; }));
musicNode('music-config-form').addEventListener('submit', async event => {
  event.preventDefault(); const profile = selectedProfile();
  try { const lines = id => musicNode(id).value.split(/\r?\n/); await musicRequest(`/api/modules/xiaoai-music/profiles/${encodeURIComponent(profile.id)}`, { method: 'PUT', body: JSON.stringify({ name: musicNode('music-config-name').value, musicDirs: lines('music-config-dirs'), baseUrl: musicNode('music-config-url').value, maxResults: Number(musicNode('music-config-limit').value), refreshInterval: Number(musicNode('music-config-interval').value), playKeywords: lines('music-config-play-keywords'), stopKeywords: lines('music-config-stop-keywords'), refreshKeywords: lines('music-config-refresh-keywords'), randomKeywords: lines('music-config-random-keywords') }) }); musicNode('music-config-modal').hidden = true; musicToast('配置已保存，音箱服务正在重启'); setTimeout(() => loadMusicProfiles().then(loadMusicCollection), 3500); }
  catch (error) { musicToast(error.message); }
});

document.addEventListener('xiaoai:refresh', () => loadMusicProfiles().then(loadMusicCollection));
switchLibraryTab('playlist');
loadMusicProfiles(false).then(loadMusicCollection);
setInterval(() => { if (!document.hidden && document.getElementById('music-view').classList.contains('active')) loadMusicProfiles(); }, 10000);
