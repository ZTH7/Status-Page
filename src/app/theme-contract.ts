import type React from "react";

export interface ThemeManifest {
  id: "default" | "stardew-inspired";
  rootClass: string;
  supportsColorMode: true;
  decorations: {
    pageStart?: React.ComponentType;
    pageEnd?: React.ComponentType;
  };
}
