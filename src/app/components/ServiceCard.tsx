import type { PublicLabels } from "../../config/types";
import type { PublicMonitor } from "../../shared/api-types";
import { HistoryStrip } from "./HistoryStrip";
import { ServiceDetails } from "./ServiceDetails";
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
  return (
    <article className="service-card" aria-label={monitor.name} data-level={monitor.level}>
      <div className="service-card__identity">
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
          <div className="service-card__headline">
            <h3>{monitor.href ? <a href={monitor.href}>{monitor.name}</a> : monitor.name}</h3>
            <StatusBadge level={monitor.level} labels={labels} />
            <ServiceDetails name={monitor.name} latest={monitor.latest} labels={labels} />
          </div>
          {monitor.description ? <p>{monitor.description}</p> : null}
        </div>
      </div>
      <HistoryStrip days={monitor.history} labels={labels} />
    </article>
  );
}
