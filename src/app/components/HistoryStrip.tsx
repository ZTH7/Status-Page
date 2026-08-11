import { useId, useState } from "react";

import type { PublicLabels } from "../../config/types";
import type { PublicDay, PublicLevel } from "../../shared/api-types";
import { formatMilliseconds } from "../lib/format";

interface HistoryStripProps {
  days: PublicDay[];
  labels: PublicLabels;
}

type SelectionSource = "focus" | "hover" | "activate";

function historyLevelText(level: PublicLevel, labels: PublicLabels): string {
  switch (level) {
    case "operational":
      return labels.operational;
    case "degraded":
      return labels.degraded;
    case "outage":
      return labels.outage;
    case "unknown":
      return labels.noData;
  }
}

function quantity(value: number, singular: string, plural: string): string {
  return `${value} ${value === 1 ? singular : plural}`;
}

function locationText(day: PublicDay, labels: PublicLabels): string[] {
  return day.locations.map((location) => {
    const average =
      location.averageMs === null ? labels.noData : formatMilliseconds(location.averageMs);
    return `${location.code} average ${average} from ${quantity(location.checks, "check", "checks")}`;
  });
}

function accessibleDayLabel(day: PublicDay, labels: PublicLabels): string {
  return [
    day.day,
    historyLevelText(day.level, labels),
    quantity(day.checks, "check", "checks"),
    quantity(day.failures, "failure", "failures"),
    ...locationText(day, labels),
  ].join(", ");
}

function formatDay(day: string): string {
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${day}T00:00:00Z`));
}

export function HistoryStrip({ days, labels }: HistoryStripProps) {
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [activatedIndex, setActivatedIndex] = useState<number | null>(null);
  const [selectionSource, setSelectionSource] = useState<SelectionSource | null>(null);
  const detailId = `history-detail-${useId().replaceAll(":", "")}`;
  const selectedIndex =
    selectionSource === "hover"
      ? (hoveredIndex ?? focusedIndex ?? activatedIndex)
      : selectionSource === "focus"
        ? (focusedIndex ?? hoveredIndex ?? activatedIndex)
        : (activatedIndex ?? focusedIndex ?? hoveredIndex);
  const selectedDay = selectedIndex === null ? null : (days[selectedIndex] ?? null);

  const clearSelection = () => {
    setFocusedIndex(null);
    setHoveredIndex(null);
    setActivatedIndex(null);
    setSelectionSource(null);
  };

  return (
    <div
      className="history-strip"
      onBlur={(event) => {
        const nextTarget = event.relatedTarget;
        if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
          clearSelection();
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          clearSelection();
        }
      }}
    >
      <ol
        className="history-strip__days"
        aria-label={`${days.length}-day history`}
        style={{ gridTemplateColumns: `repeat(${Math.max(days.length, 1)}, minmax(0, 1fr))` }}
      >
        {days.map((day, index) => {
          const selected = selectedIndex === index;
          return (
            <li key={`${day.day}-${index}`}>
              <button
                type="button"
                className="history-day"
                data-level={day.level}
                aria-label={accessibleDayLabel(day, labels)}
                aria-expanded={selected}
                aria-describedby={selected ? detailId : undefined}
                onMouseEnter={() => {
                  setHoveredIndex(index);
                  setSelectionSource("hover");
                }}
                onMouseLeave={() => {
                  setHoveredIndex(null);
                  setSelectionSource(
                    focusedIndex !== null ? "focus" : activatedIndex !== null ? "activate" : null,
                  );
                }}
                onFocus={() => {
                  setFocusedIndex(index);
                  setSelectionSource("focus");
                }}
                onClick={() => {
                  setActivatedIndex(index);
                  setSelectionSource("activate");
                }}
              >
                <span aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ol>
      <div className="history-strip__range" aria-hidden="true">
        <span>{labels.historyStart.replace("{days}", String(days.length))}</span>
        <span>{labels.today}</span>
      </div>
      {selectedDay ? (
        <div
          id={detailId}
          className="history-detail"
          role="region"
          aria-label={`${selectedDay.day} history details`}
        >
          <div className="history-detail__summary">
            <time dateTime={selectedDay.day}>{formatDay(selectedDay.day)}</time>
            <strong>{historyLevelText(selectedDay.level, labels)}</strong>
            <span>{quantity(selectedDay.checks, "check", "checks")}</span>
            <span>{quantity(selectedDay.failures, "failure", "failures")}</span>
          </div>
          {selectedDay.locations.length > 0 ? (
            <ul className="history-detail__locations">
              {locationText(selectedDay, labels).map((location) => (
                <li key={location}>{location}</li>
              ))}
            </ul>
          ) : (
            <span>{labels.noData}</span>
          )}
        </div>
      ) : null}
    </div>
  );
}
