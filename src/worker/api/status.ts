import type { AppConfig, MonitorConfig } from "../../config/types";
import { maxLevel } from "../../domain/status-machine";
import type { MonitorState } from "../../domain/types";
import type {
  ApiErrorResponse,
  PublicDay,
  PublicIncident,
  PublicMonitor,
  PublicSiteConfig,
  StatusResponse,
} from "../../shared/api-types";
import { listUtcDays } from "../../shared/dates";
import {
  readCurrentStates,
  readDailySummariesSince,
  readIncidentsOverlapping,
} from "../storage/read-model";
import type { DailySummary, IncidentRecord } from "../storage/rows";

const SUCCESS_CACHE_CONTROL = "public, max-age=15, stale-while-revalidate=45";
const JSON_CONTENT_TYPE = "application/json; charset=utf-8";

export interface StatusApiDependencies {
  config: AppConfig;
  db: D1Database;
  now(): number;
}

export async function buildStatusResponse(
  dependencies: StatusApiDependencies,
): Promise<StatusResponse> {
  const generatedAt = dependencies.now();
  const days = listUtcDays(generatedAt, dependencies.config.site.historyDays);
  const sinceDay = days[0]!;
  const windowStartMs = Date.parse(`${sinceDay}T00:00:00.000Z`);
  const monitorIds = dependencies.config.monitors.map(({ id }) => id);

  const [states, summaries, incidents] = await Promise.all([
    readCurrentStates(dependencies.db, monitorIds),
    readDailySummariesSince(dependencies.db, monitorIds, sinceDay),
    readIncidentsOverlapping(
      dependencies.db,
      monitorIds,
      windowStartMs,
      generatedAt,
    ),
  ]);

  const statesByMonitor = new Map(states.map((state) => [state.monitorId, state]));
  const summariesByMonitorAndDay = groupSummaries(summaries);
  const monitors = dependencies.config.monitors.map((monitor) => buildMonitor(
    monitor,
    statesByMonitor.get(monitor.id),
    days,
    summariesByMonitorAndDay,
  ));

  return {
    generatedAt,
    latestCompletedAt: latestCompletedAt(statesByMonitor, monitorIds),
    overall: maxLevel(monitors.map(({ level }) => level)),
    site: publicSite(dependencies.config),
    monitors,
    incidents: publicIncidents(
      incidents,
      dependencies.config.monitors,
      generatedAt,
    ),
  };
}

export async function handleStatusRequest(
  request: Request,
  dependencies: StatusApiDependencies,
): Promise<Response> {
  if (request.method !== "GET") {
    return jsonResponse<ApiErrorResponse>(
      {
        error: {
          code: "method_not_allowed",
          message: "Only GET is supported.",
        },
      },
      405,
      { Allow: "GET", "Cache-Control": "no-store" },
    );
  }

  try {
    return jsonResponse(
      await buildStatusResponse(dependencies),
      200,
      { "Cache-Control": SUCCESS_CACHE_CONTROL },
    );
  } catch {
    return jsonResponse<ApiErrorResponse>(
      {
        error: {
          code: "status_unavailable",
          message: "Status data is temporarily unavailable.",
        },
      },
      503,
      { "Cache-Control": "no-store" },
    );
  }
}

function publicSite(config: AppConfig): PublicSiteConfig {
  const { title, url, logo, theme, colorMode, historyDays, labels } = config.site;
  return { title, url, logo, theme, colorMode, historyDays, labels };
}

function groupSummaries(
  summaries: readonly DailySummary[],
): Map<string, Map<string, DailySummary[]>> {
  const grouped = new Map<string, Map<string, DailySummary[]>>();
  for (const summary of summaries) {
    let monitorDays = grouped.get(summary.monitorId);
    if (!monitorDays) {
      monitorDays = new Map();
      grouped.set(summary.monitorId, monitorDays);
    }
    const rows = monitorDays.get(summary.day) ?? [];
    rows.push(summary);
    monitorDays.set(summary.day, rows);
  }
  return grouped;
}

function buildMonitor(
  monitor: MonitorConfig,
  state: MonitorState | undefined,
  days: readonly string[],
  summaries: ReadonlyMap<string, ReadonlyMap<string, readonly DailySummary[]>>,
): PublicMonitor {
  return {
    id: monitor.id,
    name: monitor.name,
    ...(monitor.description === undefined
      ? {}
      : { description: monitor.description }),
    ...(monitor.linkable ? { href: monitor.url } : {}),
    ...(monitor.presentationLogo === undefined
      ? {}
      : { presentationLogo: monitor.presentationLogo }),
    level: state?.level ?? "unknown",
    latest: state
      ? {
          checkedAt: state.latest.checkedAt,
          httpStatus: state.latest.httpStatus,
          responseMs: state.latest.responseMs,
          location: state.latest.location,
        }
      : null,
    history: days.map((day) => buildDay(
      day,
      summaries.get(monitor.id)?.get(day) ?? [],
    )),
  };
}

function buildDay(day: string, rows: readonly DailySummary[]): PublicDay {
  if (rows.length === 0) {
    return { day, level: "unknown", checks: 0, failures: 0, locations: [] };
  }

  return {
    day,
    level: maxLevel(rows.map(({ highestSeverity }) => highestSeverity)),
    checks: rows.reduce((total, { checkCount }) => total + checkCount, 0),
    failures: rows.reduce(
      (total, { failedCheckCount }) => total + failedCheckCount,
      0,
    ),
    locations: rows
      .map((row) => ({
        code: row.location,
        averageMs: row.responseCount === 0
          ? null
          : row.responseTimeSum / row.responseCount,
        checks: row.checkCount,
      }))
      .sort((left, right) => compareText(left.code, right.code)),
  };
}

function latestCompletedAt(
  states: ReadonlyMap<string, MonitorState>,
  monitorIds: readonly string[],
): number | null {
  let latest: number | null = null;
  for (const monitorId of monitorIds) {
    const checkedAt = states.get(monitorId)?.latest.checkedAt;
    if (checkedAt !== undefined && (latest === null || checkedAt > latest)) {
      latest = checkedAt;
    }
  }
  return latest;
}

function publicIncidents(
  incidents: readonly IncidentRecord[],
  monitors: readonly MonitorConfig[],
  generatedAt: number,
): PublicIncident[] {
  const names = new Map(monitors.map(({ id, name }) => [id, name]));
  return incidents
    .flatMap((incident): PublicIncident[] => {
      const monitorName = names.get(incident.monitorId);
      if (monitorName === undefined) return [];
      const end = incident.recoveredAt ?? generatedAt;
      return [{
        id: incident.id,
        monitorId: incident.monitorId,
        monitorName,
        firstFailedAt: incident.firstFailedAt,
        degradedAt: incident.degradedAt,
        outageAt: incident.outageAt,
        recoveredAt: incident.recoveredAt,
        durationMs: Math.max(0, end - incident.firstFailedAt),
        highestSeverity: incident.highestSeverity,
      }];
    })
    .sort((left, right) => (
      right.firstFailedAt - left.firstFailedAt || compareText(left.id, right.id)
    ));
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function jsonResponse<T>(
  body: T,
  status: number,
  headers: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...headers,
      "Content-Type": JSON_CONTENT_TYPE,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
