import path from 'node:path';
import { defineConfig } from 'vitest/config';

const root = path.dirname(new URL(import.meta.url).pathname);

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/global-setup.ts'],
    hookTimeout: 60_000,
    testTimeout: 30_000,
    // Argon2 + a shared test database: parallel files would fight over rows.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@sanad/db': path.join(root, 'packages/db/src/index.ts'),
      '@sanad/core': path.join(root, 'packages/core/src/index.ts'),
      '@sanad/contracts': path.join(root, 'packages/contracts/src/index.ts'),
      '@sanad/offline/testing': path.join(root, 'packages/offline/src/testing.ts'),
      '@sanad/offline': path.join(root, 'packages/offline/src/index.ts'),
    },
  },
});
