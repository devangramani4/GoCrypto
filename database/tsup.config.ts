import { nodeBundle } from '../tsup.node';

// dist/migrate.js and dist/seed.js resolve ../migrations relative to themselves, like the scripts/ sources.
export default nodeBundle({ migrate: 'scripts/migrate.ts', seed: 'scripts/seed.ts' });
