import { Core } from '@gocrypto/server-core';
import { runSeed } from '../seeds/seed';

async function main(): Promise<void> {
  const core = await Core.create('seed', { watchConfig: false, poolSize: 4 });
  try {
    const res = await runSeed(core, { log: (m) => console.log(`[seed] ${m}`) });
    console.log('[seed] done');
    if (res.adminPassword) {
      console.log(`[seed] admin login: ${res.adminEmail}`);
      console.log(`[seed] admin password (shown once, change it after first login): ${res.adminPassword}`);
    }
    if (res.demoEmail) console.log(`[seed] demo login: ${res.demoEmail}${res.demoPassword ? ` / ${res.demoPassword}` : ''}`);
  } finally {
    await core.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
