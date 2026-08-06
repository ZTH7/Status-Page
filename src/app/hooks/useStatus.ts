import { useEffect, useState } from "react";

import type { ApiErrorResponse, StatusResponse } from "../../shared/api-types";

export type StatusLoadState =
  | { kind: "loading" }
  | { kind: "ready"; data: StatusResponse }
  | { kind: "unavailable"; message: string };

const unavailableMessage = "Status data is temporarily unavailable.";
const publicLevels = new Set(["operational", "degraded", "outage", "unknown"]);
const apiErrorCodes = new Set(["method_not_allowed", "status_unavailable"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isStatusResponse(value: unknown): value is StatusResponse {
  return (
    isRecord(value) &&
    typeof value.generatedAt === "number" &&
    Number.isFinite(value.generatedAt) &&
    typeof value.overall === "string" &&
    publicLevels.has(value.overall) &&
    isRecord(value.site) &&
    Array.isArray(value.monitors) &&
    Array.isArray(value.incidents)
  );
}

function isApiErrorResponse(value: unknown): value is ApiErrorResponse {
  return (
    isRecord(value) &&
    isRecord(value.error) &&
    typeof value.error.code === "string" &&
    apiErrorCodes.has(value.error.code) &&
    typeof value.error.message === "string"
  );
}

export function useStatus(fetcher: typeof fetch = fetch): StatusLoadState {
  const [state, setState] = useState<StatusLoadState>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    let mounted = true;
    setState({ kind: "loading" });

    async function loadStatus(): Promise<void> {
      try {
        const response = await fetcher("/api/status", { signal: controller.signal });
        const body: unknown = await response.json();

        if (!response.ok) {
          const message = isApiErrorResponse(body) ? body.error.message : unavailableMessage;
          if (mounted) setState({ kind: "unavailable", message });
          return;
        }

        if (!isStatusResponse(body)) {
          throw new Error("Invalid status response");
        }

        if (mounted) setState({ kind: "ready", data: body });
      } catch {
        if (mounted && !controller.signal.aborted) {
          setState({ kind: "unavailable", message: unavailableMessage });
        }
      }
    }

    void loadStatus();

    return () => {
      mounted = false;
      controller.abort();
    };
  }, [fetcher]);

  return state;
}
