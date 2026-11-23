// Starts one GoCrypto service once the demo bootstrap (migrations + seed) has finished, so services
// never race the schema. Used by pm2.config.cjs:  node after-bootstrap.mjs services/api/dist/main.js
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

const entry = process.argv[2];
if (!entry) {
  console.error('usage: node after-bootstrap.mjs <service entry file>');
  process.exit(2);
}

const marker = `${process.env.DEMO_DIR ?? '/tmp/gocrypto-demo'}/bootstrapped`;
while (!existsSync(marker)) await sleep(500);

// Make the service see itself as the program being run.
const file = resolve(entry);
process.argv.splice(1, 2, file);
await import(pathToFileURL(file).href);
