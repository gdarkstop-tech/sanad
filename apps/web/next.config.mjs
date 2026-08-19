import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';

// One .env at the repo root serves every workspace package. Next only looks in
// the app directory by default, so load the root file explicitly rather than
// keeping a second copy in sync.
const here = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.join(here, '../../.env') });

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Workspace packages ship TypeScript source; Next compiles them.
  transpilePackages: ['@sanad/db', '@sanad/core', '@sanad/contracts'],
};

export default nextConfig;
