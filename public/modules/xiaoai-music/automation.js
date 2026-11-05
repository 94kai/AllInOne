export function setupMusicAutomation({ request, state, node, escape, toast, profileApi, title }) {
  let config = null;
  let busy = false;
  let hits = [];
  const api = '/api/modules/xiaoai-music/automation';
  const newId = () => typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `auto-${Date.now().toString(36)}-${Array.from(crypto.getRandomValues(new Uint32Array(2)), value => value.toString(36)).join('-')}`;
  const panel = node('music-automation');
  const playlists = () => (config?.playlists || []).filter(list => list.profileId === state.selected);
  function render() {
    const lists = playlists();
    const selected = node('music-auto-list').value;
    node('music-auto-list').innerHTML = lists.map(list => `<option value="${escape(list.id)}">${escape(list.name)}（${list.songs.length} 首）</option>`).join('');
    if (lists.some(list => list.id === selected)) node('music-auto-list').value = selected;
    node('music-auto-rule-list').innerHTML = lists.map(list => `<option value="${escape(list.id)}">${escape(list.name)}</option>`).join('');
    renderSongs();
    node('music-auto-rules').innerHTML = (config?.rules || []).filter(rule => rule.profileId === state.selected).map(rule => {
      const list = lists.find(item => item.id === rule.playlistId);
      return `<article class="music-auto-row"><div><strong>${escape(list?.name || '歌单已移除')}</strong><small>${rule.enabled ? '已启用' : '已停用'} · ${rule.time ? `每天 ${escape(rule.time)}` : '无定时'} · ${rule.repeat} 轮${rule.phrase ? ` · 对小爱说：${escape(rule.phrase)}` : ''}</small></div><button type="button" data-rule-edit="${escape(rule.id)}">编辑</button><button type="button" data-rule-toggle="${escape(rule.id)}">${rule.enabled ? '停用' : '启用'}</button><button type="button" data-rule-delete="${escape(rule.id)}">删除</button></article>`;
    }).join('') || '<p>还没有规则，添加每日时间或语音提示词。</p>';
    renderStatus();
  }
  function renderStatus() {
    const profile = state.profiles.find(item => item.id === state.selected);
    const status = profile?.automation;
    const last = status?.last;
    node('music-auto-status').textContent = [profile?.name || '请选择音箱', '北京时间 · 每天执行', !profile?.online || !profile?.speakerConnected ? '音箱未连接' : '', profile?.listenerEnabled ? '' : '语音监听关闭，提示词暂不生效', status?.error || '', last ? `最近执行：${last.at} · ${last.playlist || ''} · ${{ success: '已发起播放', running: '执行中', failed: '失败' }[last.status] || last.status}${last.error ? `：${last.error}` : ''}` : '暂无执行记录'].filter(Boolean).join(' · ');
  }
  function renderSongs() {
    const list = listsSelected();
    node('music-auto-songs').innerHTML = list?.songs.map((song, index) => `<div class="music-auto-row"><span>${index + 1}. ${escape(title(song))}</span><button type="button" data-auto-remove="${index}">移除</button></div>`).join('') || '<p>歌单为空，可搜索添加歌曲，或导入当前播放列表。</p>';
  }
  function listsSelected() { return playlists().find(list => list.id === node('music-auto-list').value); }
  async function save(change) {
    if (busy || !config) { toast('请等待配置读取或保存完成'); throw new Error('配置尚未就绪'); }
    busy = true;
    panel.querySelectorAll('button').forEach(button => { button.disabled = true; });
    try {
      const next = structuredClone(config);
      change(next);
      config = await request(api, { method: 'PUT', body: JSON.stringify(next) });
      render(); toast('配置已保存');
    } catch (error) { toast(error.message); throw error; }
    finally { busy = false; panel.querySelectorAll('button').forEach(button => { button.disabled = false; }); }
  }
  async function load() {
    try { config = await request(api); hits = []; node('music-auto-hits').innerHTML = ''; resetRule(); render(); }
    catch (error) { node('music-auto-status').textContent = error.message; }
  }
  function resetRule() { node('music-auto-rule-form').reset(); node('music-auto-rule-id').value = ''; }
  panel.addEventListener('click', async event => {
    const button = event.target.closest('button'); if (!button) return;
    try {
      if (button.id === 'music-auto-refresh') return await load();
      if (button.id === 'music-auto-rule-cancel') return resetRule();
      if (button.id === 'music-auto-import') {
        const list = listsSelected(); if (!list) return toast('请先添加歌单');
        if (!state.playlist.length) return toast('当前播放列表为空');
        await save(next => { const target = next.playlists.find(item => item.id === list.id); for (const song of state.playlist) if (!target.songs.some(item => item.path === song.path)) target.songs.push(song); });
      }
      if (button.id === 'music-auto-list-delete') {
        const list = listsSelected(); if (!list || !confirm(`删除歌单“${list.name}”及关联规则？音乐文件会保留。`)) return;
        await save(next => { next.playlists = next.playlists.filter(item => item.id !== list.id); next.rules = next.rules.filter(rule => rule.playlistId !== list.id); });
      }
      if (button.id === 'music-auto-list-rename') {
        const list = listsSelected(); if (!list) return;
        const name = prompt('歌单名称', list.name); if (name === null) return;
        await save(next => { next.playlists.find(item => item.id === list.id).name = name; });
      }
      if (button.dataset.autoRemove !== undefined) {
        const list = listsSelected(); if (!list) return;
        await save(next => { next.playlists.find(item => item.id === list.id).songs.splice(Number(button.dataset.autoRemove), 1); });
      }
      if (button.dataset.autoAdd !== undefined) {
        const list = listsSelected(), song = hits[Number(button.dataset.autoAdd)];
        if (!list) return toast('请先添加歌单');
        await save(next => { const target = next.playlists.find(item => item.id === list.id); if (song && !target.songs.some(item => item.path === song.path)) target.songs.push(song); });
      }
      if (button.dataset.ruleEdit) {
        const rule = config.rules.find(item => item.id === button.dataset.ruleEdit);
        node('music-auto-rule-id').value = rule.id; node('music-auto-rule-list').value = rule.playlistId;
        node('music-auto-time').value = rule.time; node('music-auto-phrase').value = rule.phrase;
        node('music-auto-repeat').value = rule.repeat; node('music-auto-enabled').checked = rule.enabled;
        node('music-auto-rule-form').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
      if (button.dataset.ruleToggle) await save(next => { const rule = next.rules.find(item => item.id === button.dataset.ruleToggle); rule.enabled = !rule.enabled; });
      if (button.dataset.ruleDelete && confirm('删除这条播放规则？')) await save(next => { next.rules = next.rules.filter(item => item.id !== button.dataset.ruleDelete); });
    } catch { /* 错误已在保存入口显示。 */ }
  });
  node('music-auto-list').addEventListener('change', renderSongs);
  node('music-auto-list-form').addEventListener('submit', async event => {
    event.preventDefault();
    try { await save(next => next.playlists.push({ id: newId(), profileId: state.selected, name: node('music-auto-name').value, songs: [] })); node('music-auto-name').value = ''; node('music-auto-list').value = playlists().at(-1)?.id || ''; renderSongs(); } catch {}
  });
  node('music-auto-search').addEventListener('submit', async event => {
    event.preventDefault(); const selected = state.selected;
    node('music-auto-hits').textContent = '正在搜索…';
    try { const data = await request(`${profileApi('search')}?q=${encodeURIComponent(node('music-auto-query').value)}`); if (selected !== state.selected) return; hits = data.items; node('music-auto-hits').innerHTML = hits.map((song, index) => `<div class="music-auto-row"><span>${escape(title(song))}</span><button type="button" data-auto-add="${index}">加入歌单</button></div>`).join('') || '<p>没有匹配歌曲</p>'; }
    catch (error) { node('music-auto-hits').textContent = error.message; }
  });
  node('music-auto-rule-form').addEventListener('submit', async event => {
    event.preventDefault();
    const rule = { id: node('music-auto-rule-id').value || newId(), profileId: state.selected, playlistId: node('music-auto-rule-list').value, time: node('music-auto-time').value, phrase: node('music-auto-phrase').value, repeat: Number(node('music-auto-repeat').value), enabled: node('music-auto-enabled').checked };
    try { await save(next => { const index = next.rules.findIndex(item => item.id === rule.id); if (index < 0) next.rules.push(rule); else next.rules[index] = rule; }); resetRule(); } catch {}
  });
  return { load, renderStatus };
}
