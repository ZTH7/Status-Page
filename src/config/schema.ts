import { parse as parseYaml } from "yaml";
import { z } from "zod";

import type {
  AppConfig,
  ConfigSources,
  HttpMethod,
  MonitorConfig,
  PublicLabels,
  SiteConfig,
  Thresholds,
  ThemeId,
} from "./types";

export const DEFAULT_THRESHOLDS: Thresholds = {
  degradedAfterFailures: 2,
  outageAfterMinutes: 60,
  recoverAfterSuccesses: 2,
};

export const DEFAULTS = {
  historyDays: 90,
  rawRetentionDays: 90,
  requestTimeoutSeconds: 10,
  colorMode: "system" as const,
};

const monitorCrons = ["* * * * *", "*/5 * * * *", "*/10 * * * *"] as const;
const retentionCron = "17 3 * * *";
const idPattern = /^[a-z0-9][a-z0-9-]{0,63}$/;

const positiveInteger = z.number().int().positive();

const thresholdsSchema = z.object({
  degradedAfterFailures: positiveInteger,
  outageAfterMinutes: positiveInteger,
  recoverAfterSuccesses: positiveInteger,
});

const labelsSchema = z.object({
  allOperational: z.string(),
  someDegraded: z.string(),
  someOutage: z.string(),
  statusUnknown: z.string(),
  operational: z.string(),
  degraded: z.string(),
  outage: z.string(),
  noData: z.string(),
  searchPlaceholder: z.string(),
  noServices: z.string(),
  noMatches: z.string(),
  recentIncidents: z.string(),
  noIncidents: z.string(),
  lastChecked: z.string(),
  responseTime: z.string(),
  location: z.string(),
  historyStart: z.string(),
  today: z.string(),
  startedAt: z.string(),
  escalatedAt: z.string(),
  recoveredAt: z.string(),
  ongoing: z.string(),
});

const siteSchema = z.object({
  title: z.string().min(1),
  url: z.string().min(1),
  logo: z.string().min(1),
  theme: z.enum(["default", "stardew-inspired"]),
  colorMode: z.enum(["system", "light", "dark"]).default(DEFAULTS.colorMode),
  historyDays: z.number().int().min(1).max(365).default(DEFAULTS.historyDays),
  rawRetentionDays: z.number().int().min(1).max(365).default(DEFAULTS.rawRetentionDays),
  requestTimeoutSeconds: z.number().int().min(1).max(60).default(DEFAULTS.requestTimeoutSeconds),
  thresholds: thresholdsSchema.partial().default({}),
  labels: labelsSchema,
});

const monitorSchema = z.object({
  id: z.string().regex(idPattern),
  name: z.string().min(1),
  description: z.string().optional(),
  url: z.string().min(1),
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

function validateCrons(wranglerConfig: unknown): void {
  const { triggers } = wranglerSchema.parse(wranglerConfig);
  const { crons } = triggers;

  if (crons.length !== 2 || !monitorCrons.includes(crons[0] as (typeof monitorCrons)[number])) {
    throw new Error("Wrangler must configure one supported monitor Cron followed by retention Cron");
  }

  if (crons[1] !== retentionCron) {
    throw new Error(`Wrangler must configure retention Cron ${retentionCron}`);
  }
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

  if (rawSite.rawRetentionDays < rawSite.historyDays) {
    throw new Error("rawRetentionDays must be greater than or equal to historyDays");
  }

  validateAsset(rawSite.logo, input.assetExists);
  validateLabelTokens(rawSite.labels as PublicLabels);
  validateCrons(input.wranglerConfig);

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
  }

  const site: SiteConfig = {
    ...rawSite,
    theme: rawSite.theme as ThemeId,
    thresholds: {
      degradedAfterFailures:
        rawSite.thresholds.degradedAfterFailures ?? DEFAULT_THRESHOLDS.degradedAfterFailures,
      outageAfterMinutes: rawSite.thresholds.outageAfterMinutes ?? DEFAULT_THRESHOLDS.outageAfterMinutes,
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
      ...(monitor.presentationLogo === undefined ? {} : { presentationLogo: monitor.presentationLogo }),
      ...(monitor.timeoutSeconds === undefined ? {} : { timeoutSeconds: monitor.timeoutSeconds }),
      ...(thresholds === undefined ? {} : { thresholds }),
    };
  });

  return { site, monitors };
}
