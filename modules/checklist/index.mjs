import crypto from 'node:crypto';
import path from 'node:path';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';

function httpError(message, status = 400) { return Object.assign(new Error(message), { status }); }
const people = new Set(['通用', '爸爸', '妈妈', '赞赞']);

export class ChecklistModule {
  constructor({ dataDir }) {
    this.dir = path.join(dataDir, 'checklist');
    this.file = path.join(this.dir, 'items.json');
    this.items = [];
  }

  async initialize() {
    try {
      const value = JSON.parse(await readFile(this.file, 'utf8'));
      this.items = Array.isArray(value) ? value.filter(item => item && typeof item.id === 'string' && typeof item.text === 'string') : [];
      let migrated = false;
      this.items = this.items.map(item => {
        if (people.has(item.person)) return item;
        migrated = true;
        return { ...item, person: item.text.includes('赞赞') ? '赞赞' : '通用' };
      });
      if (migrated) await this.save();
    } catch { this.items = []; }
  }

  async save() {
    await mkdir(this.dir, { recursive: true });
    const temporary = `${this.file}.tmp`;
    await writeFile(temporary, `${JSON.stringify(this.items, null, 2)}\n`, 'utf8');
    await rename(temporary, this.file);
  }

  async body(req) {
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > 32 * 1024) throw httpError('请求内容过大', 413); chunks.push(chunk); }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw httpError('请求内容不是有效 JSON'); }
  }

  send(res, status, value) {
    const body = JSON.stringify(value);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' });
    res.end(body);
    return true;
  }

  cleanText(value) {
    const text = String(value || '').trim().replace(/\s+/g, ' ');
    if (!text) throw httpError('清单内容不能为空');
    if (text.length > 120) throw httpError('清单内容不能超过 120 个字符');
    return text;
  }
  cleanPerson(value) {
    const person = String(value || '通用').trim();
    if (!people.has(person)) throw httpError('清单归属人不正确');
    return person;
  }

  async handle(req, res, url) {
    const root = '/api/modules/checklist';
    if (!url.pathname.startsWith(root)) return false;
    if (url.pathname === root && req.method === 'GET') return this.send(res, 200, { items: this.items });
    if (url.pathname === root && req.method === 'POST') {
      const input = await this.body(req);
      const item = { id: crypto.randomUUID(), text: this.cleanText(input.text), person: this.cleanPerson(input.person), checked: false, checkedAt: '', createdAt: new Date().toISOString() };
      this.items.push(item); await this.save(); return this.send(res, 201, { item, items: this.items });
    }
    if (url.pathname === `${root}/reset` && req.method === 'POST') {
      this.items = this.items.map(item => ({ ...item, checked: false, checkedAt: '' })); await this.save(); return this.send(res, 200, { items: this.items });
    }
    if (url.pathname === `${root}/order` && req.method === 'PUT') {
      const input = await this.body(req), ids = Array.isArray(input.ids) ? input.ids.map(String) : [];
      if (ids.length !== this.items.length || new Set(ids).size !== ids.length || ids.some(id => !this.items.some(item => item.id === id))) throw httpError('排序数据与当前清单不一致', 409);
      const byId = new Map(this.items.map(item => [item.id, item])); this.items = ids.map(id => byId.get(id)); await this.save(); return this.send(res, 200, { items: this.items });
    }
    const match = url.pathname.match(new RegExp(`^${root}/([^/]+)$`));
    if (match && req.method === 'PUT') {
      const index = this.items.findIndex(item => item.id === match[1]);
      if (index < 0) throw httpError('清单条目不存在', 404);
      const input = await this.body(req), item = { ...this.items[index] };
      if (Object.hasOwn(input, 'checked')) {
        item.checked = Boolean(input.checked);
        item.checkedAt = item.checked ? new Date().toISOString() : '';
      }
      if (Object.hasOwn(input, 'text')) item.text = this.cleanText(input.text);
      if (Object.hasOwn(input, 'person')) item.person = this.cleanPerson(input.person);
      this.items[index] = item; await this.save(); return this.send(res, 200, { item, items: this.items });
    }
    if (match && req.method === 'DELETE') {
      const index = this.items.findIndex(item => item.id === match[1]);
      if (index < 0) throw httpError('清单条目不存在', 404);
      this.items.splice(index, 1); await this.save(); return this.send(res, 200, { items: this.items });
    }
    throw httpError('清单接口不存在', 404);
  }
}
