import { mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
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

function readProjectFile(relativePath: string): string {
  return readFileSync(resolve(rootDirectory, relativePath), "utf8");
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
    const storedPreference = window.localStorage.getItem("cfstatuspage-color-mode");
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

const appConfig = parseConfigSources({
  siteSource: readProjectFile("config/site.yaml"),
  monitorsSource: readProjectFile("config/monitors.yaml"),
  wranglerConfig: JSON.parse(readProjectFile("wrangler.jsonc")),
  assetExists: publicAssetExists,
});
const publicConfig = publicBuildConfig(appConfig);

writeGeneratedFile("src/generated/config.ts", typescriptExport("appConfig", "AppConfig", appConfig));
writeGeneratedFile(
  "src/generated/public-config.ts",
  typescriptExport("publicConfig", "PublicBuildConfig", publicConfig),
);
writeGeneratedFile("src/generated/active-theme.ts", activeThemeSource(appConfig.site.theme));
writeGeneratedFile("public/theme-bootstrap.js", themeBootstrap(appConfig.site.theme, appConfig.site.colorMode));
