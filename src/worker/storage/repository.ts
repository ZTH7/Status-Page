import type { CheckResult, MonitorState, MonitorTransition } from "../../domain/types";
import { monitorStateFromRow, type MonitorStateRow } from "./rows";
import {
  DELETE_EXPIRED_CHECKS,
  ESCALATE_INCIDENT,
  INSERT_CHECK_RESULT,
  INSERT_INCIDENT,
  RECOVER_INCIDENT,
  UPSERT_DAILY_SUMMARY,
  UPSERT_MONITOR_STATE,
  selectMonitorStatesSql,
} from "./sql";

export interface PersistedCheck {
  result: CheckResult;
  transition: MonitorTransition;
}

export class DuplicateCheckBatchError extends Error {
  readonly name = "DuplicateCheckBatchError";

  constructor(options?: ErrorOptions) {
    super("The scheduled check batch has already been persisted.", options);
  }
}

export async function loadMonitorStates(
  db: D1Database,
  monitorIds: readonly string[],
): Promise<Map<string, MonitorState>> {
  if (monitorIds.length === 0) return new Map();

  const result = await db
    .prepare(selectMonitorStatesSql(monitorIds.length))
    .bind(...monitorIds)
    .all<MonitorStateRow>();

  return new Map(result.results.map((row) => {
    const state = monitorStateFromRow(row);
    return [state.monitorId, state] as const;
  }));
}

export async function persistCheckBatch(
  db: D1Database,
  checks: readonly PersistedCheck[],
): Promise<void> {
  if (checks.length === 0) return;

  const statements: D1PreparedStatement[] = [];

  for (const check of checks) {
    const { result, transition } = check;
    statements.push(
      db.prepare(INSERT_CHECK_RESULT).bind(
        result.monitorId,
        result.checkedAt,
        result.success ? 1 : 0,
        result.httpStatus,
        result.statusText,
        result.responseMs,
        result.location,
        result.errorCode,
      ),
      db.prepare(UPSERT_DAILY_SUMMARY).bind(
        result.monitorId,
        new Date(result.checkedAt).toISOString().slice(0, 10),
        result.location || "unknown",
        1,
        result.success ? 0 : 1,
        result.responseMs ?? 0,
        result.responseMs === null ? 0 : 1,
        transition.dailySeverity,
      ),
    );

    if (transition.stale) continue;

    const state = transition.next;
    statements.push(db.prepare(UPSERT_MONITOR_STATE).bind(
      state.monitorId,
      state.level,
      state.consecutiveFailures,
      state.consecutiveSuccesses,
      state.firstFailedAt,
      state.latest.checkedAt,
      state.latest.success ? 1 : 0,
      state.latest.httpStatus,
      state.latest.statusText,
      state.latest.responseMs,
      state.latest.location,
      state.latest.errorCode,
    ));

    const incident = transition.incident;
    if (incident?.type === "open") {
      statements.push(db.prepare(INSERT_INCIDENT).bind(
        incident.incidentId,
        result.monitorId,
        incident.firstFailedAt,
        incident.degradedAt,
        result.monitorId,
        result.checkedAt,
      ));
    } else if (incident?.type === "escalate") {
      statements.push(db.prepare(ESCALATE_INCIDENT).bind(
        incident.outageAt,
        incident.incidentId,
        result.monitorId,
        result.checkedAt,
      ));
    } else if (incident?.type === "recover") {
      statements.push(db.prepare(RECOVER_INCIDENT).bind(
        incident.recoveredAt,
        incident.incidentId,
        result.monitorId,
        result.checkedAt,
      ));
    }
  }

  try {
    await db.batch(statements);
  } catch (error) {
    if (
      error instanceof Error
      && error.message.includes(
        "UNIQUE constraint failed: check_results.monitor_id, check_results.checked_at",
      )
    ) {
      throw new DuplicateCheckBatchError({ cause: error });
    }
    throw error;
  }
}

export async function deleteExpiredChecks(
  db: D1Database,
  cutoffMs: number,
): Promise<number> {
  const result = await db.prepare(DELETE_EXPIRED_CHECKS).bind(cutoffMs).run();
  return result.meta.changes;
}
