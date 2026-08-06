import { describe, expect, it } from "vitest";

import { listUtcDays, utcDay } from "../../src/shared/dates";

describe("UTC calendar dates", () => {
  it("formats Unix milliseconds as a UTC YYYY-MM-DD day", () => {
    expect(utcDay(Date.UTC(2025, 11, 31, 23, 59, 59, 999))).toBe("2025-12-31");
    expect(utcDay(Date.UTC(2026, 0, 1))).toBe("2026-01-01");
  });

  it("lists exact calendar days oldest to newest across month and year rollover", () => {
    expect(listUtcDays(Date.UTC(2026, 0, 2, 18, 30), 4)).toEqual([
      "2025-12-30",
      "2025-12-31",
      "2026-01-01",
      "2026-01-02",
    ]);
  });

  it("includes leap day when advancing with UTC calendar arithmetic", () => {
    expect(listUtcDays(Date.UTC(2024, 2, 1, 6), 4)).toEqual([
      "2024-02-27",
      "2024-02-28",
      "2024-02-29",
      "2024-03-01",
    ]);
  });

  it("returns an exact inclusive 90-day window", () => {
    const days = listUtcDays(Date.UTC(2024, 2, 1, 23, 59), 90);

    expect(days).toHaveLength(90);
    expect(days[0]).toBe("2023-12-03");
    expect(days[88]).toBe("2024-02-29");
    expect(days[89]).toBe("2024-03-01");
  });

  it.each([0, -1, 1.5])("rejects non-positive-integer count %s", (count) => {
    expect(() => listUtcDays(Date.UTC(2026, 7, 5), count)).toThrow(RangeError);
  });
});
