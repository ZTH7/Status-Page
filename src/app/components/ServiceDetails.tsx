import { useId, useState } from "react";

import type { PublicLabels } from "../../config/types";
import type { PublicMonitor } from "../../shared/api-types";
import { formatMilliseconds, formatTimestamp } from "../lib/format";

interface ServiceDetailsProps {
  name: string;
  latest: PublicMonitor["latest"];
  labels: PublicLabels;
}

type DisclosureState = "closed" | "transient" | "pinned";

export function ServiceDetails({ name, latest, labels }: ServiceDetailsProps) {
  const [state, setState] = useState<DisclosureState>("closed");
  const detailId = `service-details-${useId().replaceAll(":", "")}`;
  const open = state !== "closed";

  return (
    <div
      className="service-details"
      data-open={open}
      onMouseEnter={() => setState((current) => (current === "closed" ? "transient" : current))}
      onMouseLeave={(event) => {
        if (state === "transient" && !event.currentTarget.contains(document.activeElement)) {
          setState("closed");
        }
      }}
      onBlur={(event) => {
        const nextTarget = event.relatedTarget;
        if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
          setState("closed");
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          setState("closed");
        }
      }}
    >
      <button
        type="button"
        className="service-details__trigger"
        aria-label={`Details for ${name}`}
        aria-expanded={open}
        aria-controls={detailId}
        onFocus={() => setState((current) => (current === "closed" ? "transient" : current))}
        onClick={() => setState((current) => (current === "pinned" ? "closed" : "pinned"))}
      >
        <span aria-hidden="true">?</span>
      </button>

      {open ? (
        <dl id={detailId} className="service-card__metadata" aria-label={`${name} details`}>
          <div>
            <dt>{labels.responseTime}</dt>
            <dd>
              {latest?.responseMs === null || !latest
                ? labels.noData
                : formatMilliseconds(latest.responseMs)}
            </dd>
          </div>
          <div>
            <dt>HTTP status</dt>
            <dd>{latest?.httpStatus ?? labels.noData}</dd>
          </div>
          <div>
            <dt>{labels.lastChecked}</dt>
            <dd>
              {latest ? (
                <time dateTime={new Date(latest.checkedAt).toISOString()}>
                  {formatTimestamp(latest.checkedAt)}
                </time>
              ) : (
                labels.noData
              )}
            </dd>
          </div>
          <div>
            <dt>{labels.location}</dt>
            <dd>{latest?.location || labels.noData}</dd>
          </div>
        </dl>
      ) : null}
    </div>
  );
}
