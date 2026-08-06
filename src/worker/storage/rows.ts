import type { CheckResult, MonitorState, StatusLevel } from "../../domain/types";

export interface MonitorStateRow {
  monitor_id: string;
  level: string;
  consecutive_failures: number;
  consecutive_successes: number;
  first_failed_at: number | null;
  latest_checked_at: number;
  latest_success: number;
  latest_http_status: number | null;
  latest_status_text: string | null;
  latest_response_ms: number | null;
  latest_location: string | null;
  latest_error_code: string | null;
}

export interface DailySummaryRow {
  monitor_id: string;
  day: string;
  location: string;
  check_count: number;
  failed_check_count: number;
  response_time_sum: number;
  response_count: number;
  highest_severity: string;
}

export interface IncidentRow {
  id: string;
  monitor_id: string;
  first_failed_at: number;
  degraded_at: number;
  outage_at: number | null;
  recovered_at: number | null;
  highest_severity: string;
}

export interface DailySummary {
  monitorId: string;
  day: string;
  location: string;
  checkCount: number;
  failedCheckCount: number;
  responseTimeSum: number;
  responseCount: number;
  highestSeverity: StatusLevel;
}

export interface IncidentRecord {
  id: string;
  monitorId: string;
  firstFailedAt: number;
  degradedAt: number;
  outageAt: number | null;
  recoveredAt: number | null;
  highestSeverity: "degraded" | "outage";
}

const STATUS_LEVELS = new Set<StatusLevel>(["operational", "degraded", "outage"]);
const ERROR_CODES = new Set<NonNullable<CheckResult["errorCode"]>>([
  "timeout",
  "dns",
  "tls",
  "network",
  "unexpected",
]);

function booleanFromInteger(value: number, column: string): boolean {
  if (value === 0) return false;
  if (value === 1) return true;
  throw new TypeError(`Invalid ${column}: expected 0 or 1.`);
}

function statusLevel(value: string, column: string): StatusLevel {
  if (STATUS_LEVELS.has(value as StatusLevel)) return value as StatusLevel;
  throw new TypeError(`Invalid ${column}: ${value}.`);
}

function incidentLevel(value: string): "degraded" | "outage" {
  if (value === "degraded" || value === "outage") return value;
  throw new TypeError(`Invalid highest_severity: ${value}.`);
}

function errorCode(value: string | null, column: string): CheckResult["errorCode"] {
  if (value === null) return null;
  if (ERROR_CODES.has(value as NonNullable<CheckResult["errorCode"]>)) {
    return value as NonNullable<CheckResult["errorCode"]>;
  }
  throw new TypeError(`Invalid ${column}: ${value}.`);
}

export function monitorStateFromRow(row: MonitorStateRow): MonitorState {
  return {
    monitorId: row.monitor_id,
    level: statusLevel(row.level, "level"),
    consecutiveFailures: row.consecutive_failures,
    consecutiveSuccesses: row.consecutive_successes,
    firstFailedAt: row.first_failed_at,
    latest: {
      monitorId: row.monitor_id,
      checkedAt: row.latest_checked_at,
      success: booleanFromInteger(row.latest_success, "latest_success"),
      httpStatus: row.latest_http_status,
      statusText: row.latest_status_text,
      responseMs: row.latest_response_ms,
      location: row.latest_location ?? "",
      errorCode: errorCode(row.latest_error_code, "latest_error_code"),
    },
  };
}

export function dailySummaryFromRow(row: DailySummaryRow): DailySummary {
  return {
    monitorId: row.monitor_id,
    day: row.day,
    location: row.location,
    checkCount: row.check_count,
    failedCheckCount: row.failed_check_count,
    responseTimeSum: row.response_time_sum,
    responseCount: row.response_count,
    highestSeverity: statusLevel(row.highest_severity, "highest_severity"),
  };
}

export function incidentFromRow(row: IncidentRow): IncidentRecord {
  return {
    id: row.id,
    monitorId: row.monitor_id,
    firstFailedAt: row.first_failed_at,
    degradedAt: row.degraded_at,
    outageAt: row.outage_at,
    recoveredAt: row.recovered_at,
    highestSeverity: incidentLevel(row.highest_severity),
  };
}
