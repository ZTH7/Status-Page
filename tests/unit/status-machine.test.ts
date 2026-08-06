import { describe, expect, it } from "vitest";

import type { CheckResult, MonitorState } from "../../src/domain/types";
import { incidentId, maxLevel, transitionMonitor } from "../../src/domain/status-machine";
import { resolveThresholds } from "../../src/domain/thresholds";

const DEFAULT_THRESHOLDS = {
  degradedAfterFailures: 2,
  outageAfterMinutes: 60,
  recoverAfterSuccesses: 2,
};

function successfulResult(checkedAt: number): CheckResult {
  return {
    monitorId: "blog",
    checkedAt,
    success: true,
    httpStatus: 200,
    statusText: "OK",
    responseMs: 42,
    location: "sfo",
    errorCode: null,
  };
}

function failedResult({ checkedAt }: { checkedAt: number }): CheckResult {
  return {
    monitorId: "blog",
    checkedAt,
    success: false,
    httpStatus: null,
    statusText: null,
    responseMs: null,
    location: "sfo",
    errorCode: "timeout",
  };
}

function degradedState({
  firstFailedAt,
  latestAt,
}: {
  firstFailedAt: number;
  latestAt: number;
}): MonitorState {
  return {
    monitorId: "blog",
    level: "degraded",
    consecutiveFailures: 2,
    consecutiveSuccesses: 0,
    firstFailedAt,
    latest: failedResult({ checkedAt: latestAt }),
  };
}

describe("threshold helpers", () => {
  it("fills only omitted monitor threshold overrides", () => {
    expect(resolveThresholds(DEFAULT_THRESHOLDS, { outageAfterMinutes: 3 })).toEqual({
      degradedAfterFailures: 2,
      outageAfterMinutes: 3,
      recoverAfterSuccesses: 2,
    });
  });

  it("keeps explicit one-value threshold overrides", () => {
    expect(
      resolveThresholds(DEFAULT_THRESHOLDS, {
        degradedAfterFailures: 1,
        outageAfterMinutes: 1,
        recoverAfterSuccesses: 1,
      }),
    ).toEqual({
      degradedAfterFailures: 1,
      outageAfterMinutes: 1,
      recoverAfterSuccesses: 1,
    });
  });

  it("creates deterministic incident IDs", () => {
    expect(incidentId("blog", 1_000)).toBe("blog:1000");
  });
});

describe("maxLevel", () => {
  it.each([
    [[], "unknown"],
    [["unknown"], "unknown"],
    [["operational"], "operational"],
    [["degraded"], "degraded"],
    [["outage"], "outage"],
    [["unknown", "operational"], "operational"],
    [["operational", "unknown"], "operational"],
    [["operational", "degraded"], "degraded"],
    [["degraded", "operational"], "degraded"],
    [["operational", "outage"], "outage"],
    [["outage", "operational"], "outage"],
    [["degraded", "outage"], "outage"],
    [["outage", "degraded"], "outage"],
    [["unknown", "degraded", "operational"], "degraded"],
    [["unknown", "operational", "degraded", "outage"], "outage"],
  ] as const)("returns %s for %j", (levels, expected) => {
    expect(maxLevel(levels)).toBe(expected);
  });
});

describe("transitionMonitor", () => {
  it("initializes an operational state from the first successful result", () => {
    const result = successfulResult(1_000);

    expect(transitionMonitor(null, result, DEFAULT_THRESHOLDS)).toEqual({
      next: {
        monitorId: "blog",
        level: "operational",
        consecutiveFailures: 0,
        consecutiveSuccesses: 0,
        firstFailedAt: null,
        latest: result,
      },
      incident: null,
      notification: null,
      dailySeverity: "operational",
      stale: false,
    });
  });

  it("keeps a first default-threshold failure operational", () => {
    const result = failedResult({ checkedAt: 1_000 });

    expect(transitionMonitor(null, result, DEFAULT_THRESHOLDS)).toEqual({
      next: {
        monitorId: "blog",
        level: "operational",
        consecutiveFailures: 1,
        consecutiveSuccesses: 0,
        firstFailedAt: 1_000,
        latest: result,
      },
      incident: null,
      notification: null,
      dailySeverity: "operational",
      stale: false,
    });
  });

  it("opens degraded after the second failure and sends one failure notification", () => {
    const previous = transitionMonitor(
      null,
      failedResult({ checkedAt: 1_000 }),
      DEFAULT_THRESHOLDS,
    ).next;
    const result = failedResult({ checkedAt: 2_000 });

    expect(transitionMonitor(previous, result, DEFAULT_THRESHOLDS)).toMatchObject({
      next: {
        level: "degraded",
        consecutiveFailures: 2,
        consecutiveSuccesses: 0,
        firstFailedAt: 1_000,
        latest: result,
      },
      incident: {
        type: "open",
        incidentId: "blog:1000",
        firstFailedAt: 1_000,
        degradedAt: 2_000,
      },
      notification: { type: "failure", monitorId: "blog", at: 2_000 },
      dailySeverity: "degraded",
      stale: false,
    });
  });

  it("remains degraded at 59:59 elapsed", () => {
    const transition = transitionMonitor(
      degradedState({ firstFailedAt: 1_000, latestAt: 3_500_000 }),
      failedResult({ checkedAt: 3_600_999 }),
      DEFAULT_THRESHOLDS,
    );

    expect(transition).toMatchObject({
      next: { level: "degraded", consecutiveFailures: 3, firstFailedAt: 1_000 },
      incident: null,
      notification: null,
      dailySeverity: "degraded",
    });
  });

  it("escalates by elapsed minutes and does not notify red", () => {
    const previous = degradedState({ firstFailedAt: 1_000, latestAt: 3_500_000 });
    const result = failedResult({ checkedAt: 3_601_000 });
    const transition = transitionMonitor(previous, result, DEFAULT_THRESHOLDS);

    expect(transition.next.level).toBe("outage");
    expect(transition.incident).toEqual({
      type: "escalate",
      incidentId: "blog:1000",
      outageAt: 3_601_000,
    });
    expect(transition.notification).toBeNull();
  });

  it.each([
    ["one-minute", 1, 61_000, 60_000],
    ["three-minute", 3, 181_000, 180_000],
  ])(
    "escalates at the exact non-default %s outage boundary",
    (_name, outageAfterMinutes, checkedAt, latestAt) => {
      const previous = degradedState({ firstFailedAt: 1_000, latestAt });
      const transition = transitionMonitor(previous, failedResult({ checkedAt }), {
        degradedAfterFailures: 2,
        outageAfterMinutes,
        recoverAfterSuccesses: 2,
      });

      expect(transition).toMatchObject({
        next: { level: "outage", firstFailedAt: 1_000 },
        incident: { type: "escalate", incidentId: "blog:1000", outageAt: checkedAt },
        notification: null,
      });
    },
  );

  it("keeps a continued outage open without another mutation or notification", () => {
    const previous: MonitorState = {
      ...degradedState({ firstFailedAt: 1_000, latestAt: 3_601_000 }),
      level: "outage",
      consecutiveFailures: 3,
    };

    expect(
      transitionMonitor(previous, failedResult({ checkedAt: 3_602_000 }), DEFAULT_THRESHOLDS),
    ).toMatchObject({
      next: {
        level: "outage",
        consecutiveFailures: 4,
        consecutiveSuccesses: 0,
        firstFailedAt: 1_000,
      },
      incident: null,
      notification: null,
      dailySeverity: "outage",
    });
  });

  it("keeps the incident level on the first recovery success", () => {
    const previous: MonitorState = {
      ...degradedState({ firstFailedAt: 1_000, latestAt: 3_601_000 }),
      level: "outage",
    };

    expect(
      transitionMonitor(previous, successfulResult(3_602_000), DEFAULT_THRESHOLDS),
    ).toMatchObject({
      next: {
        level: "outage",
        consecutiveFailures: 0,
        consecutiveSuccesses: 1,
        firstFailedAt: 1_000,
      },
      incident: null,
      notification: null,
      dailySeverity: "outage",
    });
  });

  it("resets partial recovery successes when another failure arrives", () => {
    const previous: MonitorState = {
      ...degradedState({ firstFailedAt: 1_000, latestAt: 3_602_000 }),
      level: "outage",
      consecutiveFailures: 0,
      consecutiveSuccesses: 1,
      latest: successfulResult(3_602_000),
    };

    expect(
      transitionMonitor(previous, failedResult({ checkedAt: 3_603_000 }), DEFAULT_THRESHOLDS),
    ).toMatchObject({
      next: {
        level: "outage",
        consecutiveFailures: 1,
        consecutiveSuccesses: 0,
        firstFailedAt: 1_000,
      },
      incident: null,
      notification: null,
    });
  });

  it("closes after the second recovery success and sends one recovery notification", () => {
    const previous: MonitorState = {
      ...degradedState({ firstFailedAt: 1_000, latestAt: 3_602_000 }),
      level: "outage",
      consecutiveFailures: 0,
      consecutiveSuccesses: 1,
      latest: successfulResult(3_602_000),
    };
    const result = successfulResult(3_603_000);

    expect(transitionMonitor(previous, result, DEFAULT_THRESHOLDS)).toEqual({
      next: {
        monitorId: "blog",
        level: "operational",
        consecutiveFailures: 0,
        consecutiveSuccesses: 0,
        firstFailedAt: null,
        latest: result,
      },
      incident: { type: "recover", incidentId: "blog:1000", recoveredAt: 3_603_000 },
      notification: { type: "recovery", monitorId: "blog", at: 3_603_000 },
      dailySeverity: "operational",
      stale: false,
    });
  });

  it("opens on the first failure when the degraded threshold is one", () => {
    expect(
      transitionMonitor(null, failedResult({ checkedAt: 1_000 }), {
        degradedAfterFailures: 1,
        outageAfterMinutes: 60,
        recoverAfterSuccesses: 2,
      }),
    ).toMatchObject({
      next: { level: "degraded", consecutiveFailures: 1, firstFailedAt: 1_000 },
      incident: { type: "open", incidentId: "blog:1000", firstFailedAt: 1_000, degradedAt: 1_000 },
      notification: { type: "failure", monitorId: "blog", at: 1_000 },
    });
  });

  it("uses threshold overrides of one failure and three recovery successes", () => {
    const thresholds = {
      degradedAfterFailures: 1,
      outageAfterMinutes: 60,
      recoverAfterSuccesses: 3,
    };
    const degraded = transitionMonitor(null, failedResult({ checkedAt: 1_000 }), thresholds).next;
    const onceRecovered = transitionMonitor(degraded, successfulResult(2_000), thresholds).next;
    const twiceRecovered = transitionMonitor(
      onceRecovered,
      successfulResult(3_000),
      thresholds,
    ).next;

    expect(transitionMonitor(twiceRecovered, successfulResult(4_000), thresholds)).toMatchObject({
      next: {
        level: "operational",
        consecutiveFailures: 0,
        consecutiveSuccesses: 0,
        firstFailedAt: null,
      },
      incident: { type: "recover", incidentId: "blog:1000", recoveredAt: 4_000 },
      notification: { type: "recovery", monitorId: "blog", at: 4_000 },
    });
  });

  it.each([1, 5, 10])(
    "reaches outage after one elapsed hour on a %i-minute schedule",
    (minutes) => {
      const previous = degradedState({ firstFailedAt: 0, latestAt: 3_600_000 - minutes * 60_000 });
      const transition = transitionMonitor(
        previous,
        failedResult({ checkedAt: 3_600_000 }),
        DEFAULT_THRESHOLDS,
      );

      expect(transition).toMatchObject({
        next: { level: "outage" },
        incident: { type: "escalate", incidentId: "blog:0", outageAt: 3_600_000 },
        notification: null,
      });
    },
  );

  it.each([
    [999, "stale"],
    [1_000, "equal"],
  ])("preserves the exact prior state for a %s timestamp", (checkedAt) => {
    const previous = transitionMonitor(
      null,
      failedResult({ checkedAt: 1_000 }),
      DEFAULT_THRESHOLDS,
    ).next;
    const transition = transitionMonitor(previous, successfulResult(checkedAt), DEFAULT_THRESHOLDS);

    expect(transition).toEqual({
      next: previous,
      incident: null,
      notification: null,
      dailySeverity: "operational",
      stale: true,
    });
    expect(transition.next).toBe(previous);
  });
});
