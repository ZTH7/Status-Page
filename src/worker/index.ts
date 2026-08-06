import type { AppConfig } from "../config/types";
import { appConfig } from "../generated/config";
import type { Env } from "./env";
import { handleStatusRequest } from "./api/status";
import { resolveLocation } from "./monitoring/location";
import { probeMonitor } from "./monitoring/probe";
import {
  logStructuredRecord,
  runChecks,
  runRetention,
  type RunSummary,
  type SafeStructuredRecord,
} from "./monitoring/runner";
import {
  dispatchNotifications,
  type DispatchNotificationsInput,
  type NotificationDispatchResult,
} from "./notifications";
import {
  loadMonitorStates,
  persistCheckBatch,
} from "./storage/repository";

const RETENTION_CRON = "17 3 * * *";
const DAY_MS = 86_400_000;

export interface ScheduledDependencies {
  config: AppConfig;
  runMonitoring(
    scheduledAt: number,
    config: AppConfig,
    db: D1Database,
  ): Promise<RunSummary>;
  runRetention(db: D1Database, cutoffMs: number): Promise<number>;
  dispatchNotifications(input: DispatchNotificationsInput): Promise<NotificationDispatchResult[]>;
  fetch: typeof fetch;
  log(record: SafeStructuredRecord): void;
}

export function createScheduledHandler(dependencies: ScheduledDependencies) {
  return async (
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> => {
    if (controller.cron === RETENTION_CRON) {
      const cutoff = controller.scheduledTime
        - dependencies.config.site.rawRetentionDays * DAY_MS;
      await dependencies.runRetention(env.DB, cutoff);
      return;
    }

    const summary = await dependencies.runMonitoring(
      controller.scheduledTime,
      dependencies.config,
      env.DB,
    );
    if (summary.duplicate) return;

    const notificationPromise = dependencies.dispatchNotifications({
      actions: summary.notifications,
      monitors: dependencies.config.monitors,
      site: dependencies.config.site,
      env,
      fetch: dependencies.fetch,
    }).then((results) => {
      for (const result of results) {
        dependencies.log({
          event: "notification-channel",
          channel: result.channel,
          status: result.status,
          ...(result.reason === undefined ? {} : { reason: safeReason(result.reason) }),
        });
      }
    });
    ctx.waitUntil(notificationPromise);
  };
}

function safeReason(reason: string): "no-actions" | "not-configured" | "send-failed" {
  if (reason === "no-actions" || reason === "not-configured") return reason;
  return "send-failed";
}

const scheduled = createScheduledHandler({
  config: appConfig,
  runMonitoring: (scheduledAt, config, db) => runChecks({
    scheduledAt,
    config,
    db,
    dependencies: {
      loadMonitorStates,
      resolveLocation: () => resolveLocation(fetch),
      probeMonitor: (monitor, checkedAt, location) => probeMonitor(
        monitor,
        checkedAt,
        location,
        {
          fetch,
          now: Date.now,
          setTimer: setTimeout,
          clearTimer: clearTimeout,
        },
      ),
      persistCheckBatch,
      log: logStructuredRecord,
    },
  }),
  runRetention,
  dispatchNotifications,
  fetch,
  log: logStructuredRecord,
});

export default {
  fetch(request, env) {
    if (new URL(request.url).pathname === "/api/status") {
      return handleStatusRequest(request, {
        config: appConfig,
        db: env.DB,
        now: Date.now,
      });
    }

    return new Response(null, { status: 404 });
  },
  async scheduled(controller, env, ctx) {
    await scheduled(controller, env, ctx);
  },
} satisfies ExportedHandler<Env>;
