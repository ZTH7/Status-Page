import type { PublicLabels } from "../../config/types";
import type { PublicMonitor } from "../../shared/api-types";
import { HistoryStrip } from "./HistoryStrip";
import { ServiceDetails } from "./ServiceDetails";
import { ServiceIcon } from "./ServiceIcon";
import { StatusBadge } from "./StatusBadge";

interface ServiceCardProps {
  monitor: PublicMonitor;
  labels: PublicLabels;
}

export function ServiceCard({ monitor, labels }: ServiceCardProps) {
  return (
    <article className="service-card" aria-label={monitor.name} data-level={monitor.level}>
      <div className="service-card__identity">
        <ServiceIcon
          name={monitor.name}
          href={monitor.href}
          presentationLogo={monitor.presentationLogo}
        />
        <div className="service-card__title-block">
          <div className="service-card__headline">
            <h3>{monitor.href ? <a href={monitor.href}>{monitor.name}</a> : monitor.name}</h3>
            <ServiceDetails name={monitor.name} latest={monitor.latest} labels={labels} />
            <StatusBadge level={monitor.level} labels={labels} />
          </div>
          {monitor.description ? <p>{monitor.description}</p> : null}
        </div>
      </div>
      <HistoryStrip days={monitor.history} labels={labels} />
    </article>
  );
}
