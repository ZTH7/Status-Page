import type { MonitorState } from "../../domain/types";
import {
  dailySummaryFromRow,
  incidentFromRow,
  monitorStateFromRow,
  type DailySummary,
  type DailySummaryRow,
  type IncidentRecord,
  type IncidentRow,
  type MonitorStateRow,
} from "./rows";
import {
  selectDailySummariesSql,
  selectMonitorStatesSql,
  selectOverlappingIncidentsSql,
} from "./sql";

export async function readCurrentStates(
  db: D1Database,
  monitorIds: readonly string[],
): Promise<MonitorState[]> {
  if (monitorIds.length === 0) return [];

  const result = await db
    .prepare(selectMonitorStatesSql(monitorIds.length))
    .bind(...monitorIds)
    .all<MonitorStateRow>();
  return result.results.map(monitorStateFromRow);
}

export async function readDailySummariesSince(
  db: D1Database,
  monitorIds: readonly string[],
  sinceDay: string,
): Promise<DailySummary[]> {
  if (monitorIds.length === 0) return [];

  const result = await db
    .prepare(selectDailySummariesSql(monitorIds.length))
    .bind(...monitorIds, sinceDay)
    .all<DailySummaryRow>();
  return result.results.map(dailySummaryFromRow);
}

export async function readIncidentsOverlapping(
  db: D1Database,
  monitorIds: readonly string[],
  windowStartMs: number,
  windowEndMs: number,
): Promise<IncidentRecord[]> {
  if (monitorIds.length === 0) return [];

  const result = await db
    .prepare(selectOverlappingIncidentsSql(monitorIds.length))
    .bind(...monitorIds, windowEndMs, windowStartMs)
    .all<IncidentRow>();
  return result.results.map(incidentFromRow);
}
