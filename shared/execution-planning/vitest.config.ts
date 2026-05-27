import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@panorama\/capability$/, replacement: resolve(__dirname, '../capability/index.ts') },
      { find: /^@panorama\/capability\/(.+)$/, replacement: resolve(__dirname, '../capability/$1') },
    ],
  },
  test: { environment: 'node', include: ['src/**/__tests__/**/*.test.ts'] },
});
