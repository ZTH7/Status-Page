import type { PublicLabels } from "../config/types";
import type { StatusLevel } from "../domain/types";

export type PublicLevel = StatusLevel | "unknown";

export interface PublicDay {
  day: string;
  level: PublicLevel;
  checks: number;
  failures: number;
  locations: Array<{ code: string; averageMs: number | null; checks: number }>;
}

export interface PublicMonitor {
  id: string;
  name: string;
  description?: string;
  href?: string;
  presentationLogo?: string;
  level: PublicLevel;
  latest: null | {
    checkedAt: number;
    httpStatus: number | null;
    responseMs: number | null;
    location: string;
  };
  history: PublicDay[];
}

export interface PublicSiteConfig {
  title: string;
  url: string;
  logo: string;
  theme: "default" | "stardew-inspired";
  colorMode: "system" | "light" | "dark";
  historyDays: number;
  labels: PublicLabels;
}

export interface PublicIncident {
  id: string;
  monitorId: string;
  monitorName: string;
  firstFailedAt: number;
  degradedAt: number;
  outageAt: number | null;
  recoveredAt: number | null;
  durationMs: number;
  highestSeverity: "degraded" | "outage";
}

export interface StatusResponse {
  generatedAt: number;
  latestCompletedAt: number | null;
  overall: PublicLevel;
  site: PublicSiteConfig;
  monitors: PublicMonitor[];
  incidents: PublicIncident[];
}

export interface ApiErrorResponse {
  error: {
    code: "method_not_allowed" | "status_unavailable";
    message: string;
  };
}
