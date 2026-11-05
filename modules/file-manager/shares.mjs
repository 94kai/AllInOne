import { mkdir, readFile, writeFile, rename, stat, open } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const missing = () => Object.assign(new Error('分享不存在、已取消或文件已失效'), { status: 404 });
const previewTypes = { '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.mp4': 'video/mp4', '.webm': 'video/webm' };
export class FileShares {
  constructor(dataDir, resolve) {
    this.file = path.join(dataDir, 'file-manager', 'shares.json');
    this.resolve = resolve; this.items = []; this.writes = Promise.resolve();
  }
  async initialize() {
    try {
      const items = JSON.parse(await readFile(this.file, 'utf8'));
      if (!Array.isArray(items)) throw new Error('格式无效');
      this.items = items;
    } catch (error) {
      if (error.code !== 'ENOENT') { this.error = '分享配置读取失败'; console.error(this.error, error.message); }
    }
  }
  check() { if (this.error) throw Object.assign(new Error(this.error), { status: 503 }); }
  describe(item) {
    return { id: item.id, name: item.name, url: `/share/${item.slug || item.token}`, slug: item.slug || '', mode: item.mode || 'preview', visits: item.visits || 0, lastVisitedAt: item.lastVisitedAt || null };
  }
  update(id, input) {
    return this.mutate(items => {
      const item = items.find(item => item.id === id);
      if (!item) throw missing();
      this.applySettings(items, item, input);
      return this.describe(item);
    });
  }
  applySettings(items, item, input) {
    if (!input || !['preview', 'download'].includes(input.mode) || typeof input.slug !== 'string') throw Object.assign(new Error('请填写打开方式和链接后缀'), { status: 400 });
    const slug = input.slug.trim();
    if (slug && !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(slug)) throw Object.assign(new Error('链接后缀须为 1–64 位英文字母、数字、短横线或下划线，以字母或数字开头'), { status: 400 });
    if (slug && items.some(other => other.id !== item.id && (other.slug === slug || other.token === slug))) throw Object.assign(new Error('此链接后缀已被使用，请换一个'), { status: 409 });
    item.slug = slug; item.mode = input.mode;
  }
  async lookup(input) {
    this.check();
    const target = await this.resolve(input.root, input.path);
    const info = await stat(target.target);
    if (!info.isFile()) throw Object.assign(new Error('仅支持分享单个文件'), { status: 400 });
    const item = this.items.find(item => item.root === target.root.id && item.path === target.relative && item.dev === info.dev && item.ino === info.ino);
    return { name: path.basename(target.target), share: item ? this.describe(item) : null };
  }
  async list() {
    this.check();
    const items = [...this.items].reverse();
    const result = [];
    // 分批检查，避免大量分享同时占用文件系统资源。
    for (let offset = 0; offset < items.length; offset += 8) {
      result.push(...await Promise.all(items.slice(offset, offset + 8).map(async item => {
        let available = false, rootLabel = item.root;
        try {
          const target = await this.resolve(item.root, item.path);
          rootLabel = target.root.label;
          const info = await stat(target.target);
          available = info.isFile() && info.dev === item.dev && info.ino === item.ino;
        } catch { /* 文件或目录不可用时保留记录，仍可取消分享。 */ }
        return { ...this.describe(item), path: item.path, rootLabel, createdAt: item.createdAt, available };
      })));
    }
    return { shares: result };
  }
  async mutate(fn) {
    const operation = this.writes.catch(() => {}).then(async () => {
      this.check();
      const next = structuredClone(this.items);
      const result = await fn(next);
      await mkdir(path.dirname(this.file), { recursive: true });
      try {
        await writeFile(`${this.file}.tmp`, JSON.stringify(next, null, 2), { mode: 0o600 });
        await rename(`${this.file}.tmp`, this.file);
      } catch (error) {
        console.error('分享记录保存失败：', error.code);
        throw Object.assign(new Error('分享记录保存失败，请检查存储后重试'), { status: 503 });
      }
      this.items = next;
      return result;
    });
    this.writes = operation; return operation;
  }
  create(input) {
    return this.mutate(async items => {
      const target = await this.resolve(String(input?.root || ''), String(input?.path || ''));
      const info = await stat(target.target);
      if (!info.isFile()) throw Object.assign(new Error('仅支持分享单个文件'), { status: 400 });
      let item = items.find(item => item.root === target.root.id && item.path === target.relative);
      if (item && (item.dev !== info.dev || item.ino !== info.ino)) { items.splice(items.indexOf(item), 1); item = null; }
      if (!item) {
        if (items.length >= 1000) throw Object.assign(new Error('分享数量已达 1000，请先取消部分分享'), { status: 400 });
        item = { id: crypto.randomUUID(), token: crypto.randomBytes(32).toString('base64url'), root: target.root.id, path: target.relative, name: path.basename(target.target), dev: info.dev, ino: info.ino, createdAt: new Date().toISOString() };
        this.applySettings(items, item, { mode: input.mode ?? 'preview', slug: input.slug ?? '' });
        items.push(item);
      }
      return this.describe(item);
    });
  }
  revoke(id) { return this.mutate(items => { const index = items.findIndex(item => item.id === id); if (index >= 0) items.splice(index, 1); return { revoked: true }; }); }
  async serve(req, res, token) {
    this.check();
    const item = this.items.find(item => (item.slug || item.token) === token);
    if (!item || !/^[\w-]{1,64}$/.test(token)) throw missing();
    let handle;
    try {
      const target = await this.resolve(item.root, item.path);
      handle = await open(target.target, 'r');
      const info = await handle.stat();
      if (!info.isFile() || info.dev !== item.dev || info.ino !== item.ino) throw missing();
      const type = item.mode !== 'download' && previewTypes[path.extname(item.name).toLowerCase()];
      // 不允许同源权限或联网：HTML 可运行内嵌脚本，但不能使用管理站的 Cookie、存储和 API。
      const headers = { 'Content-Type': type || 'application/octet-stream', 'Content-Disposition': `${type ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(item.name)}`, 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'", 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store', 'Accept-Ranges': 'bytes' };
      let start = 0, end = info.size - 1, status = 200;
      if (req.headers.range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
        if (!match || (!match[1] && !match[2])) { res.writeHead(416, { ...headers, 'Content-Range': `bytes */${info.size}` }); res.end(); return; }
        start = match[1] ? Number(match[1]) : Math.max(0, info.size - Number(match[2]));
        end = match[1] && match[2] ? Math.min(Number(match[2]), info.size - 1) : info.size - 1;
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= info.size) { res.writeHead(416, { ...headers, 'Content-Range': `bytes */${info.size}` }); res.end(); return; }
        status = 206; headers['Content-Range'] = `bytes ${start}-${end}/${info.size}`;
      }
      if (req.method === 'GET' && (!req.headers.range || start === 0)) {
        await this.mutate(items => {
          const latest = items.find(candidate => candidate.id === item.id && (candidate.slug || candidate.token) === token);
          if (!latest) throw missing();
          // 计请求次数，不记录访客身份；HEAD 和后续 Range 分片不重复计数。
          latest.visits = (latest.visits || 0) + 1;
          latest.lastVisitedAt = new Date().toISOString();
        });
      }
      res.writeHead(status, { ...headers, 'Content-Length': Math.max(0, end - start + 1) });
      if (req.method === 'HEAD' || !info.size) { res.end(); return; }
      const stream = handle.createReadStream({ start, end }); handle = null;
      stream.on('error', error => { console.error('分享文件传输失败：', error.code); res.destroy(); });
      res.on('close', () => stream.destroy()); stream.pipe(res);
    } catch (error) {
      if (!res.headersSent) throw error.status === 503 ? error : missing();
      res.destroy();
    } finally { if (handle) await handle.close(); }
  }
}
