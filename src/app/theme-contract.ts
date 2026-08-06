import type React from "react";
import type { ThemeId } from "../config/types";

export interface ThemeManifest {
  id: ThemeId;
  rootClass: string;
  supportsColorMode: true;
  decorations: {
    pageStart?: React.ComponentType;
    pageEnd?: React.ComponentType;
  };
}
