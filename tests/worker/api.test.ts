import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import type { AppConfig } from "../../src/config/types";
import { appConfig } from "../../src/generated/config";
import type { StatusResponse } from "../../src/shared/api-types";
import {
  buildStatusResponse,
  handleStatusRequest,
  type StatusApiDependencies,
} from "../../src/worker/api/status";

const GENERATED_AT = Date.UTC(2026, 7, 5, 18);
const WINDOW_START = Date.UTC(2026, 7, 3);

const API_CONFIG: AppConfig = {
  site: {
    ...appConfig.site,
    title: "Public Status",
    url: "https://status.example.com",
    logo: "/public-logo.svg",
    theme: "stardew-inspired",
    colorMode: "dark",
    historyDays: 3,
    requestTimeoutSeconds: 19,
    thresholds: {
      degradedAfterFailures: 7,
      outageAfterMinutes: 123,
      recoverAfterSuccesses: 9,
    },
  },
  monitors: [
    {
      id: "private",
      name: "Private Origin",
      description: "Internal but publicly described",
      presentationLogo: "/private-presentation.svg",
      url: "https://secret-origin.internal/admin?token=never-expose",
      linkable: false,
      method: "HEAD",
      expectStatus: 204,
      followRedirect: true,
      timeoutSeconds: 17,
      thresholds: { degradedAfterFailures: 11 },
    },
    {
      id: "linkable",
      name: "Public Blog",
      url: "https://blog.example.com/",
      linkable: true,
      method: "GET",
      expectStatus: 200,
      followRedirect: false,
    },
    {
      id: "unknown",
      name: "Awaiting First Check",
      url: "https://unknown.internal/",
      linkable: false,
      method: "GET",
      expectStatus: 200,
      followRedirect: false,
    },
  ],
};

interface ObservedQuery {
  sql: string;
  bindings: unknown[];
}

function databaseObservingBindings(db: D1Database, observed: ObservedQuery[]): D1Database {
  return new Proxy(db, {
    get(target, property, receiver) {
      if (property === "prepare") {
        return (sql: string) => {
          const statement = target.prepare(sql);
          return new Proxy(statement, {
            get(statementTarget, statementProperty, statementReceiver) {
              if (statementProperty === "bind") {
                return (...bindings: unknown[]) => {
                  observed.push({ sql, bindings });
                  return statementTarget.bind(...bindings);
                };
              }

              const value = Reflect.get(
                statementTarget,
                statementProperty,
                statementReceiver,
              ) as unknown;
              return typeof value === "function" ? value.bind(statementTarget) : value;
            },
          });
        };
      }

      const value = Reflect.get(target, property, receiver) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function databaseFailingWith(db: D1Database, message: string): D1Database {
  return new Proxy(db, {
    get(target, property, receiver) {
      if (property === "prepare") {
        return () => {
          throw new Error(message);
        };
      }

      const value = Reflect.get(target, property, receiver) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

async function clearBusinessTables(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM monitor_state"),
    env.DB.prepare("DELETE FROM daily_summaries"),
    env.DB.prepare("DELETE FROM incidents"),
  ]);
}

async function seedPublicSnapshot(): Promise<void> {
  const state = env.DB.prepare(`
    INSERT INTO monitor_state (
      monitor_id, level, consecutive_failures, consecutive_successes,
      first_failed_at, latest_checked_at, latest_success, latest_http_status,
      latest_status_text, latest_response_ms, latest_location, latest_error_code
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const summary = env.DB.prepare(`
    INSERT INTO daily_summaries (
      monitor_id, day, location, check_count, failed_check_count,
      response_time_sum, response_count, highest_severity
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const incident = env.DB.prepare(`
    INSERT INTO incidents (
      id, monitor_id, first_failed_at, degraded_at, outage_at,
      recovered_at, highest_severity
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  await env.DB.batch([
    state.bind(
      "private",
      "outage",
      4,
      0,
      Date.UTC(2026, 7, 5, 12),
      Date.UTC(2026, 7, 5, 17),
      0,
      504,
      "PRIVATE upstream status",
      480,
      "lhr",
      "timeout",
    ),
    state.bind(
      "linkable",
      "operational",
      0,
      0,
      null,
      Date.UTC(2026, 7, 5, 16),
      1,
      200,
      "INTERNAL success text",
      42,
      "sfo",
      null,
    ),
    state.bind(
      "not-configured",
      "outage",
      99,
      0,
      Date.UTC(2026, 7, 5),
      Date.UTC(2026, 7, 5, 18),
      0,
      500,
      "must not influence overall",
      999,
      "secret-pop",
      "network",
    ),
    summary.bind("private", "2026-08-04", "sfo", 5, 1, 300, 3, "degraded"),
    summary.bind("private", "2026-08-04", "lhr", 7, 2, 0, 0, "outage"),
    summary.bind("linkable", "2026-08-05", "sfo", 2, 0, 85, 2, "operational"),
    summary.bind("not-configured", "2026-08-05", "secret-pop", 1, 1, 999, 1, "outage"),
    incident.bind(
      "private:1785931200000",
      "private",
      Date.UTC(2026, 7, 5, 12),
      Date.UTC(2026, 7, 5, 13),
      Date.UTC(2026, 7, 5, 14),
      null,
      "outage",
    ),
    incident.bind(
      "linkable:1785834000000",
      "linkable",
      Date.UTC(2026, 7, 4, 9),
      Date.UTC(2026, 7, 4, 9),
      null,
      Date.UTC(2026, 7, 4, 10),
      "degraded",
    ),
    incident.bind(
      "excluded-monitor",
      "not-configured",
      Date.UTC(2026, 7, 5, 15),
      Date.UTC(2026, 7, 5, 15),
      null,
      null,
      "degraded",
    ),
  ]);
}

beforeEach(clearBusinessTables);

describe("public status response", () => {
  it("assembles only documented public data from three bounded real D1 reads", async () => {
    await seedPublicSnapshot();
    const observed: ObservedQuery[] = [];

    const response = await buildStatusResponse({
      config: API_CONFIG,
      db: databaseObservingBindings(env.DB, observed),
      now: () => GENERATED_AT,
    });

    expect(response).toEqual<StatusResponse>({
      generatedAt: GENERATED_AT,
      latestCompletedAt: Date.UTC(2026, 7, 5, 17),
      overall: "outage",
      site: {
        title: "Public Status",
        url: "https://status.example.com",
        logo: "/public-logo.svg",
        theme: "stardew-inspired",
        colorMode: "dark",
        historyDays: 3,
        labels: API_CONFIG.site.labels,
      },
      monitors: [
        {
          id: "private",
          name: "Private Origin",
          description: "Internal but publicly described",
          presentationLogo: "/private-presentation.svg",
          level: "outage",
          latest: {
            checkedAt: Date.UTC(2026, 7, 5, 17),
            httpStatus: 504,
            responseMs: 480,
            location: "lhr",
          },
          history: [
            { day: "2026-08-03", level: "unknown", checks: 0, failures: 0, locations: [] },
            {
              day: "2026-08-04",
              level: "outage",
              checks: 12,
              failures: 3,
              locations: [
                { code: "lhr", averageMs: null, checks: 7 },
                { code: "sfo", averageMs: 100, checks: 5 },
              ],
            },
            { day: "2026-08-05", level: "unknown", checks: 0, failures: 0, locations: [] },
          ],
        },
        {
          id: "linkable",
          name: "Public Blog",
          href: "https://blog.example.com/",
          level: "operational",
          latest: {
            checkedAt: Date.UTC(2026, 7, 5, 16),
            httpStatus: 200,
            responseMs: 42,
            location: "sfo",
          },
          history: [
            { day: "2026-08-03", level: "unknown", checks: 0, failures: 0, locations: [] },
            { day: "2026-08-04", level: "unknown", checks: 0, failures: 0, locations: [] },
            {
              day: "2026-08-05",
              level: "operational",
              checks: 2,
              failures: 0,
              locations: [{ code: "sfo", averageMs: 42.5, checks: 2 }],
            },
          ],
        },
        {
          id: "unknown",
          name: "Awaiting First Check",
          level: "unknown",
          latest: null,
          history: [
            { day: "2026-08-03", level: "unknown", checks: 0, failures: 0, locations: [] },
            { day: "2026-08-04", level: "unknown", checks: 0, failures: 0, locations: [] },
            { day: "2026-08-05", level: "unknown", checks: 0, failures: 0, locations: [] },
          ],
        },
      ],
      incidents: [
        {
          id: "private:1785931200000",
          monitorId: "private",
          monitorName: "Private Origin",
          firstFailedAt: Date.UTC(2026, 7, 5, 12),
          degradedAt: Date.UTC(2026, 7, 5, 13),
          outageAt: Date.UTC(2026, 7, 5, 14),
          recoveredAt: null,
          durationMs: 21_600_000,
          highestSeverity: "outage",
        },
        {
          id: "linkable:1785834000000",
          monitorId: "linkable",
          monitorName: "Public Blog",
          firstFailedAt: Date.UTC(2026, 7, 4, 9),
          degradedAt: Date.UTC(2026, 7, 4, 9),
          outageAt: null,
          recoveredAt: Date.UTC(2026, 7, 4, 10),
          durationMs: 3_600_000,
          highestSeverity: "degraded",
        },
      ],
    });

    expect(Object.keys(response).sort()).toEqual([
      "generatedAt",
      "incidents",
      "latestCompletedAt",
      "monitors",
      "overall",
      "site",
    ]);
    expect(Object.keys(response.site).sort()).toEqual([
      "colorMode",
      "historyDays",
      "labels",
      "logo",
      "theme",
      "title",
      "url",
    ]);
    expect(Object.keys(response.monitors[0]!.latest!).sort()).toEqual([
      "checkedAt",
      "httpStatus",
      "location",
      "responseMs",
    ]);
    expect(Object.keys(response.incidents[0]!).sort()).toEqual([
      "degradedAt",
      "durationMs",
      "firstFailedAt",
      "highestSeverity",
      "id",
      "monitorId",
      "monitorName",
      "outageAt",
      "recoveredAt",
    ]);

    const serialized = JSON.stringify(response);
    expect(serialized).not.toContain("secret-origin.internal");
    expect(serialized).not.toContain("unknown.internal");
    expect(serialized).not.toContain("PRIVATE upstream status");
    expect(serialized).not.toContain("INTERNAL success text");
    expect(serialized).not.toContain("timeout");
    expect(serialized).not.toContain("not-configured");
    expect(serialized).not.toContain("secret-pop");
    expect(serialized).not.toContain("rawRetentionDays");
    expect(serialized).not.toContain("requestTimeoutSeconds");
    expect(serialized).not.toContain("thresholds");

    expect(observed).toHaveLength(3);
    const stateRead = observed.find(({ sql }) => sql.includes("FROM monitor_state"));
    const summaryRead = observed.find(({ sql }) => sql.includes("FROM daily_summaries"));
    const incidentRead = observed.find(({ sql }) => sql.includes("FROM incidents"));
    expect(stateRead?.bindings).toEqual(["private", "linkable", "unknown"]);
    expect(summaryRead?.bindings).toEqual(["private", "linkable", "unknown", "2026-08-03"]);
    expect(incidentRead?.bindings).toEqual([
      "private",
      "linkable",
      "unknown",
      GENERATED_AT,
      WINDOW_START,
    ]);
    expect(observed.some(({ sql }) => sql.includes("check_results"))).toBe(false);
  });

  it("uses unknown overall only when every configured monitor lacks current state", async () => {
    const response = await buildStatusResponse({
      config: { ...API_CONFIG, monitors: [API_CONFIG.monitors[2]!] },
      db: env.DB,
      now: () => GENERATED_AT,
    });

    expect(response.overall).toBe("unknown");
    expect(response.latestCompletedAt).toBeNull();
  });
});

describe("status API routing", () => {
  it("serves GET by pathname with the public cache and security headers", async () => {
    const response = await SELF.fetch("https://example.com/api/status?view=compact");

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=15, stale-while-revalidate=45",
    );
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Object.keys((await response.json()) as object).sort()).toEqual([
      "generatedAt",
      "incidents",
      "latestCompletedAt",
      "monitors",
      "overall",
      "site",
    ]);
  });

  it("returns a typed no-store 405 for unsupported methods", async () => {
    const response = await SELF.fetch(
      new Request("https://example.com/api/status?ignored=true", { method: "POST" }),
    );

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    await expect(response.json()).resolves.toEqual({
      error: { code: "method_not_allowed", message: "Only GET is supported." },
    });
  });

  it("returns a safe typed no-store 503 without exposing the internal failure", async () => {
    const internalMessage = "D1 exploded at secret-origin.internal with token hunter2";
    const dependencies: StatusApiDependencies = {
      config: API_CONFIG,
      db: databaseFailingWith(env.DB, internalMessage),
      now: () => GENERATED_AT,
    };

    const response = await handleStatusRequest(
      new Request("https://example.com/api/status"),
      dependencies,
    );
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(JSON.parse(body)).toEqual({
      error: {
        code: "status_unavailable",
        message: "Status data is temporarily unavailable.",
      },
    });
    expect(body).not.toContain(internalMessage);
    expect(body).not.toContain("hunter2");
  });

  it("returns 404 for an unrelated Worker-routed path", async () => {
    const response = await SELF.fetch("https://example.com/not-an-api-route");

    expect(response.status).toBe(404);
  });
});
