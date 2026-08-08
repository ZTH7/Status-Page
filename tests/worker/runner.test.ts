import { afterEach, describe, expect, it, vi } from "vitest";

import type { AppConfig, MonitorConfig, Thresholds } from "../../src/config/types";
import type { CheckResult, MonitorState } from "../../src/domain/types";
import { appConfig } from "../../src/generated/config";
import type { Env } from "../../src/worker/env";
import { createScheduledHandler, type ScheduledDependencies } from "../../src/worker/index";
import {
  logStructuredRecord,
  runChecks,
  type RunChecksDependencies,
  type RunSummary,
  type SafeStructuredRecord,
} from "../../src/worker/monitoring/runner";

const AT = Date.UTC(2026, 7, 5, 12);
const DEFAULT_THRESHOLDS: Thresholds = {
  degradedAfterFailures: 2,
  outageAfterMinutes: 60,
  recoverAfterSuccesses: 2,
};

function monitor(id: string, overrides: Partial<MonitorConfig> = {}): MonitorConfig {
  return {
    id,
    name: id.toUpperCase(),
    url: `https://${id}.private.example/health`,
    linkable: true,
    method: "GET",
    expectStatus: 200,
    followRedirect: false,
    ...overrides,
  };
}

function config(monitors: MonitorConfig[], thresholds: Thresholds = DEFAULT_THRESHOLDS): AppConfig {
  return {
    site: { ...appConfig.site, thresholds },
    monitors,
  };
}

function result(
  monitorId: string,
  success: boolean,
  overrides: Partial<CheckResult> = {},
): CheckResult {
  return {
    monitorId,
    checkedAt: AT,
    success,
    httpStatus: success ? 200 : 503,
    statusText: success ? "OK" : "private response text",
    responseMs: 24,
    location: "SJC",
    errorCode: null,
    ...overrides,
  };
}

function state(overrides: Partial<MonitorState> = {}): MonitorState {
  return {
    monitorId: "blog",
    level: "operational",
    consecutiveFailures: 0,
    consecutiveSuccesses: 0,
    firstFailedAt: null,
    latest: result("blog", true, { checkedAt: AT - 60_000 }),
    ...overrides,
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function runnerHarness(
  options: {
    app?: AppConfig;
    states?: Map<string, MonitorState>;
    probe?: RunChecksDependencies["probeMonitor"];
    persist?: RunChecksDependencies["persistCheckBatch"];
    location?: string;
  } = {},
) {
  const logs: SafeStructuredRecord[] = [];
  const persisted: Parameters<RunChecksDependencies["persistCheckBatch"]>[1][] = [];
  const loadMonitorStates = vi.fn(async () => options.states ?? new Map());
  const resolveLocation = vi.fn(async () => options.location ?? "SJC");
  const probeMonitor = vi.fn(
    options.probe ??
      (async (item, scheduledAt, location) =>
        result(item.id, true, { checkedAt: scheduledAt, location })),
  );
  const persistCheckBatch = vi.fn(
    options.persist ??
      (async (_db, checks) => {
        persisted.push(checks);
        return { appliedMonitorIds: checks.map((check) => check.result.monitorId) };
      }),
  );
  const dependencies: RunChecksDependencies = {
    loadMonitorStates,
    resolveLocation,
    probeMonitor,
    persistCheckBatch,
    log: (record) => logs.push(record),
  };
  const db = {} as D1Database;
  const input = {
    scheduledAt: AT,
    config: options.app ?? config([monitor("blog")]),
    db,
    dependencies,
  };

  return {
    input,
    db,
    dependencies,
    loadMonitorStates,
    resolveLocation,
    probeMonitor,
    persistCheckBatch,
    persisted,
    logs,
  };
}

function summary(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    scheduledAt: AT,
    location: "SJC",
    checked: 1,
    succeeded: 1,
    failed: 0,
    notifications: [],
    duplicate: false,
    ...overrides,
  };
}

function scheduledController(cron = "* * * * *", scheduledTime = AT): ScheduledController {
  return { cron, scheduledTime } as ScheduledController;
}

function scheduledHarness(overrides: Partial<ScheduledDependencies> = {}) {
  const logs: SafeStructuredRecord[] = [];
  const runMonitoring = vi.fn(async () => summary());
  const dispatchNotifications = vi.fn(async () => [
    { channel: "slack" as const, status: "sent" as const },
    { channel: "telegram" as const, status: "skipped" as const, reason: "not-configured" },
  ]);
  const dependencies: ScheduledDependencies = {
    config: config([monitor("blog")]),
    runMonitoring,
    dispatchNotifications,
    fetch: vi.fn(async () => new Response(null, { status: 200 })) as unknown as typeof fetch,
    log: (record) => logs.push(record),
    ...overrides,
  };
  const waitUntil = vi.fn((_promise: Promise<unknown>) => undefined);
  const env = { DB: {} as D1Database } as Env;
  const ctx = { waitUntil } as unknown as ExecutionContext;

  return {
    handler: createScheduledHandler(dependencies),
    dependencies,
    runMonitoring,
    dispatchNotifications,
    waitUntil,
    env,
    ctx,
    logs,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runChecks", () => {
  it("returns accurate mixed-result counts and persists one configured-order batch", async () => {
    const app = config([monitor("blog"), monitor("vault")]);
    const harness = runnerHarness({
      app,
      probe: async (item, scheduledAt, location) =>
        item.id === "blog"
          ? result("blog", true, { checkedAt: scheduledAt, location })
          : result("vault", false, { checkedAt: scheduledAt, location, errorCode: "network" }),
    });

    await expect(runChecks(harness.input)).resolves.toEqual({
      scheduledAt: AT,
      location: "SJC",
      checked: 2,
      succeeded: 1,
      failed: 1,
      notifications: [],
      duplicate: false,
    });
    expect(harness.persisted).toHaveLength(1);
    expect(harness.persisted[0]?.map((check) => check.result.monitorId)).toEqual(["blog", "vault"]);
  });

  it("loads state, resolves location, and persists exactly once, including for no monitors", async () => {
    const harness = runnerHarness({ app: config([]) });

    await expect(runChecks(harness.input)).resolves.toMatchObject({
      checked: 0,
      succeeded: 0,
      failed: 0,
      notifications: [],
    });
    expect(harness.loadMonitorStates).toHaveBeenCalledOnce();
    expect(harness.loadMonitorStates).toHaveBeenCalledWith(harness.db, []);
    expect(harness.resolveLocation).toHaveBeenCalledOnce();
    expect(harness.probeMonitor).not.toHaveBeenCalled();
    expect(harness.persistCheckBatch).toHaveBeenCalledOnce();
    expect(harness.persisted).toEqual([[]]);
  });

  it("requests history cleanup only at the UTC day boundary", async () => {
    const midnight = runnerHarness();
    midnight.input.scheduledAt = Date.UTC(2026, 7, 5);
    midnight.input.config.site.historyDays = 3;
    await runChecks(midnight.input);

    expect(midnight.persistCheckBatch).toHaveBeenCalledWith(midnight.db, expect.any(Array), {
      beforeDay: "2026-08-03",
      beforeMs: Date.UTC(2026, 7, 3),
    });

    const daytime = runnerHarness();
    await runChecks(daytime.input);
    expect(daytime.persistCheckBatch).toHaveBeenCalledWith(
      daytime.db,
      expect.any(Array),
      undefined,
    );
  });

  it("starts every configured probe before allowing any probe to settle", async () => {
    const releases = [deferred<CheckResult>(), deferred<CheckResult>(), deferred<CheckResult>()];
    const started: string[] = [];
    const app = config([monitor("one"), monitor("two"), monitor("three")]);
    const harness = runnerHarness({
      app,
      probe: (item) => {
        started.push(item.id);
        const index = started.length - 1;
        const pending = releases[index];
        if (pending === undefined) throw new Error("unexpected probe");
        return pending.promise;
      },
    });

    const pendingRun = runChecks(harness.input);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(started).toEqual(["one", "two", "three"]);
    releases[2]?.resolve(result("three", true));
    releases[0]?.resolve(result("one", true));
    releases[1]?.resolve(result("two", true));

    await expect(pendingRun).resolves.toMatchObject({ checked: 3, succeeded: 3 });
  });

  it("normalizes an unexpected rejected probe without storing or logging its raw value", async () => {
    const rawThrown = new Error("RAW_THROWN_VALUE https://secret.example token-123");
    const harness = runnerHarness({
      probe: async () => Promise.reject(rawThrown),
    });

    await expect(runChecks(harness.input)).resolves.toMatchObject({
      checked: 1,
      succeeded: 0,
      failed: 1,
    });
    expect(harness.persisted[0]?.[0]?.result).toEqual({
      monitorId: "blog",
      checkedAt: AT,
      success: false,
      httpStatus: null,
      statusText: null,
      responseMs: null,
      location: "SJC",
      errorCode: "unexpected",
    });
    const serializedLogs = JSON.stringify(harness.logs);
    expect(serializedLogs).not.toContain("RAW_THROWN_VALUE");
    expect(serializedLogs).not.toContain("secret.example");
    expect(serializedLogs).not.toContain("token-123");
  });

  it("merges global thresholds with each monitor override", async () => {
    const app = config([
      monitor("global"),
      monitor("override", { thresholds: { degradedAfterFailures: 1 } }),
    ]);
    const harness = runnerHarness({
      app,
      probe: async (item, scheduledAt, location) =>
        result(item.id, false, {
          checkedAt: scheduledAt,
          location,
        }),
    });

    const value = await runChecks(harness.input);

    expect(harness.persisted[0]?.map((check) => check.transition.next.level)).toEqual([
      "operational",
      "degraded",
    ]);
    expect(value.notifications).toEqual([{ type: "failure", monitorId: "override", at: AT }]);
  });

  it.each([
    {
      name: "degraded opening",
      previous: null,
      thresholds: { degradedAfterFailures: 1, outageAfterMinutes: 60, recoverAfterSuccesses: 2 },
      check: result("blog", false),
      want: [{ type: "failure", monitorId: "blog", at: AT }],
    },
    {
      name: "recovery",
      previous: state({
        level: "degraded",
        consecutiveFailures: 2,
        consecutiveSuccesses: 1,
        firstFailedAt: AT - 120_000,
      }),
      thresholds: { degradedAfterFailures: 2, outageAfterMinutes: 60, recoverAfterSuccesses: 2 },
      check: result("blog", true),
      want: [{ type: "recovery", monitorId: "blog", at: AT }],
    },
    {
      name: "outage escalation",
      previous: state({
        level: "degraded",
        consecutiveFailures: 12,
        firstFailedAt: AT - 60 * 60_000,
      }),
      thresholds: { degradedAfterFailures: 1, outageAfterMinutes: 60, recoverAfterSuccesses: 2 },
      check: result("blog", false),
      want: [],
    },
  ])("returns the correct action for $name", async ({ previous, thresholds, check, want }) => {
    const harness = runnerHarness({
      app: config([monitor("blog")], thresholds),
      states: previous === null ? new Map() : new Map([["blog", previous]]),
      probe: async () => check,
    });

    await expect(runChecks(harness.input)).resolves.toMatchObject({ notifications: want });
  });

  it("returns duplicate without notifications and emits one duplicate run record", async () => {
    const harness = runnerHarness({
      app: config([monitor("blog", { thresholds: { degradedAfterFailures: 1 } })]),
      probe: async () => result("blog", false),
      persist: async () => ({ appliedMonitorIds: [] }),
    });

    await expect(runChecks(harness.input)).resolves.toEqual({
      scheduledAt: AT,
      location: "SJC",
      checked: 1,
      succeeded: 0,
      failed: 1,
      notifications: [],
      duplicate: true,
    });
    expect(harness.logs).toEqual([
      {
        event: "monitoring-run",
        scheduledAt: AT,
        location: "SJC",
        checked: 1,
        succeeded: 0,
        failed: 1,
        duplicate: true,
        results: [{ monitorId: "blog", errorCode: null }],
      },
    ]);
  });

  it("rethrows a non-duplicate storage error unchanged after one fixed safe failure log", async () => {
    const storageError = new Error("D1 unavailable at https://private.example token-123");
    const harness = runnerHarness({ persist: async () => Promise.reject(storageError) });

    await expect(runChecks(harness.input)).rejects.toBe(storageError);
    expect(harness.logs).toEqual([
      {
        event: "monitoring-storage-failed",
        scheduledAt: AT,
        location: "SJC",
        checked: 1,
        succeeded: 1,
        failed: 0,
        duplicate: false,
        results: [{ monitorId: "blog", errorCode: null }],
      },
    ]);
    expect(JSON.stringify(harness.logs)).not.toContain("D1 unavailable");
    expect(JSON.stringify(harness.logs)).not.toContain("private.example");
    expect(JSON.stringify(harness.logs)).not.toContain("token-123");
  });

  it.each([
    { cadenceMinutes: 1, checksBeforeOutage: 60, wantOutageAt: 60 * 60_000 },
    { cadenceMinutes: 5, checksBeforeOutage: 12, wantOutageAt: 60 * 60_000 },
    { cadenceMinutes: 10, checksBeforeOutage: 6, wantOutageAt: 60 * 60_000 },
  ])(
    "at $cadenceMinutes-minute cadence waits for 60 elapsed minutes, not a failure count",
    async ({ cadenceMinutes, checksBeforeOutage, wantOutageAt }) => {
      let current: MonitorState | undefined;
      let scheduledAt = 0;
      const levels: string[] = [];
      const app = config([monitor("blog")], {
        degradedAfterFailures: 1,
        outageAfterMinutes: 60,
        recoverAfterSuccesses: 2,
      });
      const dependencies: RunChecksDependencies = {
        loadMonitorStates: async () =>
          current === undefined ? new Map() : new Map([["blog", current]]),
        resolveLocation: async () => "SJC",
        probeMonitor: async () => result("blog", false, { checkedAt: scheduledAt }),
        persistCheckBatch: async (_db, checks) => {
          current = checks[0]?.transition.next;
          if (current !== undefined) levels.push(current.level);
          return { appliedMonitorIds: checks.map((check) => check.result.monitorId) };
        },
        log: () => undefined,
      };

      for (let index = 0; index <= checksBeforeOutage; index += 1) {
        scheduledAt = index * cadenceMinutes * 60_000;
        await runChecks({ scheduledAt, config: app, db: {} as D1Database, dependencies });
      }

      expect(levels.at(-2)).toBe("degraded");
      expect(current?.level).toBe("outage");
      expect(current?.latest.checkedAt).toBe(wantOutageAt);
    },
  );
});

describe("scheduled handler", () => {
  it("calls waitUntil only after a successful monitoring commit resolves", async () => {
    const pending = deferred<RunSummary>();
    const runMonitoring = vi.fn(() => pending.promise);
    const harness = scheduledHarness({ runMonitoring });

    const handlerPromise = harness.handler(scheduledController(), harness.env, harness.ctx);
    await Promise.resolve();
    expect(harness.waitUntil).not.toHaveBeenCalled();

    pending.resolve(
      summary({
        notifications: [{ type: "failure", monitorId: "blog", at: AT }],
      }),
    );
    await handlerPromise;

    expect(harness.dispatchNotifications).toHaveBeenCalledOnce();
    expect(harness.waitUntil).toHaveBeenCalledOnce();
    await harness.waitUntil.mock.calls[0]?.[0];
  });

  it("schedules no notification when monitoring returns duplicate", async () => {
    const harness = scheduledHarness({
      runMonitoring: vi.fn(async () =>
        summary({
          duplicate: true,
          notifications: [],
        }),
      ),
    });

    await harness.handler(scheduledController(), harness.env, harness.ctx);

    expect(harness.dispatchNotifications).not.toHaveBeenCalled();
    expect(harness.waitUntil).not.toHaveBeenCalled();
  });

  it("lets a monitoring storage failure escape and schedules no notification", async () => {
    const failure = new Error("D1 unavailable");
    const harness = scheduledHarness({
      runMonitoring: vi.fn(async () => Promise.reject(failure)),
    });

    await expect(harness.handler(scheduledController(), harness.env, harness.ctx)).rejects.toBe(
      failure,
    );
    expect(harness.dispatchNotifications).not.toHaveBeenCalled();
    expect(harness.waitUntil).not.toHaveBeenCalled();
  });

  it("logs one safe record for each channel result after dispatch settles", async () => {
    const harness = scheduledHarness();

    await harness.handler(scheduledController(), harness.env, harness.ctx);
    await harness.waitUntil.mock.calls[0]?.[0];

    expect(harness.logs).toEqual([
      { event: "notification-channel", channel: "slack", status: "sent" },
      {
        event: "notification-channel",
        channel: "telegram",
        status: "skipped",
        reason: "not-configured",
      },
    ]);
    const serialized = JSON.stringify(harness.logs);
    expect(serialized).not.toContain("private.example");
    expect(serialized).not.toContain("token");
    expect(serialized).not.toContain("response text");
  });
});

describe("production structured logging", () => {
  it("stringifies one record into one console.log call", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const record: SafeStructuredRecord = {
      event: "notification-channel",
      channel: "discord",
      status: "failed",
      reason: "send-failed",
    };

    logStructuredRecord(record);

    expect(spy).toHaveBeenCalledOnce();
    expect(spy).toHaveBeenCalledWith(
      '{"event":"notification-channel","channel":"discord","status":"failed","reason":"send-failed"}',
    );
  });
});
