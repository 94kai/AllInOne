const empty = value => value == null || /^[\s\-－—–−]*$/u.test(String(value));

export function mergeCarotid(cells) {
  const merged = { ...cells };
  if (!empty(cells.c12)) {
    const note = `总体记录（未区分侧别）：${cells.c12}`;
    for (const id of ['c10', 'c11']) {
      merged[id] = empty(cells[id]) ? note : `${cells[id]}\n${note}`;
    }
  }
  delete merged.c12;
  return merged;
}

export function migrateCarotid(db) {
  const migration = 'merge-carotid-overall-v1';
  db.exec('CREATE TABLE IF NOT EXISTS health_migrations (id TEXT PRIMARY KEY, backup TEXT NOT NULL)');
  db.exec('BEGIN IMMEDIATE');
  try {
    if (!db.prepare('SELECT 1 FROM health_migrations WHERE id=?').get(migration)) {
      const records = db.prepare('SELECT * FROM records').all();
      const people = db.prepare('SELECT * FROM people').all();
      // 原始行和人员配置与迁移标记同事务保存，便于回溯且避免重启重复追加。
      db.prepare('INSERT INTO health_migrations VALUES(?,?)').run(migration, JSON.stringify({ records, people }));
      const update = db.prepare('UPDATE records SET cells=?,revision=revision+1 WHERE id=?');
      for (const record of records) {
        const cells = JSON.parse(record.cells);
        if (Object.hasOwn(cells, 'c12')) update.run(JSON.stringify(mergeCarotid(cells)), record.id);
      }
      const replace = ids => [...new Set(ids.flatMap(id => id === 'c12' ? ['c10', 'c11'] : [id]))];
      const updatePerson = db.prepare('UPDATE people SET visible=?,focused=?,revision=revision+1 WHERE id=?');
      for (const person of people) {
        const visible = JSON.parse(person.visible), focused = JSON.parse(person.focused);
        if (visible.includes('c12') || focused.includes('c12')) updatePerson.run(JSON.stringify(replace(visible)), JSON.stringify(replace(focused)), person.id);
      }
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
