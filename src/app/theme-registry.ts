import { activeTheme } from "../generated/active-theme";
import { publicConfig } from "../generated/public-config";
import type { ThemeManifest } from "./theme-contract";

const themeRootClasses = ["theme-default", "theme-stardew-inspired"] as const;

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
