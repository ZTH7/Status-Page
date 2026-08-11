import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { HistoryStrip } from "../../src/app/components/HistoryStrip";
import type { PublicLabels } from "../../src/config/types";
import type { PublicDay } from "../../src/shared/api-types";
import { statusResponseFixture } from "../fixtures/status-response";

const labels: PublicLabels = statusResponseFixture.site.labels;

function knownDay(overrides: Partial<PublicDay> = {}): PublicDay {
  return {
    day: "2026-08-05",
    level: "operational",
    checks: 10,
    failures: 0,
    locations: [{ code: "SJC", averageMs: 120, checks: 10 }],
    ...overrides,
  };
}

describe("HistoryStrip", () => {
  it("renders every one of 90 days as a focusable button with complete non-color labels", () => {
    const days = Array.from({ length: 90 }, (_, index) =>
      knownDay({ day: `2026-08-${String((index % 28) + 1).padStart(2, "0")}` }),
    );
    days[89] = knownDay({
      day: "2026-08-31",
      level: "unknown",
      checks: 0,
      failures: 0,
      locations: [
        { code: "LAX", averageMs: null, checks: 0 },
        { code: "SJC", averageMs: 215, checks: 2 },
      ],
    });

    render(<HistoryStrip days={days} labels={labels} />);

    const list = screen.getByRole("list", { name: "90-day history" });
    const buttons = within(list).getAllByRole("button");
    expect(buttons).toHaveLength(90);
    expect(list).toHaveStyle({ gridTemplateColumns: "repeat(90, minmax(0, 1fr))" });
    expect(list.closest(".history-strip__track")).toBeNull();
    expect(list.closest(".history-strip__scroller")).toBeNull();
    expect(
      buttons.every((button) => button.firstElementChild?.getAttribute("aria-hidden") === "true"),
    ).toBe(true);
    expect(buttons[0]).toHaveAccessibleName(
      "2026-08-01, Operational, 10 checks, 0 failures, SJC average 120 ms from 10 checks",
    );
    expect(buttons[89]).toHaveAccessibleName(
      "2026-08-31, No data, 0 checks, 0 failures, LAX average No data from 0 checks, SJC average 215 ms from 2 checks",
    );
    expect(buttons.every((button) => button.getAttribute("type") === "button")).toBe(true);
    expect(screen.getByText("90 days ago")).toBeInTheDocument();
    expect(screen.getByText(labels.today)).toBeInTheDocument();
  });

  it("selects the same single detail popover with hover, focus, and click", async () => {
    const user = userEvent.setup();
    render(
      <HistoryStrip
        days={[
          knownDay({ day: "2026-08-04", level: "degraded", failures: 2 }),
          knownDay({ day: "2026-08-05", level: "outage", failures: 5 }),
        ]}
        labels={labels}
      />,
    );
    const [first, second] = screen.getAllByRole("button");

    fireEvent.mouseEnter(first!);
    expect(screen.getAllByRole("region", { name: /history details/i })).toHaveLength(1);
    expect(screen.getByRole("region", { name: /history details/i })).toHaveTextContent("Degraded");
    expect(first).toHaveAttribute("aria-expanded", "true");

    await user.click(second!);
    expect(screen.getAllByRole("region", { name: /history details/i })).toHaveLength(1);
    expect(screen.getByRole("region", { name: /history details/i })).toHaveTextContent("Outage");
    expect(second).toHaveAttribute("aria-expanded", "true");
    expect(second).toHaveAttribute("aria-describedby", screen.getByRole("region").id);

    first!.focus();
    fireEvent.focus(first!);
    expect(screen.getAllByRole("region", { name: /history details/i })).toHaveLength(1);
    expect(screen.getByRole("region", { name: /history details/i })).toHaveTextContent("Degraded");
  });

  it("closes on Escape or when focus leaves the strip", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <HistoryStrip days={[knownDay()]} labels={labels} />
        <button type="button">Outside</button>
      </div>,
    );
    const day = screen.getByRole("button", { name: /2026-08-05/ });

    await user.click(day);
    expect(screen.getByRole("region", { name: /history details/i })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("region", { name: /history details/i })).not.toBeInTheDocument();
    expect(day).toHaveAttribute("aria-expanded", "false");

    day.focus();
    fireEvent.focus(day);
    expect(screen.getByRole("region", { name: /history details/i })).toBeInTheDocument();
    const outside = screen.getByRole("button", { name: "Outside" });
    fireEvent.blur(day, { relatedTarget: outside });
    outside.focus();
    expect(screen.queryByRole("region", { name: /history details/i })).not.toBeInTheDocument();
  });

  it("restores the focused day after pointer hover leaves another day", () => {
    render(
      <HistoryStrip
        days={[
          knownDay({ day: "2026-08-04", level: "degraded", failures: 2 }),
          knownDay({ day: "2026-08-05", level: "outage", failures: 5 }),
        ]}
        labels={labels}
      />,
    );
    const [focusedDay, hoveredDay] = screen.getAllByRole("button");

    focusedDay!.focus();
    fireEvent.focus(focusedDay!);
    expect(screen.getByRole("region", { name: /history details/i })).toHaveTextContent("Degraded");

    fireEvent.mouseEnter(hoveredDay!);
    expect(screen.getByRole("region", { name: /history details/i })).toHaveTextContent("Outage");
    expect(hoveredDay).toHaveAttribute("aria-expanded", "true");

    fireEvent.mouseLeave(hoveredDay!);
    expect(screen.getByRole("region", { name: /history details/i })).toHaveTextContent("Degraded");
    expect(focusedDay).toHaveAttribute("aria-expanded", "true");
    expect(focusedDay).toHaveFocus();
  });

  it("uses configured no-data language for an unknown day and missing location average", async () => {
    const user = userEvent.setup();
    render(
      <HistoryStrip
        days={[
          knownDay({
            level: "unknown",
            checks: 0,
            failures: 0,
            locations: [{ code: "unknown", averageMs: null, checks: 0 }],
          }),
        ]}
        labels={labels}
      />,
    );

    const day = screen.getByRole("button", { name: /No data/ });
    expect(day).toHaveAccessibleName(/unknown average No data from 0 checks/);
    await user.click(day);
    const detail = screen.getByRole("region", { name: /history details/i });
    expect(detail).toHaveTextContent(labels.noData);
    expect(detail).toHaveTextContent("0 checks");
    expect(detail).toHaveTextContent("0 failures");
  });

  it("shows latency with no more than two decimal places", async () => {
    const user = userEvent.setup();
    render(
      <HistoryStrip
        days={[
          knownDay({
            locations: [
              { code: "SJC", averageMs: 120.126, checks: 6 },
              { code: "LAX", averageMs: 85.5, checks: 4 },
            ],
          }),
        ]}
        labels={labels}
      />,
    );

    const day = screen.getByRole("button", { name: /SJC average 120\.13 ms/ });
    expect(day).toHaveAccessibleName(/LAX average 85\.5 ms/);
    await user.click(day);
    expect(screen.getByRole("region", { name: /history details/i })).toHaveTextContent(
      "SJC average 120.13 ms",
    );
  });
});
