import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { parseConfigSources } from "../src/config/schema";
import type {
  AppConfig,
  ColorModePreference,
  PublicBuildConfig,
  ThemeId,
} from "../src/config/types";

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const publicDirectory = resolve(rootDirectory, "public");
const realPublicDirectory = realpathSync(publicDirectory);
const siteConfigVariable = "STATUS_SITE_CONFIG_YAML";
const monitorsConfigVariable = "STATUS_MONITORS_CONFIG_YAML";
const requirePrivateConfig = process.argv.includes("--require-private");

function readProjectFile(relativePath: string): string {
  return readFileSync(resolve(rootDirectory, relativePath), "utf8");
}

function nonEmptyEnvironmentValue(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value.trim().length === 0 ? undefined : value;
}

function configSources(): { siteSource: string; monitorsSource: string } {
  const siteFromEnvironment = nonEmptyEnvironmentValue(siteConfigVariable);
  const monitorsFromEnvironment = nonEmptyEnvironmentValue(monitorsConfigVariable);
  if (siteFromEnvironment !== undefined || monitorsFromEnvironment !== undefined) {
    if (siteFromEnvironment === undefined || monitorsFromEnvironment === undefined) {
      throw new Error(
        `${siteConfigVariable} and ${monitorsConfigVariable} must be configured together.`,
      );
    }
    return { siteSource: siteFromEnvironment, monitorsSource: monitorsFromEnvironment };
  }

  const localSitePath = "config/site.yaml";
  const localMonitorsPath = "config/monitors.yaml";
  const hasLocalSite = existsSync(resolve(rootDirectory, localSitePath));
  const hasLocalMonitors = existsSync(resolve(rootDirectory, localMonitorsPath));
  if (hasLocalSite || hasLocalMonitors) {
    if (!hasLocalSite || !hasLocalMonitors) {
      throw new Error(`${localSitePath} and ${localMonitorsPath} must both exist.`);
    }
    return {
      siteSource: readProjectFile(localSitePath),
      monitorsSource: readProjectFile(localMonitorsPath),
    };
  }

  if (requirePrivateConfig) {
    throw new Error(
      `Deployment requires ${siteConfigVariable} and ${monitorsConfigVariable} build secrets.`,
    );
  }

  return {
    siteSource: readProjectFile("config/site.example.yaml"),
    monitorsSource: readProjectFile("config/monitors.example.yaml"),
  };
}

function publicAssetExists(relativePath: string): boolean {
  const assetPath = resolve(publicDirectory, relativePath);
  try {
    const realAssetPath = realpathSync(assetPath);
    const assetPathRelativeToPublic = relative(realPublicDirectory, realAssetPath);
    return (
      assetPathRelativeToPublic !== "" &&
      assetPathRelativeToPublic !== ".." &&
      !assetPathRelativeToPublic.startsWith(`..${sep}`) &&
      statSync(realAssetPath).isFile()
    );
  } catch {
    return false;
  }
}

function writeGeneratedFile(relativePath: string, content: string): void {
  const outputPath = resolve(rootDirectory, relativePath);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, content, "utf8");
}

function typescriptExport(name: string, typeName: string, value: unknown): string {
  return `import type { ${typeName} } from "../config/types";\n\nexport const ${name}: ${typeName} = ${JSON.stringify(value, null, 2)};\n`;
}

function publicBuildConfig(appConfig: AppConfig): PublicBuildConfig {
  const { title, url, logo, theme, colorMode, historyDays, labels } = appConfig.site;
  return { title, url, logo, theme, colorMode, historyDays, labels };
}

interface GeneratedTheme {
  modulePath: `../../themes/${ThemeId}/index`;
}

const generatedThemes: Record<ThemeId, GeneratedTheme> = {
  default: { modulePath: "../../themes/default/index" },
  "stardew-inspired": { modulePath: "../../themes/stardew-inspired/index" },
};

function activeThemeSource(theme: ThemeId): string {
  return `export { theme as activeTheme } from ${JSON.stringify(generatedThemes[theme].modulePath)};\n`;
}

function themeBootstrap(theme: ThemeId, colorMode: ColorModePreference): string {
  return `(() => {
  const defaultPreference = ${JSON.stringify(colorMode)};
  let preference = defaultPreference;
  try {
    const storedPreference = window.localStorage.getItem("status-page-color-mode");
    if (storedPreference === "light" || storedPreference === "dark" || storedPreference === "system") {
      preference = storedPreference;
    }
  } catch {}
  const colorMode = preference === "system"
    ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : preference;
  document.documentElement.dataset.theme = ${JSON.stringify(theme)};
  document.documentElement.dataset.colorMode = colorMode;
})();
`;
}

const privateConfig = configSources();
const appConfig = parseConfigSources({
  siteSource: privateConfig.siteSource,
  monitorsSource: privateConfig.monitorsSource,
  wranglerConfig: JSON.parse(readProjectFile("wrangler.jsonc")),
  assetExists: publicAssetExists,
});
const publicConfig = publicBuildConfig(appConfig);

writeGeneratedFile(
  "src/generated/config.ts",
  typescriptExport("appConfig", "AppConfig", appConfig),
);
writeGeneratedFile(
  "src/generated/public-config.ts",
  typescriptExport("publicConfig", "PublicBuildConfig", publicConfig),
);
writeGeneratedFile("src/generated/active-theme.ts", activeThemeSource(appConfig.site.theme));
writeGeneratedFile(
  "public/theme-bootstrap.js",
  themeBootstrap(appConfig.site.theme, appConfig.site.colorMode),
);
