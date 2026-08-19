import { loadRootEnv, createDatabase } from '../packages/db/src/index';
import { seedEmphasisCues } from '../packages/core/src/services/pipeline';

/**
 * Seeds configuration data the product needs to work at all: emphasis cue
 * phrases. These are rows, not code, so a new language or dialect is an
 * insert here — never a change to a service.
 */
loadRootEnv();

const url = process.argv[2] ?? process.env.DATABASE_URL;
if (!url) {
  console.error('No DATABASE_URL set.');
  process.exit(1);
}

const db = createDatabase(url);
await seedEmphasisCues(db);
console.log('Seeded emphasis cues.');
process.exit(0);
