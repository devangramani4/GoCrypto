import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { Database } from './database';

export interface MigrationFile {
  version: string;
  name: string;
  up: string[];
  down: string[];
  checksum: string;
}

/** Split SQL into statements on `;` at end of line, respecting quotes and skipping comments. */
export function splitStatements(sql: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: string | null = null;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]!;
    const next = sql[i + 1];
    if (!quote && ch === '-' && next === '-') {
      const nl = sql.indexOf('\n', i);
      i = nl === -1 ? sql.length : nl;
      cur += '\n';
      continue;
    }
    if (quote) {
      cur += ch;
      if (ch === '\\') {
        cur += next ?? '';
        i++;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      cur += ch;
      continue;
    }
    if (ch === ';') {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export function parseMigration(fileName: string, content: string): MigrationFile {
  const m = /^(\d+)_(.+)\.sql$/.exec(fileName);
  if (!m) throw new Error(`Invalid migration file name: ${fileName}`);
  const upIdx = content.indexOf('-- +migrate Up');
  const downIdx = content.indexOf('-- +migrate Down');
  if (upIdx === -1) throw new Error(`${fileName}: missing "-- +migrate Up" marker`);
  const upSql = content.slice(upIdx, downIdx === -1 ? undefined : downIdx);
  const downSql = downIdx === -1 ? '' : content.slice(downIdx);
  return {
    version: m[1]!,
    name: m[2]!,
    up: splitStatements(upSql),
    down: splitStatements(downSql),
    checksum: createHash('sha256').update(content).digest('hex'),
  };
}

export async function loadMigrations(dir: string): Promise<MigrationFile[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  return Promise.all(files.map(async (f) => parseMigration(f, await readFile(path.join(dir, f), 'utf8'))));
}

type Log = (msg: string) => void;

async function ensureTable(db: Database): Promise<void> {
  await db.execute(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(32) NOT NULL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    checksum CHAR(64) NOT NULL,
    applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
}

async function withMigrationLock<T>(db: Database, fn: () => Promise<T>): Promise<T> {
  const conn = await db.pool.getConnection();
  try {
    const [rows] = await conn.query("SELECT GET_LOCK('gocrypto_schema_migrations', 120) AS l");
    if ((rows as { l: number }[])[0]?.l !== 1) throw new Error('Could not acquire migration lock');
    try {
      return await fn();
    } finally {
      await conn.query("SELECT RELEASE_LOCK('gocrypto_schema_migrations')");
    }
  } finally {
    conn.release();
  }
}

/** Apply all pending migrations in order. DDL statements auto-commit in MySQL/MariaDB. */
export async function migrateUp(db: Database, dir: string, log: Log = () => {}): Promise<string[]> {
  return withMigrationLock(db, async () => {
    await ensureTable(db);
    const applied = new Map(
      (await db.query<{ version: string; checksum: string }>('SELECT version, checksum FROM schema_migrations')).map((r) => [
        r.version,
        r.checksum,
      ]),
    );
    const done: string[] = [];
    for (const mig of await loadMigrations(dir)) {
      const prev = applied.get(mig.version);
      if (prev) {
        if (prev !== mig.checksum) log(`warning: migration ${mig.version}_${mig.name} changed after being applied`);
        continue;
      }
      log(`applying ${mig.version}_${mig.name} (${mig.up.length} statements)`);
      for (const stmt of mig.up) await db.execute(stmt);
      await db.execute('INSERT INTO schema_migrations (version, name, checksum) VALUES (?, ?, ?)', [
        mig.version,
        mig.name,
        mig.checksum,
      ]);
      done.push(`${mig.version}_${mig.name}`);
    }
    return done;
  });
}

/** Roll back the last `steps` applied migrations. */
export async function migrateDown(db: Database, dir: string, steps = 1, log: Log = () => {}): Promise<string[]> {
  return withMigrationLock(db, async () => {
    await ensureTable(db);
    const applied = await db.query<{ version: string }>('SELECT version FROM schema_migrations ORDER BY version DESC LIMIT ?', [
      steps,
    ]);
    const all = new Map((await loadMigrations(dir)).map((m) => [m.version, m]));
    const done: string[] = [];
    for (const { version } of applied) {
      const mig = all.get(version);
      if (!mig) throw new Error(`Migration file for applied version ${version} not found`);
      log(`rolling back ${mig.version}_${mig.name}`);
      await db.execute('SET FOREIGN_KEY_CHECKS = 0');
      try {
        for (const stmt of mig.down) await db.execute(stmt);
      } finally {
        await db.execute('SET FOREIGN_KEY_CHECKS = 1');
      }
      await db.execute('DELETE FROM schema_migrations WHERE version = ?', [version]);
      done.push(`${mig.version}_${mig.name}`);
    }
    return done;
  });
}
