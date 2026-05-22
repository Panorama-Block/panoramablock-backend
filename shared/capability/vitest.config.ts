import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["*.ts"],
      exclude: ["__tests__/**", "*.config.ts", "index.ts"],
    },
  },
});
