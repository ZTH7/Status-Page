import type { PublicLabels } from "../../config/types";
import type { PublicLevel } from "../../shared/api-types";
import { formatTimestamp } from "../lib/format";

interface OverallStatusProps {
  level: PublicLevel;
  latestCompletedAt: number | null;
  labels: PublicLabels;
}

function overallText(level: PublicLevel, labels: PublicLabels): string {
  switch (level) {
    case "operational":
      return labels.allOperational;
    case "degraded":
      return labels.someDegraded;
    case "outage":
      return labels.someOutage;
    case "unknown":
      return labels.statusUnknown;
  }
}

function StatusMark({ level }: { level: PublicLevel }) {
  return (
    <span className="overall-status__mark" data-level={level} aria-hidden="true">
      <svg viewBox="0 0 24 24" width="24" height="24">
        {level === "operational" ? <path d="m6.5 12.5 3.4 3.4 7.6-8" /> : null}
        {level === "degraded" ? <path d="M12 6.5v6M12 17.5h.01" /> : null}
        {level === "outage" ? <path d="m8 8 8 8M16 8l-8 8" /> : null}
        {level === "unknown" ? (
          <path d="M9.7 9a2.5 2.5 0 1 1 3.2 2.4c-.9.3-.9 1.1-.9 1.8M12 17.5h.01" />
        ) : null}
      </svg>
    </span>
  );
}

export function OverallStatus({ level, latestCompletedAt, labels }: OverallStatusProps) {
  const statusText = overallText(level, labels);
  const headingId = "overall-status-heading";

  return (
    <section className="overall-status" aria-labelledby={headingId} data-level={level}>
      <div className="overall-status__summary">
        <StatusMark level={level} />
        <h2 id={headingId}>{statusText}</h2>
      </div>
      {latestCompletedAt !== null ? (
        <div className="overall-status__updated">
          <span>{labels.lastChecked}</span>
          <time dateTime={new Date(latestCompletedAt).toISOString()}>
            {formatTimestamp(latestCompletedAt)}
          </time>
        </div>
      ) : null}
    </section>
  );
}
