import { activeTheme } from "../generated/active-theme";
import { publicConfig } from "../generated/public-config";
import { THEME_IDS } from "../config/types";
import type { ThemeManifest } from "./theme-contract";

const themeRootClasses = THEME_IDS.map((themeId) => `theme-${themeId}`);

if (activeTheme.id !== publicConfig.theme) {
  throw new Error(
    `Active theme ${activeTheme.id} does not match configured theme ${publicConfig.theme}`,
  );
}

export const themeDecorations: ThemeManifest["decorations"] = activeTheme.decorations;

export function applyActiveTheme(): void {
  document.documentElement.classList.remove(...themeRootClasses);
  document.documentElement.classList.add(activeTheme.rootClass);
}
