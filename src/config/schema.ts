import { parse as parseYaml } from "yaml";
import { z } from "zod";

import {
  THEME_IDS,
  type AppConfig,
  type ConfigSources,
  type HttpMethod,
  type MonitorConfig,
  type PublicLabels,
  type SiteConfig,
  type Thresholds,
  type ThemeId,
} from "./types";

export const DEFAULT_THRESHOLDS: Thresholds = {
  degradedAfterFailures: 2,
  outageAfterMinutes: 60,
  recoverAfterSuccesses: 2,
};

export const DEFAULTS = {
  historyDays: 90,
  requestTimeoutSeconds: 10,
  userAgent: "StatusPage/2",
  colorMode: "system" as const,
};

const monitorCrons = ["* * * * *", "*/5 * * * *", "*/10 * * * *"] as const;
const monitorCronSeconds: Record<(typeof monitorCrons)[number], number> = {
  "* * * * *": 60,
  "*/5 * * * *": 300,
  "*/10 * * * *": 600,
};
const idPattern = /^[a-z0-9][a-z0-9-]{0,63}$/;

const positiveInteger = z.number().int().positive();

const thresholdsSchema = z.object({
  degradedAfterFailures: positiveInteger,
  outageAfterMinutes: positiveInteger,
  recoverAfterSuccesses: positiveInteger,
});

const labelsSchema = z.object({
  allOperational: z.string().max(128),
  someDegraded: z.string().max(128),
  someOutage: z.string().max(128),
  statusUnknown: z.string().max(128),
  operational: z.string().max(128),
  degraded: z.string().max(128),
  outage: z.string().max(128),
  noData: z.string().max(128),
  searchPlaceholder: z.string().max(128),
  noServices: z.string().max(128),
  noMatches: z.string().max(128),
  recentIncidents: z.string().max(128),
  noIncidents: z.string().max(128),
  lastChecked: z.string().max(128),
  responseTime: z.string().max(128),
  location: z.string().max(128),
  historyStart: z.string().max(128),
  today: z.string().max(128),
  startedAt: z.string().max(128),
  escalatedAt: z.string().max(128),
  recoveredAt: z.string().max(128),
  ongoing: z.string().max(128),
});

const siteSchema = z.object({
  title: z.string().min(1).max(128),
  url: z.string().min(1).max(1_000),
  logo: z.string().min(1),
  theme: z.enum(THEME_IDS),
  colorMode: z.enum(["system", "light", "dark"]).default(DEFAULTS.colorMode),
  historyDays: z.number().int().min(1).max(365).default(DEFAULTS.historyDays),
  requestTimeoutSeconds: z.number().int().min(1).max(60).default(DEFAULTS.requestTimeoutSeconds),
  userAgent: z
    .string()
    .min(1)
    .max(256)
    .refine((value) => !/[\r\n]/.test(value), "userAgent cannot contain line breaks")
    .default(DEFAULTS.userAgent),
  thresholds: thresholdsSchema.partial().default({}),
  labels: labelsSchema,
});

const monitorSchema = z.object({
  id: z.string().regex(idPattern),
  name: z.string().min(1).max(128),
  description: z.string().max(500).optional(),
  url: z.string().min(1).max(1_000),
  linkable: z.boolean(),
  method: z.enum(["GET", "HEAD"]),
  expectStatus: z.number().int().min(100).max(599),
  followRedirect: z.boolean(),
  presentationLogo: z.string().min(1).optional(),
  timeoutSeconds: z.number().int().min(1).max(60).optional(),
  thresholds: thresholdsSchema.partial().optional(),
});

const monitorsSourceSchema = z.object({
  monitors: z.array(monitorSchema).max(25),
});

const wranglerSchema = z.object({
  triggers: z.object({
    crons: z.array(z.string()),
  }),
});

function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

function publicAssetRelativePath(path: string): string {
  if (!path.startsWith("/") || path.includes("\\") || path.split("/").includes("..")) {
    throw new Error(`Configured asset path must be an absolute public path: ${path}`);
  }

  const relativePath = path.slice(1);
  if (!relativePath || relativePath.startsWith("/")) {
    throw new Error(`Configured asset path must be an absolute public path: ${path}`);
  }

  return relativePath;
}

function validateAsset(path: string, assetExists: ConfigSources["assetExists"]): void {
  const relativePath = publicAssetRelativePath(path);
  if (!assetExists(relativePath)) {
    throw new Error(`Configured asset does not exist: ${path}`);
  }
}

function validateLabelTokens(labels: PublicLabels): void {
  for (const value of Object.values(labels)) {
    const withoutDaysToken = value.replaceAll("{days}", "");
    if (withoutDaysToken.includes("{") || withoutDaysToken.includes("}")) {
      throw new Error(`Unsupported label token in: ${value}`);
    }
  }
}

function monitorIntervalSeconds(wranglerConfig: unknown): number {
  const { triggers } = wranglerSchema.parse(wranglerConfig);
  const { crons } = triggers;

  if (crons.length !== 1 || !monitorCrons.includes(crons[0] as (typeof monitorCrons)[number])) {
    throw new Error("Wrangler must configure exactly one supported monitor Cron");
  }

  return monitorCronSeconds[crons[0] as (typeof monitorCrons)[number]];
}

function normalizeMonitorThresholds(
  thresholds:
    | {
        degradedAfterFailures?: number | undefined;
        outageAfterMinutes?: number | undefined;
        recoverAfterSuccesses?: number | undefined;
      }
    | undefined,
): Partial<Thresholds> | undefined {
  if (!thresholds) {
    return undefined;
  }

  const normalized: Partial<Thresholds> = {};
  if (thresholds.degradedAfterFailures !== undefined) {
    normalized.degradedAfterFailures = thresholds.degradedAfterFailures;
  }
  if (thresholds.outageAfterMinutes !== undefined) {
    normalized.outageAfterMinutes = thresholds.outageAfterMinutes;
  }
  if (thresholds.recoverAfterSuccesses !== undefined) {
    normalized.recoverAfterSuccesses = thresholds.recoverAfterSuccesses;
  }
  return normalized;
}

export function parseConfigSources(input: ConfigSources): AppConfig {
  const rawSite = siteSchema.parse(parseYaml(input.siteSource));
  const rawMonitors = monitorsSourceSchema.parse(parseYaml(input.monitorsSource)).monitors;

  if (!isHttpUrl(rawSite.url)) {
    throw new Error(`Site URL must use HTTP(S): ${rawSite.url}`);
  }

  validateAsset(rawSite.logo, input.assetExists);
  validateLabelTokens(rawSite.labels as PublicLabels);
  const intervalSeconds = monitorIntervalSeconds(input.wranglerConfig);

  if (rawSite.requestTimeoutSeconds >= intervalSeconds) {
    throw new Error("requestTimeoutSeconds must be shorter than the monitor Cron interval");
  }

  const ids = new Set<string>();
  for (const monitor of rawMonitors) {
    if (!isHttpUrl(monitor.url)) {
      throw new Error(`Monitor URL must use HTTP(S): ${monitor.url}`);
    }
    if (ids.has(monitor.id)) {
      throw new Error(`Duplicate monitor ID: ${monitor.id}`);
    }
    ids.add(monitor.id);
    if (monitor.presentationLogo) {
      validateAsset(monitor.presentationLogo, input.assetExists);
    }
    if ((monitor.timeoutSeconds ?? rawSite.requestTimeoutSeconds) >= intervalSeconds) {
      throw new Error(`Monitor timeout must be shorter than the Cron interval: ${monitor.id}`);
    }
  }

  const site: SiteConfig = {
    ...rawSite,
    theme: rawSite.theme as ThemeId,
    thresholds: {
      degradedAfterFailures:
        rawSite.thresholds.degradedAfterFailures ?? DEFAULT_THRESHOLDS.degradedAfterFailures,
      outageAfterMinutes:
        rawSite.thresholds.outageAfterMinutes ?? DEFAULT_THRESHOLDS.outageAfterMinutes,
      recoverAfterSuccesses:
        rawSite.thresholds.recoverAfterSuccesses ?? DEFAULT_THRESHOLDS.recoverAfterSuccesses,
    },
    labels: rawSite.labels as PublicLabels,
  };
  const monitors: MonitorConfig[] = rawMonitors.map((monitor) => {
    const thresholds = normalizeMonitorThresholds(monitor.thresholds);
    return {
      id: monitor.id,
      name: monitor.name,
      url: monitor.url,
      linkable: monitor.linkable,
      method: monitor.method as HttpMethod,
      expectStatus: monitor.expectStatus,
      followRedirect: monitor.followRedirect,
      ...(monitor.description === undefined ? {} : { description: monitor.description }),
      ...(monitor.presentationLogo === undefined
        ? {}
        : { presentationLogo: monitor.presentationLogo }),
      ...(monitor.timeoutSeconds === undefined ? {} : { timeoutSeconds: monitor.timeoutSeconds }),
      ...(thresholds === undefined ? {} : { thresholds }),
    };
  });

  return { site, monitors };
}
