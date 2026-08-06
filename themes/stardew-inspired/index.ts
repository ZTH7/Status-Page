import "@fontsource-variable/pixelify-sans";
import { createElement } from "react";

import type { ThemeManifest } from "../../src/app/theme-contract";
import "./theme.css";

function FarmEnvironment(): React.ReactElement {
  return createElement("span", { className: "stardew-environment" });
}

export const theme = {
  id: "stardew-inspired",
  rootClass: "theme-stardew-inspired",
  supportsColorMode: true,
  decorations: { pageStart: FarmEnvironment },
} satisfies ThemeManifest;
