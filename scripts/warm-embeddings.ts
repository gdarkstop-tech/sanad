/**
 * Downloads the embedding model into the image at build time.
 *
 * Without this the first search on a freshly started container pays a model
 * download before it can answer, and a container that restarts pays it again.
 * transformers.js caches inside node_modules, which is already part of the
 * image, so warming here is all it takes to make cold starts fast and to keep
 * the running app from depending on the Hugging Face hub being reachable.
 *
 * A failure here is not fatal: retrieval falls back to lexical-only search and
 * says so. Better a larger image than a broken build.
 */
import { embeddings } from '../packages/core/src/index';

const provider = embeddings();
console.log(`warming ${provider.name}`);

const available = await provider.isAvailable();
if (!available) {
  console.warn('embedding model could not be loaded; the image will use lexical search only');
  process.exit(0);
}

const [vector] = await provider.embed(['warm up'], 'query');
console.log(`ready — ${vector?.length ?? 0} dimensions`);
