import { afterEach, describe, expect, it, vi } from "vitest";

import type { MonitorConfig } from "../../src/config/types";
import type { CheckResult } from "../../src/domain/types";
import { resolveLocation } from "../../src/worker/monitoring/location";
import { probeMonitor, type ProbeDependencies } from "../../src/worker/monitoring/probe";

const CHECKED_AT = 1_785_931_200_000;

function monitor(overrides: Partial<MonitorConfig> = {}): MonitorConfig {
  return {
    id: "blog",
    name: "Blog",
    url: "https://status.example.test/health",
    linkable: true,
    method: "GET",
    expectStatus: 200,
    followRedirect: false,
    ...overrides,
  };
}

function response(status: number, statusText = "OK"): Response {
  return new Response(null, { status, statusText });
}

function timerDependencies(
  fetcher: typeof fetch,
  times: number[],
): {
  dependencies: ProbeDependencies;
  delays: number[];
  cleared: unknown[];
  fireNextTimer(): void;
} {
  const callbacks: Array<() => void> = [];
  const delays: number[] = [];
  const cleared: unknown[] = [];

  return {
    dependencies: {
      fetch: fetcher,
      now: () => {
        const next = times.shift();
        if (next === undefined) {
          throw new Error("Test clock exhausted");
        }
        return next;
      },
      setTimer: ((callback: () => void, delay: number) => {
        callbacks.push(callback);
        delays.push(delay);
        return callbacks.length;
      }) as typeof setTimeout,
      clearTimer: ((timer: unknown) => {
        cleared.push(timer);
      }) as typeof clearTimeout,
    },
    delays,
    cleared,
    fireNextTimer() {
      const callback = callbacks.shift();
      if (callback === undefined) {
        throw new Error("No timer was scheduled");
      }
      callback();
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("probeMonitor", () => {
  it("returns a successful result for the configured expected status", async () => {
    const fetcher = vi.fn(async () => response(200, "Healthy")) as unknown as typeof fetch;
    const timer = timerDependencies(fetcher, [100, 143]);

    await expect(probeMonitor(monitor(), CHECKED_AT, "SJC", timer.dependencies)).resolves.toEqual({
      monitorId: "blog",
      checkedAt: CHECKED_AT,
      success: true,
      httpStatus: 200,
      statusText: "Healthy",
      responseMs: 43,
      location: "SJC",
      errorCode: null,
    });
    expect(timer.cleared).toEqual([1]);
  });

  it("calls receiver-sensitive runtime functions without binding the dependency object as this", async () => {
    const calls: string[] = [];
    const fetcher = function (this: unknown) {
      if (this !== undefined) throw new TypeError("Illegal invocation");
      calls.push("fetch");
      return Promise.resolve(response(200));
    } as typeof fetch;
    const now = function (this: unknown) {
      if (this !== undefined) throw new TypeError("Illegal invocation");
      calls.push("now");
      return calls.filter((call) => call === "now").length;
    };
    const setTimer = function (this: unknown) {
      if (this !== undefined) throw new TypeError("Illegal invocation");
      calls.push("setTimer");
      return 1;
    } as unknown as typeof setTimeout;
    const clearTimer = function (this: unknown) {
      if (this !== undefined) throw new TypeError("Illegal invocation");
      calls.push("clearTimer");
    } as unknown as typeof clearTimeout;

    await expect(
      probeMonitor(monitor(), CHECKED_AT, "SJC", {
        fetch: fetcher,
        now,
        setTimer,
        clearTimer,
      }),
    ).resolves.toMatchObject({ success: true, httpStatus: 200 });
    expect(calls).toEqual(["setTimer", "now", "fetch", "now", "clearTimer"]);
  });

  it("keeps a received mismatched status as a normal failed result", async () => {
    const fetcher = vi.fn(async () => response(503, "Unavailable")) as unknown as typeof fetch;
    const timer = timerDependencies(fetcher, [5, 8]);

    await expect(
      probeMonitor(monitor(), CHECKED_AT, "unknown", timer.dependencies),
    ).resolves.toMatchObject({
      success: false,
      httpStatus: 503,
      statusText: "Unavailable",
      responseMs: 3,
      errorCode: null,
    });
  });

  it("uses manual redirects unless following redirects is configured", async () => {
    const manualFetch = vi.fn(async () => response(200)) as unknown as typeof fetch;
    const followFetch = vi.fn(async () => response(200)) as unknown as typeof fetch;

    await probeMonitor(
      monitor(),
      CHECKED_AT,
      "SJC",
      timerDependencies(manualFetch, [0, 1]).dependencies,
    );
    await probeMonitor(
      monitor({ followRedirect: true }),
      CHECKED_AT,
      "SJC",
      timerDependencies(followFetch, [0, 1]).dependencies,
    );

    expect(manualFetch).toHaveBeenCalledWith(
      "https://status.example.test/health",
      expect.objectContaining({ redirect: "manual" }),
    );
    expect(followFetch).toHaveBeenCalledWith(
      "https://status.example.test/health",
      expect.objectContaining({ redirect: "follow" }),
    );
  });

  it("sends the configured HEAD method and custom status-page user agent", async () => {
    const fetcher = vi.fn(async () => response(204, "No Content")) as unknown as typeof fetch;
    const timer = timerDependencies(fetcher, [10, 10]);
    timer.dependencies.userAgent = "MyStatusProbe/1.0";

    await probeMonitor(
      monitor({ method: "HEAD", expectStatus: 204 }),
      CHECKED_AT,
      "SJC",
      timer.dependencies,
    );

    expect(fetcher).toHaveBeenCalledWith(
      "https://status.example.test/health",
      expect.objectContaining({ method: "HEAD", headers: { "User-Agent": "MyStatusProbe/1.0" } }),
    );
  });

  it("uses the configured timeout in milliseconds", async () => {
    const fetcher = vi.fn(async () => response(200)) as unknown as typeof fetch;
    const timer = timerDependencies(fetcher, [0, 1]);

    await probeMonitor(monitor({ timeoutSeconds: 3 }), CHECKED_AT, "SJC", timer.dependencies);

    expect(timer.delays).toEqual([3_000]);
  });

  it("uses the generated site default timeout when the monitor has none", async () => {
    const fetcher = vi.fn(async () => response(200)) as unknown as typeof fetch;
    const timer = timerDependencies(fetcher, [0, 1]);

    await probeMonitor(monitor(), CHECKED_AT, "SJC", timer.dependencies);

    expect(timer.delays).toEqual([10_000]);
  });

  it("returns timeout without raw error text when its abort timer fires and clears the timer", async () => {
    const fetcher = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("private timeout detail", "AbortError")),
          );
        }),
    ) as unknown as typeof fetch;
    const timer = timerDependencies(fetcher, [10]);
    const pending = probeMonitor(monitor(), CHECKED_AT, "SJC", timer.dependencies);

    timer.fireNextTimer();

    const result = await pending;
    expect(result).toMatchObject({
      success: false,
      httpStatus: null,
      statusText: null,
      responseMs: null,
      errorCode: "timeout",
    });
    expect(JSON.stringify(result)).not.toContain("private timeout detail");
    expect(timer.cleared).toEqual([1]);
  });

  it("classifies a TypeError raised after its timer abort as timeout", async () => {
    const fetcher = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new TypeError("socket closed after abort")),
          );
        }),
    ) as unknown as typeof fetch;
    const timer = timerDependencies(fetcher, [10]);
    const pending = probeMonitor(monitor(), CHECKED_AT, "SJC", timer.dependencies);

    timer.fireNextTimer();

    await expect(pending).resolves.toMatchObject({ errorCode: "timeout" });
  });

  it.each([
    [new TypeError("DNS host lookup failed for private.example"), "dns"],
    [new TypeError("SSL certificate rejected for private.example"), "tls"],
    [new TypeError("socket closed at private.example"), "network"],
    [new Error("private unexpected failure"), "unexpected"],
  ] as const)("normalizes %s without persisting its raw message", async (thrown, errorCode) => {
    const fetcher = vi.fn(async () => Promise.reject(thrown)) as unknown as typeof fetch;
    const timer = timerDependencies(fetcher, [99]);

    const result = await probeMonitor(monitor(), CHECKED_AT, "SJC", timer.dependencies);

    expect(result).toMatchObject({
      success: false,
      httpStatus: null,
      statusText: null,
      responseMs: null,
      errorCode,
    });
    expect(JSON.stringify(result)).not.toContain(thrown.message);
  });

  it("keeps a bounded network diagnostic while redacting URLs, hosts, IPs, and opaque values", async () => {
    const opaque = "abcdefghijklmnopqrstuvwxyz0123456789";
    const fetcher = vi.fn(async () =>
      Promise.reject(
        new TypeError(
          `Fetch https://status.example.test/health failed via private.example at 192.0.2.1 ${opaque}`,
        ),
      ),
    ) as unknown as typeof fetch;

    const result = await probeMonitor(
      monitor(),
      CHECKED_AT,
      "SJC",
      timerDependencies(fetcher, [99]).dependencies,
    );

    expect(result).toMatchObject({
      errorCode: "network",
      diagnostic: "Fetch <target-url> failed via <host> at <ip> <opaque>",
    });
    expect(JSON.stringify(result)).not.toMatch(/status\.example|private\.example|192\.0\.2\.1/);
    expect(JSON.stringify(result)).not.toContain(opaque);
  });
});

describe("resolveLocation", () => {
  it("returns the first valid colo line from a successful trace response", async () => {
    const fetcher = vi.fn(
      async () => new Response("fl=29f\ncolo=SJC\ncolo=LAX\n", { status: 200 }),
    ) as unknown as typeof fetch;

    await expect(resolveLocation(fetcher)).resolves.toBe("SJC");
    expect(fetcher).toHaveBeenCalledWith(
      "https://www.cloudflare.com/cdn-cgi/trace",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it.each([
    [new Response("colo=sjc\n", { status: 200 }), "malformed colo"],
    [new Response("colo=SJC\n", { status: 503 }), "non-2xx response"],
  ])("returns unknown for a %s", async (trace) => {
    const fetcher = vi.fn(async () => trace) as unknown as typeof fetch;

    await expect(resolveLocation(fetcher)).resolves.toBe("unknown");
  });

  it("returns unknown on trace timeout and leaves no timer pending", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("trace private detail", "AbortError")),
          );
        }),
    ) as unknown as typeof fetch;
    const pending = resolveLocation(fetcher);

    await vi.advanceTimersByTimeAsync(1_500);

    await expect(pending).resolves.toBe("unknown");
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("probe batches", () => {
  it("settles a success, timeout, and unexpected fetch rejection into results", async () => {
    const successFetch = vi.fn(async () => response(200)) as unknown as typeof fetch;
    const timeoutFetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("private timeout", "AbortError")),
          );
        }),
    ) as unknown as typeof fetch;
    const unexpectedFetch = vi.fn(async () =>
      Promise.reject(new Error("private batch failure")),
    ) as unknown as typeof fetch;
    const timeoutTimer = timerDependencies(timeoutFetch, [0]);

    const settled = Promise.allSettled([
      probeMonitor(
        monitor({ id: "success" }),
        CHECKED_AT,
        "SJC",
        timerDependencies(successFetch, [0, 1]).dependencies,
      ),
      probeMonitor(monitor({ id: "timeout" }), CHECKED_AT, "SJC", timeoutTimer.dependencies),
      probeMonitor(
        monitor({ id: "unexpected" }),
        CHECKED_AT,
        "SJC",
        timerDependencies(unexpectedFetch, [0]).dependencies,
      ),
    ]);
    timeoutTimer.fireNextTimer();

    const results = await settled;
    expect(results).toHaveLength(3);
    expect(results.every((settlement) => settlement.status === "fulfilled")).toBe(true);
    const checkResults = results.map(
      (settlement) => (settlement as PromiseFulfilledResult<CheckResult>).value,
    );
    expect(
      checkResults.map((result) => [result.monitorId, result.success, result.errorCode]),
    ).toEqual([
      ["success", true, null],
      ["timeout", false, "timeout"],
      ["unexpected", false, "unexpected"],
    ]);
  });
});
