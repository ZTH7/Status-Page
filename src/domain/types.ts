export type StatusLevel = "operational" | "degraded" | "outage";
export type ErrorCode = "timeout" | "dns" | "tls" | "network" | "unexpected";

export interface CheckResult {
  monitorId: string;
  checkedAt: number;
  success: boolean;
  httpStatus: number | null;
  statusText: string | null;
  responseMs: number | null;
  location: string;
  errorCode: ErrorCode | null;
  diagnostic?: string;
}

export interface MonitorState {
  monitorId: string;
  level: StatusLevel;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  firstFailedAt: number | null;
  latest: CheckResult;
}

export type IncidentMutation =
  | { type: "open"; incidentId: string; firstFailedAt: number; degradedAt: number }
  | { type: "escalate"; incidentId: string; outageAt: number }
  | { type: "recover"; incidentId: string; recoveredAt: number };

export type NotificationAction =
  | { type: "failure"; monitorId: string; at: number }
  | { type: "recovery"; monitorId: string; at: number };

export interface MonitorTransition {
  next: MonitorState;
  incident: IncidentMutation | null;
  notification: NotificationAction | null;
  dailySeverity: StatusLevel;
  stale: boolean;
}
