export function setupFileShares({ request, toast, target, absoluteUrl }) {
  const node = id => document.getElementById(id);
  const modal = node('file-share-modal');
  const manager = node('file-shares-modal');
  const list = node('file-shares-list');
  const status = node('file-shares-status');
  let loading = false;
  let fromManager = false;
  let saving = false;
  let draft = null;
  let opening = false;
  function statsText(item) {
    return `访问 ${item.visits || 0} 次 · 最近访问：${item.lastVisitedAt ? new Date(item.lastVisitedAt).toLocaleString('zh-CN') : '暂无'} `;
  }
  function showShare(item) {
    current = item;
    if (item.id) draft = null;
    const exists = Boolean(item.id);
    node('file-share-title').textContent = exists ? '文件分享链接' : '创建文件分享';
    node('file-share-url-field').hidden = !exists;
    node('file-share-copy').hidden = !exists;
    node('file-share-revoke').hidden = !exists;
    node('file-share-cancel').hidden = exists;
    node('file-share-save').textContent = exists ? '保存设置' : '创建分享';
    node('file-share-name').textContent = item.name;
    node('file-share-url').value = exists ? absoluteUrl(item.url) : '';
    node('file-share-mode').value = item.mode;
    node('file-share-slug').value = item.slug;
    node('file-share-stats').textContent = exists ? statsText(item) : '尚未分享。点击“创建分享”后，拥有链接的人即可免登录访问此文件。';
    node('file-share-error').textContent = '';
    modal.hidden = false; document.body.style.overflow = 'hidden';
    if (exists) { node('file-share-url').focus(); node('file-share-url').select(); }
    else node('file-share-mode').focus();
  }
  async function copy(input) {
    try { await navigator.clipboard.writeText(input.value); toast('分享链接已复制'); }
    catch { input.focus(); input.select(); toast(document.execCommand('copy') ? '分享链接已复制' : '请长按链接复制'); }
  }
  function element(tag, text, className) {
    const el = document.createElement(tag); el.textContent = text;
    if (className) el.className = className;
    return el;
  }
  async function refresh() {
    if (loading) return;
    loading = true; node('file-shares-refresh').disabled = true;
    status.textContent = '正在读取分享…'; list.replaceChildren();
    try {
      const { shares } = await request('/api/modules/file-manager/shares');
      status.textContent = shares.length ? `共 ${shares.length} 个分享` : '暂无分享，在文件旁点击“链接”即可添加';
      for (const item of shares) {
        const row = element('article', '', 'file-shares-row');
        const heading = element('div', '', 'file-shares-heading');
        heading.append(element('strong', item.name), element('span', item.available ? '可访问' : '不可用', item.available ? 'share-available' : 'share-unavailable'));
        const time = new Date(item.createdAt);
        const detail = element('p', `${item.rootLabel} / ${item.path} · ${Number.isNaN(time.getTime()) ? '时间未知' : time.toLocaleString('zh-CN')}`);
        const stats = element('p', `${item.mode === 'download' ? '直接下载' : '浏览器预览'} · ${statsText(item)}`);
        const input = element('input', ''); input.readOnly = true; input.value = absoluteUrl(item.url); input.setAttribute('aria-label', `${item.name} 的分享链接`);
        const actions = element('div', '', 'file-shares-actions');
        const copyButton = element('button', '复制链接', 'secondary-button'); copyButton.type = 'button';
        copyButton.addEventListener('click', () => copy(input));
        const revokeButton = element('button', '取消分享', 'secondary-button danger'); revokeButton.type = 'button';
        revokeButton.addEventListener('click', async () => {
          revokeButton.disabled = true;
          try {
            await request(`/api/modules/file-manager/shares/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
            toast('分享已取消，文件保留'); await refresh();
          } catch (error) { toast(error.message); }
          finally { revokeButton.disabled = false; }
        });
        const editButton = element('button', '设置', 'secondary-button'); editButton.type = 'button';
        editButton.addEventListener('click', () => { fromManager = true; manager.hidden = true; showShare(item); });
        actions.append(editButton, copyButton, revokeButton); row.append(heading, detail, stats, input, actions); list.append(row);
      }
    } catch (error) { status.textContent = `读取失败：${error.message}，可点击刷新重试`; }
    finally { loading = false; node('file-shares-refresh').disabled = false; }
  }
  function closeManager() { manager.hidden = true; document.body.style.overflow = ''; node('file-shares-open').focus(); }
  node('file-shares-open').addEventListener('click', () => {
    manager.hidden = false; document.body.style.overflow = 'hidden';
    manager.querySelector('[data-file-shares-close]').focus(); refresh();
  });
  node('file-shares-refresh').addEventListener('click', refresh);
  manager.querySelectorAll('[data-file-shares-close]').forEach(button => button.addEventListener('click', closeManager));
  manager.addEventListener('click', event => { if (event.target === manager) closeManager(); });
  manager.addEventListener('keydown', event => { if (event.key === 'Escape') closeManager(); });
  let current = null;
  function close() {
    if (saving) return;
    modal.hidden = true; document.body.style.overflow = '';
    draft = null; current = null;
    if (fromManager) { fromManager = false; manager.hidden = false; document.body.style.overflow = 'hidden'; manager.querySelector('[data-file-shares-close]').focus(); refresh(); }
  }
  node('file-list').addEventListener('click', async event => {
    const button = event.target.closest('[data-share-path]'); if (!button) return;
    event.stopImmediatePropagation();
    if (opening || saving || !modal.hidden) return;
    opening = true; button.disabled = true;
    try {
      const selection = target(button.dataset.sharePath);
      const result = await request(`/api/modules/file-manager/shares/lookup?${new URLSearchParams(selection)}`);
      fromManager = false; draft = result.share ? null : selection;
      showShare(result.share || { name: result.name, mode: 'preview', slug: '' });
    } catch (error) { toast(error.message); }
    finally { opening = false; button.disabled = false; }
  }, true);
  node('file-share-copy').addEventListener('click', () => copy(node('file-share-url')));
  node('file-share-save').addEventListener('click', async () => {
    if (!current || saving) return;
    saving = true; node('file-share-save').disabled = true; node('file-share-revoke').disabled = true;
    node('file-share-error').textContent = '';
    try {
      const creating = Boolean(draft);
      const settings = { mode: node('file-share-mode').value, slug: node('file-share-slug').value };
      const item = await request(creating ? '/api/modules/file-manager/shares' : `/api/modules/file-manager/shares/${encodeURIComponent(current.id)}`, { method: creating ? 'POST' : 'PATCH', body: JSON.stringify(creating ? { ...draft, ...settings } : settings) });
      showShare(item); toast(creating ? '分享已创建，可复制链接' : '分享设置已保存，可复制最新链接');
    } catch (error) { node('file-share-error').textContent = error.message; }
    finally { saving = false; node('file-share-save').disabled = false; node('file-share-revoke').disabled = false; }
  });
  node('file-share-revoke').addEventListener('click', async event => {
    if (!current) return;
    const button = event.currentTarget; button.disabled = true;
    try { await request(`/api/modules/file-manager/shares/${encodeURIComponent(current.id)}`, { method: 'DELETE' }); close(); current = null; toast('分享已取消，旧链接已失效'); }
    catch (error) { toast(error.message); }
    finally { button.disabled = false; }
  });
  modal.querySelectorAll('[data-file-share-close]').forEach(button => button.addEventListener('click', close));
  modal.addEventListener('click', event => { if (event.target === modal) { event.stopImmediatePropagation(); close(); } }, true);
  modal.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
}
