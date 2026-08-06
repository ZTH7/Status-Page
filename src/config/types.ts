export const THEME_IDS = ["default", "stardew-inspired"] as const;

export type ThemeId = (typeof THEME_IDS)[number];
export type ColorModePreference = "system" | "light" | "dark";
export type HttpMethod = "GET" | "HEAD";

export interface Thresholds {
  degradedAfterFailures: number;
  outageAfterMinutes: number;
  recoverAfterSuccesses: number;
}

export interface MonitorConfig {
  id: string;
  name: string;
  description?: string;
  url: string;
  linkable: boolean;
  method: HttpMethod;
  expectStatus: number;
  followRedirect: boolean;
  presentationLogo?: string;
  timeoutSeconds?: number;
  thresholds?: Partial<Thresholds>;
}

export interface PublicLabels {
  allOperational: string;
  someDegraded: string;
  someOutage: string;
  statusUnknown: string;
  operational: string;
  degraded: string;
  outage: string;
  noData: string;
  searchPlaceholder: string;
  noServices: string;
  noMatches: string;
  recentIncidents: string;
  noIncidents: string;
  lastChecked: string;
  responseTime: string;
  location: string;
  historyStart: string;
  today: string;
  startedAt: string;
  escalatedAt: string;
  recoveredAt: string;
  ongoing: string;
}

export interface SiteConfig {
  title: string;
  url: string;
  logo: string;
  theme: ThemeId;
  colorMode: ColorModePreference;
  historyDays: number;
  requestTimeoutSeconds: number;
  userAgent: string;
  thresholds: Thresholds;
  labels: PublicLabels;
}

export interface AppConfig {
  site: SiteConfig;
  monitors: MonitorConfig[];
}

export interface PublicBuildConfig {
  title: string;
  url: string;
  logo: string;
  theme: ThemeId;
  colorMode: ColorModePreference;
  historyDays: number;
  labels: PublicLabels;
}

export interface ConfigSources {
  siteSource: string;
  monitorsSource: string;
  wranglerConfig: unknown;
  assetExists(relativePath: string): boolean;
}
