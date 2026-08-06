import type { ColorMode } from "../hooks/useColorMode";

interface ColorModeToggleProps {
  colorMode: ColorMode;
  onToggle(): void;
}

export function ColorModeToggle({ colorMode, onToggle }: ColorModeToggleProps) {
  const isDark = colorMode === "dark";
  const nextMode = isDark ? "light" : "dark";

  return (
    <button
      className="color-mode-toggle"
      type="button"
      aria-label={`Switch to ${nextMode} mode`}
      onClick={onToggle}
    >
      <span>{isDark ? "Dark mode" : "Light mode"}</span>
      {isDark ? (
        <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41" />
        </svg>
      ) : (
        <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16">
          <path d="M20.6 15.2A8.5 8.5 0 0 1 8.8 3.4 8.5 8.5 0 1 0 20.6 15.2Z" />
        </svg>
      )}
    </button>
  );
}
