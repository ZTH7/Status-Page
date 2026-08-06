import type { Thresholds } from "../config/types";

export function resolveThresholds(global: Thresholds, override?: Partial<Thresholds>): Thresholds {
  return { ...global, ...override };
}
