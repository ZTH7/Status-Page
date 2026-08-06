import type { PublicLabels } from "../../config/types";
import type { PublicMonitor } from "../../shared/api-types";
import { formatTimestamp } from "../lib/format";
import { HistoryStrip } from "./HistoryStrip";
import { StatusBadge } from "./StatusBadge";

interface ServiceCardProps {
  monitor: PublicMonitor;
  labels: PublicLabels;
}

function firstGrapheme(value: string): string {
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  return Array.from(segmenter.segment(value.trim()), ({ segment }) => segment)[0] ?? "?";
}

export function ServiceCard({ monitor, labels }: ServiceCardProps) {
  const latest = monitor.latest;

  return (
    <article className="service-card" aria-label={monitor.name} data-level={monitor.level}>
      <div className="service-card__identity">
        <div className="service-card__name-row">
          {monitor.presentationLogo ? (
            <img
              className="service-card__logo"
              src={monitor.presentationLogo}
              alt={`${monitor.name} logo`}
              width="40"
              height="40"
            />
          ) : (
            <span
              className="service-card__fallback"
              role="img"
              aria-label={`${monitor.name} fallback mark`}
            >
              {firstGrapheme(monitor.name)}
            </span>
          )}
          <div className="service-card__title-block">
            <h3>{monitor.href ? <a href={monitor.href}>{monitor.name}</a> : monitor.name}</h3>
            <StatusBadge level={monitor.level} labels={labels} />
          </div>
        </div>
        {monitor.description ? <p>{monitor.description}</p> : null}
      </div>

      <dl className="service-card__metadata">
        <div>
          <dt>{labels.responseTime}</dt>
          <dd>
            {latest?.responseMs === null || !latest ? labels.noData : `${latest.responseMs} ms`}
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

      <HistoryStrip days={monitor.history} labels={labels} />
    </article>
  );
}
