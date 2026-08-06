import type { PublicLabels } from "../../config/types";
import type { PublicIncident } from "../../shared/api-types";
import { formatTimestamp } from "../lib/format";
import { StatusBadge } from "./StatusBadge";

interface IncidentListProps {
  incidents: PublicIncident[];
  labels: PublicLabels;
}

function formatDuration(durationMs: number): string {
  let remaining = Math.max(0, Math.floor(durationMs / 1000));
  const days = Math.floor(remaining / 86_400);
  remaining %= 86_400;
  const hours = Math.floor(remaining / 3_600);
  remaining %= 3_600;
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  const parts: string[] = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  if (seconds || parts.length === 0) parts.push(`${seconds}s`);
  return parts.join(" ");
}

function IncidentTime({ label, timestamp }: { label: string; timestamp: number }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        <time dateTime={new Date(timestamp).toISOString()}>{formatTimestamp(timestamp)}</time>
      </dd>
    </div>
  );
}

export function IncidentList({ incidents, labels }: IncidentListProps) {
  const headingId = "recent-incidents-heading";

  return (
    <section className="incidents" aria-labelledby={headingId}>
      <div className="section-heading">
        <h2 id={headingId}>{labels.recentIncidents}</h2>
      </div>
      <ol className="incident-list" aria-label={labels.recentIncidents}>
        {incidents.map((incident) => (
          <li key={incident.id} className="incident-list__item">
            <div className="incident-list__identity">
              <h3>{incident.monitorName}</h3>
              <StatusBadge level={incident.highestSeverity} labels={labels} />
              <span className="incident-list__duration">
                Duration {formatDuration(incident.durationMs)}
              </span>
            </div>
            <dl className="incident-list__timeline">
              <IncidentTime label={labels.startedAt} timestamp={incident.firstFailedAt} />
              {incident.outageAt !== null ? (
                <IncidentTime label={labels.escalatedAt} timestamp={incident.outageAt} />
              ) : null}
              {incident.recoveredAt !== null ? (
                <IncidentTime label={labels.recoveredAt} timestamp={incident.recoveredAt} />
              ) : (
                <div>
                  <dt>State</dt>
                  <dd>{labels.ongoing}</dd>
                </div>
              )}
            </dl>
          </li>
        ))}
      </ol>
      {incidents.length === 0 ? <p className="empty-state">{labels.noIncidents}</p> : null}
    </section>
  );
}
