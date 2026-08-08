import { readFile } from "node:fs/promises";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const databaseSchema = await readFile(new URL("./database/schema.sql", import.meta.url), "utf8");
  const databaseStatements = databaseSchema
    .split(/;\s*(?:\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean);

  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            TEST_DATABASE_STATEMENTS: JSON.stringify(databaseStatements),
          },
        },
      }),
    ],
    test: {
      setupFiles: ["./tests/worker/apply-database-schema.ts"],
      include: ["tests/worker/**/*.test.ts"],
    },
  };
});
