import type { AppConfig, MonitorConfig } from "../../config/types";
import { transitionMonitor } from "../../domain/status-machine";
import { resolveThresholds } from "../../domain/thresholds";
import type {
  CheckResult,
  ErrorCode,
  MonitorState,
  NotificationAction,
} from "../../domain/types";
import {
  deleteExpiredChecks,
  DuplicateCheckBatchError,
  type PersistedCheck,
} from "../storage/repository";

interface SafeResultRecord {
  monitorId: string;
  errorCode: ErrorCode | null;
}

interface MonitoringRecord {
  event: "monitoring-run" | "monitoring-storage-failed";
  scheduledAt: number;
  location: string;
  checked: number;
  succeeded: number;
  failed: number;
  duplicate: boolean;
  results: SafeResultRecord[];
}

interface NotificationChannelRecord {
  event: "notification-channel";
  channel: "slack" | "telegram" | "discord";
  status: "sent" | "skipped" | "failed";
  reason?: "no-actions" | "not-configured" | "send-failed";
}

export type SafeStructuredRecord = MonitoringRecord | NotificationChannelRecord;

export interface RunSummary {
  scheduledAt: number;
  location: string;
  checked: number;
  succeeded: number;
  failed: number;
  notifications: NotificationAction[];
  duplicate: boolean;
}

export interface RunChecksDependencies {
  loadMonitorStates(
    db: D1Database,
    monitorIds: readonly string[],
  ): Promise<Map<string, MonitorState>>;
  resolveLocation(): Promise<string>;
  probeMonitor(
    monitor: MonitorConfig,
    scheduledAt: number,
    location: string,
  ): Promise<CheckResult>;
  persistCheckBatch(db: D1Database, checks: readonly PersistedCheck[]): Promise<void>;
  log(record: SafeStructuredRecord): void;
}

export interface RunChecksInput {
  scheduledAt: number;
  config: AppConfig;
  db: D1Database;
  dependencies: RunChecksDependencies;
}

export async function runChecks(input: RunChecksInput): Promise<RunSummary> {
  const { config, db, dependencies, scheduledAt } = input;
  const monitorIds = config.monitors.map((monitor) => monitor.id);
  const states = await dependencies.loadMonitorStates(db, monitorIds);
  const location = await dependencies.resolveLocation();
  const pendingResults = config.monitors.map(async (monitor) => (
    dependencies.probeMonitor(monitor, scheduledAt, location)
  ));
  const settledResults = await Promise.allSettled(pendingResults);
  const results = settledResults.map((settled, index) => {
    const monitor = config.monitors[index];
    if (monitor === undefined) {
      throw new Error("Probe result has no configured monitor.");
    }
    if (settled.status === "fulfilled") {
      return settled.value;
    }
    return unexpectedResult(monitor.id, scheduledAt, location);
  });
  const checks = results.map<PersistedCheck>((result, index) => {
    const monitor = config.monitors[index];
    if (monitor === undefined) {
      throw new Error("Check result has no configured monitor.");
    }
    return {
      result,
      transition: transitionMonitor(
        states.get(monitor.id) ?? null,
        result,
        resolveThresholds(config.site.thresholds, monitor.thresholds),
      ),
    };
  });
  const counts = countResults(results);
  const safeResults = results.map(({ monitorId, errorCode }) => ({ monitorId, errorCode }));

  try {
    await dependencies.persistCheckBatch(db, checks);
  } catch (error) {
    if (error instanceof DuplicateCheckBatchError) {
      const duplicateSummary = makeSummary(scheduledAt, location, counts, [], true);
      dependencies.log(runRecord("monitoring-run", duplicateSummary, safeResults));
      return duplicateSummary;
    }

    const failedSummary = makeSummary(scheduledAt, location, counts, [], false);
    dependencies.log(runRecord("monitoring-storage-failed", failedSummary, safeResults));
    throw error;
  }

  const notifications = checks.flatMap(({ transition }) => (
    transition.notification === null ? [] : [transition.notification]
  ));
  const summary = makeSummary(scheduledAt, location, counts, notifications, false);
  dependencies.log(runRecord("monitoring-run", summary, safeResults));
  return summary;
}

export function runRetention(db: D1Database, cutoffMs: number): Promise<number> {
  return deleteExpiredChecks(db, cutoffMs);
}

export function logStructuredRecord(record: SafeStructuredRecord): void {
  console.log(JSON.stringify(record));
}

function unexpectedResult(
  monitorId: string,
  checkedAt: number,
  location: string,
): CheckResult {
  return {
    monitorId,
    checkedAt,
    success: false,
    httpStatus: null,
    statusText: null,
    responseMs: null,
    location,
    errorCode: "unexpected",
  };
}

function countResults(results: readonly CheckResult[]): {
  checked: number;
  succeeded: number;
  failed: number;
} {
  const succeeded = results.filter((result) => result.success).length;
  return {
    checked: results.length,
    succeeded,
    failed: results.length - succeeded,
  };
}

function makeSummary(
  scheduledAt: number,
  location: string,
  counts: Pick<RunSummary, "checked" | "succeeded" | "failed">,
  notifications: NotificationAction[],
  duplicate: boolean,
): RunSummary {
  return {
    scheduledAt,
    location,
    ...counts,
    notifications,
    duplicate,
  };
}

function runRecord(
  event: MonitoringRecord["event"],
  summary: RunSummary,
  results: SafeResultRecord[],
): MonitoringRecord {
  return {
    event,
    scheduledAt: summary.scheduledAt,
    location: summary.location,
    checked: summary.checked,
    succeeded: summary.succeeded,
    failed: summary.failed,
    duplicate: summary.duplicate,
    results,
  };
}
