import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PublicMonitor } from "../../src/shared/api-types";
import { statusResponseFixture } from "../fixtures/status-response";

interface BootstrapOptions {
  storedPreference: string | null;
  systemDark: boolean;
  storageThrows?: boolean;
}

const defaultThemePath = "../../themes/default/index";
const stardewThemePath = "../../themes/stardew-inspired/index";
const themeRegistryPath = "../../src/app/theme-registry";
const useStatusPath = "../../src/app/hooks/useStatus";
const useColorModePath = "../../src/app/hooks/useColorMode";
const useMonitorSearchPath = "../../src/app/hooks/useMonitorSearch";

function generateArtifacts(): void {
  execFileSync(process.execPath, ["--import", "tsx", "scripts/generate-config.ts", "--example"], {
    cwd: process.cwd(),
    stdio: "pipe",
  });
}

function runBootstrap({ storedPreference, systemDark, storageThrows = false }: BootstrapOptions) {
  const script = readFileSync("public/theme-bootstrap.js", "utf8");
  const datasets: Record<string, string> = {};
  const fakeWindow = {
    localStorage: {
      getItem() {
        if (storageThrows) {
          throw new Error("storage unavailable");
        }
        return storedPreference;
      },
    },
    matchMedia(query: string) {
      expect(query).toBe("(prefers-color-scheme: dark)");
      return { matches: systemDark };
    },
  };
  const fakeDocument = { documentElement: { dataset: datasets } };

  Function("window", "document", script)(fakeWindow, fakeDocument);

  return { datasets, script };
}

function parsedStyleRules(source: string): {
  element: HTMLStyleElement;
  rules: CSSStyleRule[];
} {
  const element = document.createElement("style");
  element.textContent = source;
  document.head.appendChild(element);
  function collect(ruleList: CSSRuleList): CSSStyleRule[] {
    return Array.from(ruleList).flatMap((rule) => {
      if ("selectorText" in rule) return [rule as CSSStyleRule];
      const nestedRules = (rule as CSSRule & { cssRules?: CSSRuleList }).cssRules;
      return nestedRules ? collect(nestedRules) : [];
    });
  }
  const rules = collect(element.sheet?.cssRules ?? ([] as unknown as CSSRuleList));
  return { element, rules };
}

function ruleFor(rules: CSSStyleRule[], selector: string): CSSStyleRule {
  const rule = rules.find((candidate) => candidate.selectorText === selector);
  expect(rule, `Missing parsed CSS rule: ${selector}`).toBeDefined();
  return rule!;
}

function hexChannels(hex: string): [number, number, number] {
  return [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16)) as [
    number,
    number,
    number,
  ];
}

function composite(foreground: string, background: string, opacity: number): string {
  const foregroundChannels = hexChannels(foreground);
  const backgroundChannels = hexChannels(background);
  const channels = foregroundChannels.map((channel, index) =>
    Math.round(channel * opacity + backgroundChannels[index]! * (1 - opacity)),
  );
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

function contrastRatio(first: string, second: string): number {
  function luminance(color: string): number {
    const [red, green, blue] = hexChannels(color).map((channel) => {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
  }
  const firstLuminance = luminance(first);
  const secondLuminance = luminance(second);
  return (
    (Math.max(firstLuminance, secondLuminance) + 0.05) /
    (Math.min(firstLuminance, secondLuminance) + 0.05)
  );
}

describe("generated theme bootstrap", () => {
  it.each([
    [null, false, "light"],
    [null, true, "dark"],
    ["system", true, "dark"],
    ["light", true, "light"],
    ["dark", false, "dark"],
    ["invalid", false, "light"],
  ])(
    "resolves stored preference %s against system dark=%s",
    (storedPreference, systemDark, expected) => {
      generateArtifacts();

      const { datasets } = runBootstrap({ storedPreference, systemDark });

      expect(datasets).toEqual({ theme: "default", colorMode: expected });
    },
  );

  it("falls back to the configured preference when storage is unavailable", () => {
    generateArtifacts();

    const { datasets } = runBootstrap({
      storedPreference: "dark",
      systemDark: true,
      storageThrows: true,
    });

    expect(datasets).toEqual({ theme: "default", colorMode: "dark" });
  });

  it("emits deterministic isolated artifacts with one static active-theme re-export", () => {
    generateArtifacts();
    const firstBootstrap = readFileSync("public/theme-bootstrap.js", "utf8");
    const firstActiveTheme = readFileSync("src/generated/active-theme.ts", "utf8");
    generateArtifacts();

    expect(readFileSync("public/theme-bootstrap.js", "utf8")).toBe(firstBootstrap);
    expect(readFileSync("src/generated/active-theme.ts", "utf8")).toBe(firstActiveTheme);
    expect(firstActiveTheme.trim()).toBe(
      'export { theme as activeTheme } from "../../themes/default/index";',
    );
    expect(firstActiveTheme).not.toContain("stardew-inspired");
    expect(firstActiveTheme).not.toContain("import(");
    expect(firstBootstrap).not.toMatch(
      /ZT Blog|VaultWarden|IT Tools|Drive|status\.zdaily\.net|All Systems Operational|SECRET_|WEBHOOK|TOKEN|binding/i,
    );
  });

  it("loads the bootstrap synchronously in head before the client module", () => {
    const html = readFileSync("index.html", "utf8");
    const bootstrapIndex = html.indexOf('<script src="/theme-bootstrap.js"></script>');
    const clientIndex = html.indexOf('<script type="module" src="/src/app/main.tsx"></script>');
    const headEndIndex = html.indexOf("</head>");

    expect(bootstrapIndex).toBeGreaterThan(-1);
    expect(bootstrapIndex).toBeLessThan(headEndIndex);
    expect(bootstrapIndex).toBeLessThan(clientIndex);
  });

  it("applies the active theme before React renders", () => {
    const mainSource = readFileSync("src/app/main.tsx", "utf8");

    expect(mainSource.indexOf("applyActiveTheme();")).toBeGreaterThan(-1);
    expect(mainSource.indexOf("applyActiveTheme();")).toBeLessThan(
      mainSource.indexOf("createRoot("),
    );
  });

  it("keeps the Stardew-only Pixelify font out of the shared client entry", () => {
    const mainSource = readFileSync("src/app/main.tsx", "utf8");

    expect(mainSource).toContain('import "@fontsource-variable/geist";');
    expect(mainSource).not.toMatch(/pixelify/i);
  });
});

describe("default theme stylesheet behavior", () => {
  it("uses the dark native color scheme when the resolved mode is dark", () => {
    const originalClassName = document.documentElement.className;
    const originalColorMode = document.documentElement.dataset.colorMode;
    const { element } = parsedStyleRules(readFileSync("themes/default/theme.css", "utf8"));
    document.documentElement.className = "theme-default";
    document.documentElement.dataset.colorMode = "dark";

    expect(getComputedStyle(document.documentElement).colorScheme).toBe("dark");

    element.remove();
    document.documentElement.className = originalClassName;
    if (originalColorMode === undefined) {
      delete document.documentElement.dataset.colorMode;
    } else {
      document.documentElement.dataset.colorMode = originalColorMode;
    }
  });

  it("anchors history detail outside flow within its strip and elevates its service card", () => {
    const base = parsedStyleRules(readFileSync("src/app/styles/base.css", "utf8"));
    const theme = parsedStyleRules(readFileSync("themes/default/theme.css", "utf8"));

    const card = ruleFor(base.rules, ".service-card").style;
    const strip = ruleFor(base.rules, ".history-strip").style;
    const detail = ruleFor(base.rules, ".history-detail").style;
    const themedDetail = ruleFor(theme.rules, ".theme-default .history-detail").style;
    const raisedCard = theme.rules.find((rule) =>
      rule.selectorText.includes(":has(.history-detail)"),
    );

    expect(card.position).toBe("relative");
    expect(card.zIndex).toBe("0");
    expect(strip.position).toBe("relative");
    expect(detail.position).toBe("absolute");
    expect(detail.getPropertyValue("inset-inline")).toBe("0px");
    expect(detail.getPropertyValue("inset-block-start")).toBe("calc(100% + 12px)");
    expect(detail.width).toBe("100%");
    expect(detail.maxWidth).toBe("100%");
    expect(detail.overflowWrap).toBe("anywhere");
    expect(themedDetail.background).toBe("var(--surface)");
    expect(themedDetail.border).toBe("1px solid var(--border)");
    expect(themedDetail.boxShadow).toBe("var(--elevated-shadow)");
    expect(raisedCard?.style.zIndex).toBe("2");

    base.element.remove();
    theme.element.remove();
  });

  it("contains 24px history targets in a local horizontal scroller", () => {
    const base = parsedStyleRules(readFileSync("src/app/styles/base.css", "utf8"));
    const scroller = ruleFor(base.rules, ".history-strip__scroller").style;
    const track = ruleFor(base.rules, ".history-strip__track").style;
    const item = ruleFor(base.rules, ".history-strip__days li").style;
    const button = ruleFor(base.rules, ".history-day").style;
    const bar = ruleFor(base.rules, ".history-day > span").style;

    expect(scroller.overflowX).toBe("auto");
    expect(scroller.maxWidth).toBe("100%");
    expect(track.width).toBe("max-content");
    expect(track.minWidth).toBe("100%");
    expect(item.flex).toBe("0 0 24px");
    expect(button.minInlineSize).toBe("24px");
    expect(button.blockSize).toBe("24px");
    expect(bar.width).toBe("4px");

    base.element.remove();
  });

  it("keeps final history bars at 3:1 contrast and uses a non-opacity interaction signal", () => {
    const theme = parsedStyleRules(readFileSync("themes/default/theme.css", "utf8"));
    const light = ruleFor(theme.rules, ":root.theme-default").style;
    const dark = ruleFor(theme.rules, ':root.theme-default[data-color-mode="dark"]').style;
    const baseBar = ruleFor(theme.rules, ".theme-default .history-day > span").style;
    const interactionRule = theme.rules.find((rule) =>
      rule.selectorText.includes(".history-day:hover > span"),
    );
    const opacity = Number.parseFloat(baseBar.opacity || "1");

    for (const [mode, tokens] of [
      ["light", light],
      ["dark", dark],
    ] as const) {
      const surface = tokens.getPropertyValue("--surface").trim();
      for (const level of ["operational", "degraded", "outage", "unknown"] as const) {
        const levelRule = theme.rules.find(
          (rule) =>
            rule.selectorText.includes(`data-level='${level}'`) &&
            rule.selectorText.endsWith("> span"),
        );
        const levelStyle = levelRule?.style ?? baseBar;
        const background = levelStyle.background;
        const variable = background.match(/var\((--[^)]+)\)/)?.[1];
        expect(variable, `${mode} ${level} history color token`).toBeDefined();
        const color =
          tokens.getPropertyValue(variable!).trim() || light.getPropertyValue(variable!).trim();
        const finalColor = composite(color, surface, opacity);
        expect(contrastRatio(finalColor, surface), `${mode} ${level}`).toBeGreaterThanOrEqual(3);
      }
    }
    expect(baseBar.opacity).toBe("");
    expect(interactionRule?.style.opacity).toBe("");
    expect(interactionRule?.style.height).toBe("");
    expect(interactionRule?.style.transform).toBe("scaleY(1.25)");

    theme.element.remove();
  });

  it("keeps mobile overall metadata naturally aligned without an inline offset", () => {
    const base = parsedStyleRules(readFileSync("src/app/styles/base.css", "utf8"));
    const updatedRules = base.rules.filter(
      (rule) => rule.selectorText === ".overall-status__updated",
    );

    expect(updatedRules.length).toBeGreaterThan(0);
    expect(updatedRules.every((rule) => rule.style.paddingLeft === "")).toBe(true);

    base.element.remove();
  });
});

describe("theme manifests and active registry", () => {
  afterEach(() => {
    document.documentElement.className = "";
    vi.doUnmock("../../src/generated/active-theme");
    vi.resetModules();
  });

  it.each([
    ["default", "theme-default", [] as string[], () => import(/* @vite-ignore */ defaultThemePath)],
    [
      "stardew-inspired",
      "theme-stardew-inspired",
      ["pageStart"],
      () => import(/* @vite-ignore */ stardewThemePath),
    ],
  ])("defines the %s manifest contract", async (id, rootClass, decorationKeys, loadTheme) => {
    const module = await loadTheme().catch(() => null);

    expect(module).not.toBeNull();
    expect(module?.theme).toMatchObject({
      id,
      rootClass,
      supportsColorMode: true,
    });
    expect(Object.keys(module?.theme.decorations ?? {})).toEqual(decorationKeys);
  });

  it("applies exactly one active root class idempotently and preserves unrelated classes", async () => {
    document.documentElement.className = "app-shell theme-stardew-inspired";
    const registry = await import(/* @vite-ignore */ themeRegistryPath).catch(() => null);

    expect(registry).not.toBeNull();
    registry?.applyActiveTheme();
    registry?.applyActiveTheme();

    expect(document.documentElement.classList.contains("app-shell")).toBe(true);
    expect(document.documentElement.classList.contains("theme-default")).toBe(true);
    expect(document.documentElement.classList.contains("theme-stardew-inspired")).toBe(false);
  });

  it("exposes only the active decoration component identities and root-class applier", async () => {
    function PageStart() {
      return <div>Page start</div>;
    }
    function PageEnd() {
      return <div>Page end</div>;
    }
    const activeTheme = {
      id: "default",
      rootClass: "theme-default",
      supportsColorMode: true,
      decorations: { pageStart: PageStart, pageEnd: PageEnd },
    } as const;
    vi.doMock("../../src/generated/active-theme", () => ({ activeTheme }));

    const registry = await import(/* @vite-ignore */ themeRegistryPath);

    expect(registry.themeDecorations.pageStart).toBe(PageStart);
    expect(registry.themeDecorations.pageEnd).toBe(PageEnd);
    expect(Object.keys(registry).sort()).toEqual(["applyActiveTheme", "themeDecorations"]);
    expect(registry).not.toHaveProperty("activeTheme");
  });

  it("rejects an active manifest whose ID differs from deploy-time public config", async () => {
    const { theme } = await import(/* @vite-ignore */ stardewThemePath);
    vi.doMock("../../src/generated/active-theme", () => ({
      activeTheme: theme,
    }));

    await expect(import(/* @vite-ignore */ themeRegistryPath)).rejects.toThrow(
      "Active theme stardew-inspired does not match configured theme default",
    );
  });
});

describe("Stardew-inspired theme", () => {
  it("owns its font, stylesheet, and one inert environmental decoration", async () => {
    const module = await import(/* @vite-ignore */ stardewThemePath);
    const Decoration = module.theme.decorations.pageStart;

    expect(Object.keys(module)).toEqual(["theme"]);
    expect(Decoration).toBeDefined();
    if (!Decoration) return;

    const { container } = render(<Decoration />);
    const environment = container.firstElementChild;
    expect(environment).toHaveClass("stardew-environment");
    expect(environment).not.toHaveAttribute("role");
    expect(environment).not.toHaveAttribute("tabindex");

    const source = readFileSync("themes/stardew-inspired/index.ts", "utf8");
    expect(source).toMatch(/import ['"]@fontsource-variable\/pixelify-sans['"]/);
    expect(source).toMatch(/import ['"]\.\/theme\.css['"]/);
    expect(source).not.toContain("themes/default");
  });

  it("ships original day and night environments for desktop and mobile", () => {
    const stylesheet = readFileSync("themes/stardew-inspired/theme.css", "utf8");
    const assets = [
      "farm-day-desktop.webp",
      "farm-day-mobile.webp",
      "farm-night-desktop.webp",
      "farm-night-mobile.webp",
    ];

    for (const asset of assets) {
      expect(stylesheet).toContain(asset);
      expect(statSync(`themes/stardew-inspired/assets/${asset}`).size).toBeGreaterThan(20_000);
    }
    expect(stylesheet).toContain("@media (max-width: 45rem)");
    expect(stylesheet).toContain(':root.theme-stardew-inspired[data-color-mode="dark"]');
    expect(stylesheet).toContain("pointer-events: none");
  });

  it("uses pixel type only for short labels and Geist for readable data", () => {
    const theme = parsedStyleRules(readFileSync("themes/stardew-inspired/theme.css", "utf8"));
    const root = ruleFor(theme.rules, ":root.theme-stardew-inspired").style;
    const headingRule = theme.rules.find((rule) => rule.selectorText.includes(".site-identity h1"));
    const dataRule = theme.rules.find((rule) =>
      rule.selectorText.includes(".service-card__metadata"),
    );

    expect(root.getPropertyValue("--font-display")).toContain("Pixelify Sans Variable");
    expect(root.getPropertyValue("--font-data")).toContain("Geist Variable");
    expect(headingRule?.style.fontFamily).toBe("var(--font-display)");
    expect(dataRule?.style.fontFamily).toBe("var(--font-data)");

    theme.element.remove();
  });

  it("keeps semantic colors, focus, and reduced-motion behavior explicit", () => {
    const source = readFileSync("themes/stardew-inspired/theme.css", "utf8");
    const theme = parsedStyleRules(source);
    const root = ruleFor(theme.rules, ":root.theme-stardew-inspired").style;
    const card = ruleFor(theme.rules, ".theme-stardew-inspired .service-card").style;

    expect(root.getPropertyValue("--status-operational-base")).not.toBe("");
    expect(root.getPropertyValue("--status-degraded-base")).not.toBe("");
    expect(root.getPropertyValue("--status-outage-base")).not.toBe("");
    expect(card.borderWidth).toBe("4px");
    expect(card.boxShadow).toContain("var(--pixel-shadow)");
    expect(source).toContain(":focus-visible");
    expect(source).toContain("@media (prefers-reduced-motion: reduce)");
    expect(source).not.toMatch(/\bcontent\s*:/i);
    expect(source).not.toMatch(/\bdisplay\s*:\s*none/i);
    expect(source).not.toMatch(/\bvisibility\s*:\s*hidden/i);

    theme.element.remove();
  });
});

function response(body: unknown, status = 200): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("useStatus", () => {
  it("loads a valid status response and does not refetch on a stable rerender", async () => {
    const module = await import(/* @vite-ignore */ useStatusPath).catch(() => null);
    expect(module).not.toBeNull();
    if (!module) return;
    const fetcher = vi.fn(async () => response(statusResponseFixture)) as unknown as typeof fetch;
    const { result, rerender } = renderHook(() => module.useStatus(fetcher));

    expect(result.current).toEqual({ kind: "loading" });
    rerender();

    await waitFor(() =>
      expect(result.current).toEqual({
        kind: "ready",
        data: statusResponseFixture,
      }),
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith("/api/status", {
      signal: expect.any(AbortSignal),
    });
  });

  it("surfaces the safe message from a typed non-2xx API response", async () => {
    const module = await import(/* @vite-ignore */ useStatusPath).catch(() => null);
    expect(module).not.toBeNull();
    if (!module) return;
    const fetcher = vi.fn(async () =>
      response(
        {
          error: {
            code: "status_unavailable",
            message: "Status is under maintenance.",
          },
        },
        503,
      ),
    ) as unknown as typeof fetch;
    const { result } = renderHook(() => module.useStatus(fetcher));

    await waitFor(() =>
      expect(result.current).toEqual({
        kind: "unavailable",
        message: "Status is under maintenance.",
      }),
    );
  });

  it.each([
    ["malformed JSON", "{"],
    [
      "malformed shape",
      {
        generatedAt: 42,
        overall: "operational",
        site: {},
        monitors: "none",
        incidents: [],
      },
    ],
  ])("uses the safe fallback for %s", async (_name, body) => {
    const module = await import(/* @vite-ignore */ useStatusPath).catch(() => null);
    expect(module).not.toBeNull();
    if (!module) return;
    const fetcher = vi.fn(async () => response(body)) as unknown as typeof fetch;
    const { result } = renderHook(() => module.useStatus(fetcher));

    await waitFor(() =>
      expect(result.current).toEqual({
        kind: "unavailable",
        message: "Status data is temporarily unavailable.",
      }),
    );
  });

  it("never exposes a raw network error", async () => {
    const module = await import(/* @vite-ignore */ useStatusPath).catch(() => null);
    expect(module).not.toBeNull();
    if (!module) return;
    const fetcher = vi.fn(async () => {
      throw new Error("private upstream token was rejected");
    }) as unknown as typeof fetch;
    const { result } = renderHook(() => module.useStatus(fetcher));

    await waitFor(() =>
      expect(result.current).toEqual({
        kind: "unavailable",
        message: "Status data is temporarily unavailable.",
      }),
    );
    expect(JSON.stringify(result.current)).not.toContain("private upstream token");
  });

  it("aborts its in-flight request on unmount without a state update", async () => {
    const module = await import(/* @vite-ignore */ useStatusPath).catch(() => null);
    expect(module).not.toBeNull();
    if (!module) return;
    let requestSignal: AbortSignal | undefined;
    const fetcher = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      requestSignal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        requestSignal?.addEventListener("abort", () =>
          reject(new DOMException("Request aborted", "AbortError")),
        );
      });
    }) as unknown as typeof fetch;
    const { result, unmount } = renderHook(() => module.useStatus(fetcher));

    expect(result.current).toEqual({ kind: "loading" });
    expect(requestSignal?.aborted).toBe(false);
    unmount();
    await Promise.resolve();

    expect(requestSignal?.aborted).toBe(true);
    expect(result.current).toEqual({ kind: "loading" });
  });
});

class MediaQueryListStub {
  matches: boolean;
  readonly media = "(prefers-color-scheme: dark)";
  readonly listeners = new Set<(event: MediaQueryListEvent) => void>();
  private matchesBeforeFirstListener: boolean | undefined;

  constructor(matches: boolean, matchesBeforeFirstListener?: boolean) {
    this.matches = matches;
    this.matchesBeforeFirstListener = matchesBeforeFirstListener;
  }

  addEventListener(_type: "change", listener: (event: MediaQueryListEvent) => void): void {
    if (this.matchesBeforeFirstListener !== undefined) {
      this.matches = this.matchesBeforeFirstListener;
      this.matchesBeforeFirstListener = undefined;
    }
    this.listeners.add(listener);
  }

  removeEventListener(_type: "change", listener: (event: MediaQueryListEvent) => void): void {
    this.listeners.delete(listener);
  }

  emit(matches: boolean): void {
    this.matches = matches;
    for (const listener of this.listeners) {
      listener({ matches } as MediaQueryListEvent);
    }
  }
}

function installMatchMedia(
  systemDark: boolean,
  matchesBeforeFirstListener?: boolean,
): MediaQueryListStub {
  const media = new MediaQueryListStub(systemDark, matchesBeforeFirstListener);
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => media),
  });
  return media;
}

describe("useColorMode", () => {
  afterEach(() => {
    window.localStorage.clear();
    delete document.documentElement.dataset.colorMode;
    vi.restoreAllMocks();
  });

  it("initializes from system preference and applies its resolved mode", async () => {
    const module = await import(/* @vite-ignore */ useColorModePath).catch(() => null);
    expect(module).not.toBeNull();
    if (!module) return;
    const media = installMatchMedia(true);
    const { result } = renderHook(() => module.useColorMode());

    expect(result.current.preference).toBe("system");
    expect(result.current.colorMode).toBe("dark");
    expect(document.documentElement.dataset.colorMode).toBe("dark");
    expect(media.listeners.size).toBe(1);
  });

  it("initializes from a valid stored explicit preference without a system listener", async () => {
    const module = await import(/* @vite-ignore */ useColorModePath).catch(() => null);
    expect(module).not.toBeNull();
    if (!module) return;
    window.localStorage.setItem("status-page-color-mode", "dark");
    const media = installMatchMedia(false);
    const { result } = renderHook(() => module.useColorMode());

    expect(result.current).toMatchObject({
      preference: "dark",
      colorMode: "dark",
    });
    expect(document.documentElement.dataset.colorMode).toBe("dark");
    expect(media.listeners.size).toBe(0);
  });

  it("synchronizes a system change silently lost before listener attachment", async () => {
    const module = await import(/* @vite-ignore */ useColorModePath).catch(() => null);
    expect(module).not.toBeNull();
    if (!module) return;
    installMatchMedia(false, true);
    const { result } = renderHook(() => module.useColorMode());

    await waitFor(() => expect(result.current.colorMode).toBe("dark"));
    expect(document.documentElement.dataset.colorMode).toBe("dark");
  });

  it("toggles from system to the opposite explicit mode and persists subsequent toggles", async () => {
    const module = await import(/* @vite-ignore */ useColorModePath).catch(() => null);
    expect(module).not.toBeNull();
    if (!module) return;
    installMatchMedia(true);
    const { result } = renderHook(() => module.useColorMode());

    act(() => result.current.toggle());
    expect(result.current).toMatchObject({
      preference: "light",
      colorMode: "light",
    });
    expect(window.localStorage.getItem("status-page-color-mode")).toBe("light");
    expect(document.documentElement.dataset.colorMode).toBe("light");

    act(() => result.current.toggle());
    expect(result.current).toMatchObject({
      preference: "dark",
      colorMode: "dark",
    });
    expect(window.localStorage.getItem("status-page-color-mode")).toBe("dark");
  });

  it("responds to media changes only while preference is system", async () => {
    const module = await import(/* @vite-ignore */ useColorModePath).catch(() => null);
    expect(module).not.toBeNull();
    if (!module) return;
    const media = installMatchMedia(false);
    const { result } = renderHook(() => module.useColorMode());

    act(() => media.emit(true));
    expect(result.current.colorMode).toBe("dark");

    act(() => result.current.toggle());
    expect(result.current.colorMode).toBe("light");
    expect(media.listeners.size).toBe(0);
    act(() => media.emit(false));
    expect(result.current.colorMode).toBe("light");
  });

  it("removes the media listener on unmount", async () => {
    const module = await import(/* @vite-ignore */ useColorModePath).catch(() => null);
    expect(module).not.toBeNull();
    if (!module) return;
    const media = installMatchMedia(false);
    const { unmount } = renderHook(() => module.useColorMode());

    expect(media.listeners.size).toBe(1);
    unmount();
    expect(media.listeners.size).toBe(0);
  });

  it("keeps the UI usable when storage reads and writes fail", async () => {
    const module = await import(/* @vite-ignore */ useColorModePath).catch(() => null);
    expect(module).not.toBeNull();
    if (!module) return;
    installMatchMedia(false);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const { result } = renderHook(() => module.useColorMode());

    expect(result.current).toMatchObject({
      preference: "system",
      colorMode: "light",
    });
    expect(() => act(() => result.current.toggle())).not.toThrow();
    expect(result.current).toMatchObject({
      preference: "dark",
      colorMode: "dark",
    });
  });
});

type UseMonitorSearch = (monitors: PublicMonitor[]) => {
  query: string;
  setQuery(query: string): void;
  clear(): void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  filteredMonitors: PublicMonitor[];
};

function searchHarness(useMonitorSearch: UseMonitorSearch): ComponentType {
  return function SearchHarness() {
    const search = useMonitorSearch(statusResponseFixture.monitors);
    return (
      <div>
        <input
          aria-label="Search services"
          ref={search.inputRef}
          value={search.query}
          onChange={(event) => search.setQuery(event.currentTarget.value)}
        />
        <button type="button">Outside</button>
        <output aria-label="Matches">
          {search.filteredMonitors.map((monitor) => monitor.name).join("|")}
        </output>
      </div>
    );
  };
}

describe("useMonitorSearch", () => {
  async function renderSearch() {
    const module = await import(/* @vite-ignore */ useMonitorSearchPath).catch(() => null);
    expect(module).not.toBeNull();
    if (!module) return null;
    const Harness = searchHarness(module.useMonitorSearch);
    return render(<Harness />);
  }

  it("filters names case-insensitively in input order and treats whitespace as empty", async () => {
    if (!(await renderSearch())) return;
    const input = screen.getByRole("textbox", { name: "Search services" });

    fireEvent.change(input, { target: { value: "i" } });
    expect(screen.getByLabelText("Matches")).toHaveTextContent("Public API|Website");
    fireEvent.change(input, { target: { value: "SITE" } });
    expect(screen.getByLabelText("Matches")).toHaveTextContent("Website");
    fireEvent.change(input, { target: { value: "   " } });
    expect(screen.getByLabelText("Matches")).toHaveTextContent("Public API|Website");
  });

  it("focuses search and prevents slash from a non-editable target", async () => {
    if (!(await renderSearch())) return;
    screen.getByRole("button", { name: "Outside" }).focus();
    const slash = new KeyboardEvent("keydown", {
      key: "/",
      bubbles: true,
      cancelable: true,
    });

    document.dispatchEvent(slash);

    expect(screen.getByRole("textbox", { name: "Search services" })).toHaveFocus();
    expect(slash.defaultPrevented).toBe(true);
  });

  it("ignores slash with modifiers or from editable controls", async () => {
    if (!(await renderSearch())) return;
    const searchInput = screen.getByRole("textbox", { name: "Search services" });
    const outside = screen.getByRole("button", { name: "Outside" });
    const contentEditable = document.createElement("div");
    contentEditable.setAttribute("contenteditable", "true");
    const editableTargets = [
      document.createElement("input"),
      document.createElement("textarea"),
      document.createElement("select"),
      contentEditable,
    ];
    for (const target of editableTargets) {
      document.body.appendChild(target);
      target.focus();
      const event = new KeyboardEvent("keydown", {
        key: "/",
        bubbles: true,
        cancelable: true,
      });
      target.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
      expect(searchInput).not.toHaveFocus();
      target.remove();
    }
    for (const modifier of ["ctrlKey", "metaKey", "altKey"] as const) {
      outside.focus();
      const event = new KeyboardEvent("keydown", {
        key: "/",
        bubbles: true,
        cancelable: true,
        [modifier]: true,
      });
      document.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
      expect(searchInput).not.toHaveFocus();
    }
  });

  it("clears and blurs on Escape only while search is focused", async () => {
    if (!(await renderSearch())) return;
    const input = screen.getByRole("textbox", { name: "Search services" });
    fireEvent.change(input, { target: { value: "api" } });
    input.focus();
    const escape = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });

    act(() => input.dispatchEvent(escape));

    expect(input).toHaveValue("");
    expect(input).not.toHaveFocus();
    expect(escape.defaultPrevented).toBe(true);

    screen.getByRole("button", { name: "Outside" }).focus();
    fireEvent.change(input, { target: { value: "web" } });
    const outsideEscape = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(outsideEscape);
    expect(input).toHaveValue("web");
    expect(outsideEscape.defaultPrevented).toBe(false);
  });

  it("removes the document key handler on unmount", async () => {
    const rendered = await renderSearch();
    if (!rendered) return;
    rendered.unmount();
    const slash = new KeyboardEvent("keydown", {
      key: "/",
      bubbles: true,
      cancelable: true,
    });

    document.dispatchEvent(slash);

    expect(slash.defaultPrevented).toBe(false);
  });
});
