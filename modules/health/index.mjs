import path from 'node:path';
import { mkdir, chmod, readFile } from 'node:fs/promises';
import XLSX from 'xlsx';
import { migrateCarotid } from './carotid-migration.mjs';

const root = '/api/modules/health';
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
export const columns = JSON.parse(await readFile(new URL('./columns.json', import.meta.url), 'utf8'));
const defaultVisible = ['c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'c9', 'c10', 'c11', 'c14', 'c37', 'c38'];

export function normalizeDate(value) {
  const text = String(value ?? '').trim().replace(/T00:00:00(?:\.000)?Z$/, '');
  const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?(?:（[^\r\n]{1,80}）)?$/.exec(text);
  if (!match) {
    if (/^\d{4} 年[春夏秋冬]季（无具体日期）$/.test(text)) return text;
    throw fail('日期请填写 YYYY-MM-DD；不完整日期可保留 YYYY、YYYY-MM 和括号说明');
  }
  const [, year, month, day] = match;
  if (+year < 1900 || +year > 2200 || (month && (+month < 1 || +month > 12)) || (day && (+day < 1 || +day > new Date(Date.UTC(+year, +month, 0)).getUTCDate()))) throw fail('日期无效，请检查年月日');
  return text;
}

export class HealthModule {
  constructor({ dataDir }) { this.dir = path.join(dataDir, 'health'); }
  async initialize() {
    try {
      const { DatabaseSync } = await import('node:sqlite');
      await mkdir(this.dir, { recursive: true, mode: 0o700 });
      this.db = new DatabaseSync(path.join(this.dir, 'health.sqlite'));
      this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
        CREATE TABLE IF NOT EXISTS people (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, visible TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1);
        CREATE TABLE IF NOT EXISTS records (id INTEGER PRIMARY KEY, person_id INTEGER NOT NULL REFERENCES people(id), cells TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1);
        CREATE INDEX IF NOT EXISTS records_person ON records(person_id);
        CREATE TABLE IF NOT EXISTS imports (fingerprint TEXT PRIMARY KEY, person_id INTEGER NOT NULL REFERENCES people(id), record_count INTEGER NOT NULL, imported_at TEXT NOT NULL);`);
      this.db.exec('BEGIN IMMEDIATE');
      try {
        const fields = this.db.prepare('PRAGMA table_info(people)').all().map(field => field.name);
        if (!fields.includes('focused')) this.db.exec("ALTER TABLE people ADD COLUMN focused TEXT NOT NULL DEFAULT '[]'");
        if (!fields.includes('hide_empty')) this.db.exec('ALTER TABLE people ADD COLUMN hide_empty INTEGER NOT NULL DEFAULT 0');
        this.db.exec('COMMIT');
      } catch (error) { this.db.exec('ROLLBACK'); throw error; }
      migrateCarotid(this.db);
      await chmod(path.join(this.dir, 'health.sqlite'), 0o600);
    } catch (error) {
      this.error = '健康数据库不可用，请检查数据目录权限及 Node.js 版本（需要 22.13 或更高版本）';
      console.error('[health]', error.message);
      this.db?.close(); this.db = null;
    }
  }
  ready() { if (!this.db) throw fail(this.error || '健康数据库未初始化', 503); }
  person(id) {
    if (!/^[1-9]\d*$/.test(String(id))) throw fail('请选择有效的人员');
    const person = this.db.prepare('SELECT * FROM people WHERE id=?').get(Number(id));
    if (!person) throw fail('人员不存在', 404);
    const { hide_empty, ...rest } = person;
    return { ...rest, visible: JSON.parse(person.visible), focused: JSON.parse(person.focused), hideEmpty: Boolean(hide_empty) };
  }
  addPerson(name) {
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 40 || /[\x00-\x1f\x7f]/.test(name)) throw fail('姓名需为 1–40 个字符');
    name = name.trim();
    if (this.db.prepare('SELECT id FROM people WHERE name=?').get(name)) throw fail('该姓名已存在，请切换到对应人员', 409);
    const result = this.db.prepare('INSERT INTO people(name,visible) VALUES(?,?)').run(name, JSON.stringify(defaultVisible));
    return this.person(result.lastInsertRowid);
  }
  records(id) {
    return this.db.prepare('SELECT id,cells,revision FROM records WHERE person_id=? ORDER BY id').all(id).map(row => ({ ...row, cells: JSON.parse(row.cells) })).sort((a, b) => a.cells.c0.replace(/[^\d-].*$/, '').localeCompare(b.cells.c0.replace(/[^\d-].*$/, '')) || a.id - b.id);
  }
  cleanCells(cells) {
    if (!cells || typeof cells !== 'object' || Array.isArray(cells) || Object.keys(cells).some(key => !columns.some(column => column.id === key))) throw fail('数据列无效');
    const cleaned = {};
    for (const { id } of columns) {
      const value = cells[id] ?? null;
      if (value !== null && typeof value !== 'string' && !(typeof value === 'number' && Number.isFinite(value))) throw fail('单元格只支持文字或数字');
      if (String(value ?? '').length > 10000) throw fail('单个字段不能超过 10000 字');
      cleaned[id] = value;
    }
    cleaned.c0 = normalizeDate(cleaned.c0);
    return cleaned;
  }
  async body(req) {
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > 512 * 1024) throw fail('请求内容过大', 413); chunks.push(chunk); }
    let body;
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw fail('请求内容不是有效 JSON'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail('请求内容无效');
    return body;
  }
  send(res, value, status = 200) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(value)); return true;
  }
  async handle(req, res, url) {
    if (url.pathname !== root && !url.pathname.startsWith(`${root}/`)) return false;
    this.ready();
    const route = url.pathname.slice(root.length);
    if (route === '/people' && req.method === 'GET') return this.send(res, { people: this.db.prepare('SELECT id,name FROM people ORDER BY id').all(), columns });
    if (route === '/people' && req.method === 'POST') return this.send(res, { person: this.addPerson((await this.body(req)).name) }, 201);
    const match = /^\/people\/([1-9]\d*)(?:\/(config|records|export)(?:\/([1-9]\d*))?)?$/.exec(route);
    if (!match) throw fail('健康接口不存在', 404);
    const person = this.person(match[1]);
    if (!match[2] && req.method === 'GET') return this.send(res, { person, columns, records: this.records(person.id) });
    if (match[2] === 'config' && !match[3] && req.method === 'PUT') {
      const input = await this.body(req);
      if (Object.keys(input).some(key => !['visible', 'focused', 'hideEmpty', 'revision'].includes(key))) throw fail('配置字段无效');
      const visible = Object.hasOwn(input, 'visible') ? input.visible : person.visible;
      const focused = Object.hasOwn(input, 'focused') ? input.focused : person.focused;
      const hideEmpty = Object.hasOwn(input, 'hideEmpty') ? input.hideEmpty : person.hideEmpty;
      const validColumns = value => Array.isArray(value) && new Set(value).size === value.length && value.every(id => columns.some(c => c.id === id));
      if (!validColumns(visible) || !visible.length) throw fail('请至少选择一列有效字段');
      if (!validColumns(focused)) throw fail('关注列无效');
      if (typeof hideEmpty !== 'boolean') throw fail('隐藏空行开关必须为布尔值');
      const result = this.db.prepare('UPDATE people SET visible=?,focused=?,hide_empty=?,revision=revision+1 WHERE id=? AND revision=?').run(JSON.stringify(visible), JSON.stringify(focused), Number(hideEmpty), person.id, this.revision(input.revision));
      if (!result.changes) throw fail('列表配置已被其他页面修改，请刷新后重试', 409);
      return this.send(res, { person: this.person(person.id) });
    }
    if (match[2] === 'records' && ((!match[3] && req.method === 'POST') || (match[3] && req.method === 'PUT'))) {
      const input = await this.body(req), cells = JSON.stringify(this.cleanCells(input.cells));
      let id;
      if (match[3]) {
        id = Number(match[3]);
        const result = this.db.prepare('UPDATE records SET cells=?,revision=revision+1 WHERE id=? AND person_id=? AND revision=?').run(cells, id, person.id, this.revision(input.revision));
        if (!result.changes) throw fail('记录已变更或不存在，请刷新后重新编辑', 409);
      } else {
        id = Number(this.db.prepare('INSERT INTO records(person_id,cells) VALUES(?,?)').run(person.id, cells).lastInsertRowid);
      }
      return this.send(res, { id }, match[3] ? 200 : 201);
    }
    if (match[2] === 'records' && match[3] && req.method === 'DELETE') {
      const input = await this.body(req);
      const result = this.db.prepare('DELETE FROM records WHERE id=? AND person_id=? AND revision=?').run(Number(match[3]), person.id, this.revision(input.revision));
      if (!result.changes) throw fail('记录已变更或不存在，请刷新后再删除', 409);
      return this.send(res, { deleted: Number(match[3]) });
    }
    if (match[2] === 'export' && !match[3] && req.method === 'GET') {
      const scope = url.searchParams.get('scope') || 'all';
      if (!['all', 'visible'].includes(scope)) throw fail('导出范围无效');
      const selected = columns.filter(c => scope === 'all' || person.visible.includes(c.id));
      const rows = [selected.map(c => c.label), ...this.records(person.id).map(row => selected.map(c => row.cells[c.id] ?? null))];
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), '健康数据');
      const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
      res.writeHead(200, { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`${person.name}-健康数据.xlsx`)}`, 'Cache-Control': 'no-store', 'Content-Length': buffer.length });
      res.end(buffer); return true;
    }
    throw fail('健康接口不支持此操作', 405);
  }
  revision(value) { if (!Number.isSafeInteger(value) || value < 1) throw fail('缺少有效的数据版本，请刷新后重试'); return value; }
  shutdown() { this.db?.close(); this.db = null; }
}
