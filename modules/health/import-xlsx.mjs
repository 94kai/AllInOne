import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';
import { HealthModule, columns } from './index.mjs';
import { mergeCarotid } from './carotid-migration.mjs';

const [source, name] = process.argv.slice(2);
if (!source || !name) throw new Error('用法：node modules/health/import-xlsx.mjs <xlsx 路径> <人员姓名>');
const buffer = await readFile(source);
const fingerprint = createHash('sha256').update(buffer).digest('hex');
const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
if (workbook.SheetNames.length !== 1) throw new Error('此导入工具仅支持单工作表时间线，请先核对表格');
const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: null });
const legacyColumns = [...columns.slice(0, 12), { id: 'c12', label: '颈动脉内中膜总体记录' }, ...columns.slice(12)];
let sourceColumns = columns;
let header = rows.findIndex(row => row.length === columns.length && columns.every((column, i) => row[i] === column.label));
if (header < 0) {
  sourceColumns = legacyColumns;
  header = rows.findIndex(row => row.length === legacyColumns.length && legacyColumns.every((column, i) => row[i] === column.label));
}
if (header < 0) throw new Error('表头不匹配，未导入');
const health = new HealthModule({ dataDir: fileURLToPath(new URL('../../data/', import.meta.url)) });
await health.initialize(); health.ready();
try {
  const records = [];
  for (const row of rows.slice(header + 1)) {
    if (row.every(value => value === null || value === '')) break;
    const cells = Object.fromEntries(sourceColumns.map(({ id }, i) => [id, row[i] instanceof Date ? row[i].toISOString().slice(0, 10) : row[i] ?? null]));
    records.push(health.cleanCells(mergeCarotid(cells)));
  }
  if (!records.length) throw new Error('表格没有数据行');
  health.db.exec('BEGIN IMMEDIATE');
  try {
    if (health.db.prepare('SELECT 1 FROM imports WHERE fingerprint=?').get(fingerprint)) throw new Error('该文件已导入，拒绝重复导入');
    const existing = health.db.prepare('SELECT id FROM people WHERE name=?').get(name.trim());
    const person = existing ? health.person(existing.id) : health.addPerson(name);
    const insert = health.db.prepare('INSERT INTO records(person_id,cells) VALUES(?,?)');
    for (const cells of records) insert.run(person.id, JSON.stringify(cells));
    health.db.prepare('INSERT INTO imports VALUES(?,?,?,?)').run(fingerprint, person.id, records.length, new Date().toISOString());
    health.db.exec('COMMIT');
    console.log(`已导入 ${person.name}：${records.length} 条记录，${columns.length} 列。后续仅使用 health.sqlite。`);
  } catch (error) { health.db.exec('ROLLBACK'); throw error; }
} finally { health.shutdown(); }
