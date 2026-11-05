import { mkdir, readFile, writeFile, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const invalid = message => Object.assign(new Error(message), { status: 400 });
export class FilePaths {
  constructor(dataDir, defaults) {
    this.file = path.join(dataDir, 'file-manager', 'config.json');
    this.roots = defaults;
    this.revision = '';
    this.writes = Promise.resolve();
  }
  async initialize() {
    try {
      const saved = JSON.parse(await readFile(this.file, 'utf8'));
      this.roots = this.normalize(saved.roots);
      this.revision = saved.revision || '';
    } catch (error) {
      if (error.code !== 'ENOENT') {
        this.error = '文件路径配置读取失败，请检查 data/file-manager/config.json';
        console.error(this.error, error.message);
      }
    }
    return this.roots;
  }
  normalize(items) {
    if (!Array.isArray(items) || !items.length || items.length > 20) throw invalid('请配置 1–20 个路径');
    const seen = new Set();
    return items.map(item => {
      const label = String(item?.label || '').trim();
      const directory = String(item?.path || '').trim();
      if (!label || label.length > 40 || /[\x00-\x1f]/.test(label)) throw invalid('路径名称必须为 1–40 字，不能包含控制字符');
      if (!path.isAbsolute(directory) || directory.length > 4096 || /[\x00-\x1f]/.test(directory)) throw invalid('请输入有效的绝对路径');
      const rootPath = path.resolve(directory);
      if (seen.has(rootPath)) throw invalid(`路径重复：${rootPath}`);
      seen.add(rootPath);
      return { id: crypto.createHash('sha1').update(rootPath).digest('hex').slice(0, 10), label, path: rootPath };
    });
  }
  get() {
    if (this.error) throw Object.assign(new Error(this.error), { status: 503 });
    return { roots: this.roots, revision: this.revision };
  }
  update(input) {
    const operation = this.writes.catch(() => {}).then(async () => {
      this.get();
      if (input?.revision !== this.revision) throw Object.assign(new Error('路径配置已更新，请关闭后重新打开配置'), { status: 409 });
      const roots = this.normalize(input.roots);
      for (const root of roots) {
        const info = await stat(root.path).catch(() => null);
        if (!info?.isDirectory()) throw invalid(`目录不存在或无法访问：${root.path}`);
      }
      const next = { roots, revision: crypto.randomUUID() };
      await mkdir(path.dirname(this.file), { recursive: true });
      await writeFile(`${this.file}.tmp`, JSON.stringify(next, null, 2), { mode: 0o600 });
      await rename(`${this.file}.tmp`, this.file);
      this.roots = roots; this.revision = next.revision;
      return next;
    });
    this.writes = operation;
    return operation;
  }
}
