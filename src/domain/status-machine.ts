import type { Thresholds } from "../config/types";
import type { CheckResult, MonitorState, MonitorTransition, StatusLevel } from "./types";

const rank: Record<StatusLevel | "unknown", number> = {
  unknown: -1,
  operational: 0,
  degraded: 1,
  outage: 2,
};

export function incidentId(monitorId: string, firstFailedAt: number): string {
  return `${monitorId}:${firstFailedAt}`;
}

export function maxLevel(levels: readonly (StatusLevel | "unknown")[]): StatusLevel | "unknown" {
  return levels.reduce<StatusLevel | "unknown">(
    (highest, level) => (rank[level] > rank[highest] ? level : highest),
    "unknown",
  );
}

export function transitionMonitor(
  previous: MonitorState | null,
  result: CheckResult,
  thresholds: Thresholds,
): MonitorTransition {
  if (previous && result.checkedAt <= previous.latest.checkedAt) {
    return {
      next: previous,
      incident: null,
      notification: null,
      dailySeverity: previous.level,
      stale: true,
    };
  }

  if (!previous) {
    return initialTransition(result, thresholds);
  }

  if (previous.level === "operational") {
    return transitionOperational(previous, result, thresholds);
  }

  return transitionIncident(previous, result, thresholds);
}

function initialTransition(result: CheckResult, thresholds: Thresholds): MonitorTransition {
  if (result.success) {
    return transition({
      monitorId: result.monitorId,
      level: "operational",
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
      firstFailedAt: null,
      latest: result,
    });
  }

  const next: MonitorState = {
    monitorId: result.monitorId,
    level: "operational",
    consecutiveFailures: 1,
    consecutiveSuccesses: 0,
    firstFailedAt: result.checkedAt,
    latest: result,
  };

  if (thresholds.degradedAfterFailures > 1) {
    return transition(next);
  }

  return openIncident(next, result.checkedAt);
}

function transitionOperational(
  previous: MonitorState,
  result: CheckResult,
  thresholds: Thresholds,
): MonitorTransition {
  if (result.success) {
    return transition({
      monitorId: result.monitorId,
      level: "operational",
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
      firstFailedAt: null,
      latest: result,
    });
  }

  const firstFailedAt = previous.firstFailedAt ?? result.checkedAt;
  const next: MonitorState = {
    monitorId: result.monitorId,
    level: "operational",
    consecutiveFailures: previous.consecutiveFailures + 1,
    consecutiveSuccesses: 0,
    firstFailedAt,
    latest: result,
  };

  if (next.consecutiveFailures < thresholds.degradedAfterFailures) {
    return transition(next);
  }

  return openIncident(next, result.checkedAt);
}

function transitionIncident(
  previous: MonitorState,
  result: CheckResult,
  thresholds: Thresholds,
): MonitorTransition {
  const firstFailedAt = previous.firstFailedAt ?? result.checkedAt;

  if (result.success) {
    const consecutiveSuccesses = previous.consecutiveSuccesses + 1;

    if (consecutiveSuccesses >= thresholds.recoverAfterSuccesses) {
      return {
        next: {
          monitorId: result.monitorId,
          level: "operational",
          consecutiveFailures: 0,
          consecutiveSuccesses: 0,
          firstFailedAt: null,
          latest: result,
        },
        incident: {
          type: "recover",
          incidentId: incidentId(result.monitorId, firstFailedAt),
          recoveredAt: result.checkedAt,
        },
        notification: { type: "recovery", monitorId: result.monitorId, at: result.checkedAt },
        dailySeverity: "operational",
        stale: false,
      };
    }

    return transition({
      monitorId: result.monitorId,
      level: previous.level,
      consecutiveFailures: 0,
      consecutiveSuccesses,
      firstFailedAt,
      latest: result,
    });
  }

  const next: MonitorState = {
    monitorId: result.monitorId,
    level: previous.level,
    consecutiveFailures: previous.consecutiveFailures + 1,
    consecutiveSuccesses: 0,
    firstFailedAt,
    latest: result,
  };

  if (
    previous.level === "degraded" &&
    result.checkedAt - firstFailedAt >= thresholds.outageAfterMinutes * 60_000
  ) {
    next.level = "outage";
    return {
      next,
      incident: {
        type: "escalate",
        incidentId: incidentId(result.monitorId, firstFailedAt),
        outageAt: result.checkedAt,
      },
      notification: null,
      dailySeverity: "outage",
      stale: false,
    };
  }

  return transition(next);
}

function openIncident(next: MonitorState, degradedAt: number): MonitorTransition {
  const firstFailedAt = next.firstFailedAt;
  if (firstFailedAt === null) {
    throw new Error("An incident cannot open without a first failure timestamp.");
  }

  next.level = "degraded";

  return {
    next,
    incident: {
      type: "open",
      incidentId: incidentId(next.monitorId, firstFailedAt),
      firstFailedAt,
      degradedAt,
    },
    notification: { type: "failure", monitorId: next.monitorId, at: degradedAt },
    dailySeverity: "degraded",
    stale: false,
  };
}

function transition(next: MonitorState): MonitorTransition {
  return {
    next,
    incident: null,
    notification: null,
    dailySeverity: next.level,
    stale: false,
  };
}
