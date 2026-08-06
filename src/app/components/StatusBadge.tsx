import type { PublicLabels } from "../../config/types";
import type { PublicLevel } from "../../shared/api-types";

interface StatusBadgeProps {
  level: PublicLevel;
  labels: PublicLabels;
}

export function levelText(level: PublicLevel, labels: PublicLabels): string {
  switch (level) {
    case "operational":
      return labels.operational;
    case "degraded":
      return labels.degraded;
    case "outage":
      return labels.outage;
    case "unknown":
      return labels.statusUnknown;
  }
}

export function StatusBadge({ level, labels }: StatusBadgeProps) {
  return (
    <span className="status-badge" data-level={level}>
      <span className="status-dot" aria-hidden="true" />
      <span>{levelText(level, labels)}</span>
    </span>
  );
}
