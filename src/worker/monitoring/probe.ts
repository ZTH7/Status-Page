import type { MonitorConfig } from "../../config/types";
import type { CheckResult, ErrorCode } from "../../domain/types";
import { appConfig } from "../../generated/config";

export interface ProbeDependencies {
  fetch: typeof fetch;
  now: () => number;
  setTimer: typeof setTimeout;
  clearTimer: typeof clearTimeout;
  userAgent?: string;
}

function normalizeError(value: unknown, timedOut: boolean): ErrorCode {
  if (timedOut) {
    return "timeout";
  }

  if (!(value instanceof TypeError)) {
    return "unexpected";
  }

  const message = value.message.toLowerCase();
  if (
    message.includes("dns") ||
    message.includes("host lookup") ||
    message.includes("name resolution")
  ) {
    return "dns";
  }
  if (message.includes("tls") || message.includes("ssl") || message.includes("certificate")) {
    return "tls";
  }
  return "network";
}

function safeNetworkDiagnostic(value: unknown, targetUrl: string): string | undefined {
  if (!(value instanceof TypeError)) return undefined;

  const diagnostic = value.message
    .replaceAll(targetUrl, "<target-url>")
    .replace(/https?:\/\/[^\s"'<>]+/gi, "<url>")
    .replace(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b/gi, "<host>")
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "<ip>")
    .replace(/\b[A-Za-z0-9_-]{24,}\b/g, "<opaque>")
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, 160);

  return diagnostic || "TypeError without a message";
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
      headers: { "User-Agent": dependencies.userAgent ?? appConfig.site.userAgent },
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
    const diagnostic = timedOut ? undefined : safeNetworkDiagnostic(error, monitor.url);
    return {
      monitorId: monitor.id,
      checkedAt,
      success: false,
      httpStatus: null,
      statusText: null,
      responseMs: null,
      location,
      errorCode: normalizeError(error, timedOut),
      ...(diagnostic === undefined ? {} : { diagnostic }),
    };
  } finally {
    dependencies.clearTimer(timer);
  }
}
