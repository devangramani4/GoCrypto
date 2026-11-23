/**
 * Migration CLI.
 *   tsx scripts/migrate.ts up            apply pending migrations
 *   tsx scripts/migrate.ts down [steps]  roll back the last N migrations (default 1)
 *   tsx scripts/migrate.ts reset         drop everything and re-apply (refused in production)
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Database, loadConfig, migrateDown, migrateUp } from '@gocrypto/server-core';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../migrations');

async function main(): Promise<void> {
  const [cmd = 'up', arg] = process.argv.slice(2);
  const cfg = loadConfig();
  const db = Database.connect(cfg.DATABASE_URL, 2);
  const log = (m: string) => console.log(`[migrate] ${m}`);
  try {
    if (cmd === 'up') {
      const applied = await migrateUp(db, dir, log);
      log(applied.length ? `applied ${applied.length} migration(s)` : 'schema is up to date');
    } else if (cmd === 'down') {
      const rolled = await migrateDown(db, dir, Number(arg ?? 1), log);
      log(`rolled back ${rolled.length} migration(s)`);
    } else if (cmd === 'reset') {
      if (cfg.isProduction) throw new Error('reset is not allowed in production');
      await migrateDown(db, dir, 10_000, log);
      const applied = await migrateUp(db, dir, log);
      log(`reset complete, applied ${applied.length} migration(s)`);
    } else {
      throw new Error(`unknown command ${cmd}`);
    }
  } finally {
    await db.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
