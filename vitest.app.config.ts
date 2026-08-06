import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["tests/app/**/*.test.tsx"],
    setupFiles: ["./tests/app/setup.ts"],
  },
});
