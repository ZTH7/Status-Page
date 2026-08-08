import { env } from "cloudflare:test";

declare global {
  namespace Cloudflare {
    interface Env {
      TEST_DATABASE_STATEMENTS: string;
    }
  }
}

const statements = JSON.parse(env.TEST_DATABASE_STATEMENTS) as string[];
await env.DB.batch(statements.map((statement) => env.DB.prepare(statement)));
