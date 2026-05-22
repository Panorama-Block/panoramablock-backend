import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    // Use regex matchers so any sub-path resolves (e.g. /__tests__/registry.conformance, /chains).
    alias: [
      {
        find: /^@panorama\/capability$/,
        replacement: resolve(__dirname, '../shared/capability/index.ts'),
      },
      {
        find: /^@panorama\/capability\/(.+)$/,
        replacement: resolve(__dirname, '../shared/capability/$1'),
      },
    ],
  },
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.d.ts',
        'src/**/__tests__/**',
      ],
    },
    restoreMocks: true,
    clearMocks: true,
    mockReset: true,
  },
});
