import "@fontsource-variable/geist";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { applyActiveTheme } from "./theme-registry";
import "./styles/reset.css";
import "./styles/base.css";

applyActiveTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
