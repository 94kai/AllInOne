export function setupFilePaths({ request, toast, onSaved }) {
  const node = id => document.getElementById(id);
  const modal = node('file-paths-modal');
  let revision = '';
  let saving = false;
  function close() { if (saving) return; modal.hidden = true; document.body.style.overflow = ''; node('file-paths-open').focus(); }
  node('file-paths-open').addEventListener('click', async () => {
    try {
      const config = await request('/api/modules/file-manager/config');
      revision = config.revision;
      node('file-paths-value').value = config.roots.map(root => `${root.label}:${root.path}`).join('\n');
      node('file-paths-error').textContent = '';
      modal.hidden = false; document.body.style.overflow = 'hidden'; node('file-paths-value').focus();
    } catch (error) { toast(error.message); }
  });
  modal.querySelectorAll('[data-file-paths-close]').forEach(button => button.addEventListener('click', close));
  modal.addEventListener('click', event => { if (event.target === modal) close(); });
  modal.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
  node('file-paths-form').addEventListener('submit', async event => {
    event.preventDefault(); if (saving) return;
    const button = event.submitter;
    saving = true; if (button) button.disabled = true;
    try {
      const roots = node('file-paths-value').value.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
        const separator = line.indexOf(':');
        if (separator <= 0) throw new Error('每行请填写“名称:绝对路径”，使用英文冒号');
        return { label: line.slice(0, separator).trim(), path: line.slice(separator + 1).trim() };
      });
      const config = await request('/api/modules/file-manager/config', { method: 'PUT', body: JSON.stringify({ roots, revision }) });
      saving = false; close(); await onSaved(config.roots); toast('快捷路径已保存');
    } catch (error) { node('file-paths-error').textContent = error.message; }
    finally { saving = false; if (button) button.disabled = false; }
  });
}
