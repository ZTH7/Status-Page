import type { MonitorConfig } from "../../config/types";
import type { CheckResult, ErrorCode } from "../../domain/types";
import { appConfig } from "../../generated/config";

export interface ProbeDependencies {
  fetch: typeof fetch;
  now: () => number;
  setTimer: typeof setTimeout;
  clearTimer: typeof clearTimeout;
}

function normalizeError(value: unknown, timedOut: boolean): ErrorCode {
  if (timedOut) {
    return "timeout";
  }

  if (!(value instanceof TypeError)) {
    return "unexpected";
  }

  const message = value.message.toLowerCase();
  if (message.includes("dns") || message.includes("host lookup") || message.includes("name resolution")) {
    return "dns";
  }
  if (message.includes("tls") || message.includes("ssl") || message.includes("certificate")) {
    return "tls";
  }
  return "network";
}

export async function probeMonitor(
  monitor: MonitorConfig,
  checkedAt: number,
  location: string,
  dependencies: ProbeDependencies,
): Promise<CheckResult> {
  const controller = new AbortController();
  let timedOut = false;
  const timeoutMs = (monitor.timeoutSeconds ?? appConfig.site.requestTimeoutSeconds) * 1_000;
  const timer = dependencies.setTimer(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const startedAt = dependencies.now();
    const response = await dependencies.fetch(monitor.url, {
      method: monitor.method,
      redirect: monitor.followRedirect ? "follow" : "manual",
      headers: { "User-Agent": "CFStatusPage/2" },
      signal: controller.signal,
    });
    const responseMs = Math.max(0, dependencies.now() - startedAt);

    return {
      monitorId: monitor.id,
      checkedAt,
      success: response.status === monitor.expectStatus,
      httpStatus: response.status,
      statusText: response.statusText,
      responseMs,
      location,
      errorCode: null,
    };
  } catch (error) {
    return {
      monitorId: monitor.id,
      checkedAt,
      success: false,
      httpStatus: null,
      statusText: null,
      responseMs: null,
      location,
      errorCode: normalizeError(error, timedOut),
    };
  } finally {
    dependencies.clearTimer(timer);
  }
}
