import { useCallback, useEffect, useMemo, useState } from "react";

import type { ColorModePreference } from "../../config/types";
import { publicConfig } from "../../generated/public-config";

export type ColorMode = "light" | "dark";

export interface ColorModeState {
  preference: ColorModePreference;
  colorMode: ColorMode;
  toggle(): void;
}

const storageKey = "status-page-color-mode";
const darkModeQuery = "(prefers-color-scheme: dark)";

function isColorModePreference(value: string | null): value is ColorModePreference {
  return value === "light" || value === "dark" || value === "system";
}

function initialPreference(): ColorModePreference {
  try {
    const storedPreference = window.localStorage.getItem(storageKey);
    return isColorModePreference(storedPreference) ? storedPreference : publicConfig.colorMode;
  } catch {
    return publicConfig.colorMode;
  }
}

export function useColorMode(): ColorModeState {
  const mediaQuery = useMemo(() => window.matchMedia(darkModeQuery), []);
  const [preference, setPreference] = useState<ColorModePreference>(initialPreference);
  const [systemDark, setSystemDark] = useState(mediaQuery.matches);
  const colorMode: ColorMode =
    preference === "system" ? (systemDark ? "dark" : "light") : preference;

  useEffect(() => {
    document.documentElement.dataset.colorMode = colorMode;
  }, [colorMode]);

  useEffect(() => {
    if (preference !== "system") return;

    const handleChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    mediaQuery.addEventListener("change", handleChange);
    setSystemDark(mediaQuery.matches);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [mediaQuery, preference]);

  const toggle = useCallback(() => {
    const nextPreference: ColorMode = colorMode === "dark" ? "light" : "dark";
    setPreference(nextPreference);
    try {
      window.localStorage.setItem(storageKey, nextPreference);
    } catch {}
  }, [colorMode]);

  return { preference, colorMode, toggle };
}
