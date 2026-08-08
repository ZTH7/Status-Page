import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { stringify } from "yaml";
import { describe, expect, it } from "vitest";

import { parseConfigSources } from "../../src/config/schema";

const labels = {
  allOperational: "All Systems Operational",
  someDegraded: "Some Systems Are Degraded",
  someOutage: "Some Systems Are Unavailable",
  statusUnknown: "Status Is Temporarily Unknown",
  operational: "Operational",
  degraded: "Degraded",
  outage: "Outage",
  noData: "No data",
  searchPlaceholder: "Search services",
  noServices: "No services are configured.",
  noMatches: "No services match your search.",
  recentIncidents: "Recent incidents",
  noIncidents: "No recent incidents.",
  lastChecked: "Last checked",
  responseTime: "Response time",
  location: "Check location",
  historyStart: "{days} days ago",
  today: "Today",
  startedAt: "First failure",
  escalatedAt: "Outage began",
  recoveredAt: "Recovered",
  ongoing: "Ongoing",
};

const site = {
  title: "Example Status",
  url: "https://status.example.test",
  logo: "/logo.svg",
  theme: "default",
  labels,
};

const monitor = {
  id: "api",
  name: "Example API",
  url: "https://api.example.test/health",
  linkable: true,
  method: "GET",
  expectStatus: 200,
  followRedirect: false,
};

function sources(
  overrides: {
    site?: Record<string, unknown>;
    monitors?: Record<string, unknown>[];
    crons?: string[];
    assets?: string[];
  } = {},
) {
  const assets = new Set(overrides.assets ?? ["logo.svg"]);

  return {
    siteSource: stringify({ ...site, ...overrides.site }),
    monitorsSource: stringify({ monitors: overrides.monitors ?? [monitor] }),
    wranglerConfig: {
      triggers: { crons: overrides.crons ?? ["* * * * *"] },
    },
    assetExists(relativePath: string) {
      return assets.has(relativePath);
    },
  };
}

function sourcesWithDuplicateIds() {
  return sources({ monitors: [monitor, { ...monitor, name: "Second API" }] });
}

function sourcesWithCrons(crons: string[]) {
  return sources({ crons });
}

function sourcesWithLogo(logo: string) {
  return sources({ site: { logo } });
}

function generatorEnvironment(
  siteOverrides: Record<string, unknown> = {},
  monitors: Record<string, unknown>[] = [monitor],
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    STATUS_SITE_CONFIG_YAML: stringify({ ...site, ...siteOverrides }),
    STATUS_MONITORS_CONFIG_YAML: stringify({ monitors }),
  };
}

function runConfigGenerator(environment = generatorEnvironment()): void {
  execFileSync("npm", ["run", "config:generate"], {
    cwd: process.cwd(),
    env: environment,
    stdio: "pipe",
  });
}

describe("public branding and deployment entrypoint", () => {
  it("uses the neutral Status Page name and a square text-free logo", () => {
    const html = readFileSync("index.html", "utf8");
    const logo = readFileSync("public/logo.svg", "utf8");
    const favicon = readFileSync("public/favicon.svg", "utf8");

    expect(html).toContain("<title>Status Page</title>");
    expect(`${html}${logo}${favicon}`).not.toMatch(/CF Status/i);
    for (const asset of [logo, favicon]) {
      expect(asset).toContain('viewBox="0 0 48 48"');
      expect(asset).toContain('aria-label="Status Page"');
      expect(asset).not.toContain("<text");
    }
  });

  it("builds, deploys, and initializes an automatically provisioned D1 database", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      name: string;
      scripts: Record<string, string>;
    };
    const wranglerConfig = readFileSync("wrangler.jsonc", "utf8");
    const deployWorkflow = readFileSync(".github/workflows/deploy.yml", "utf8");

    expect(packageJson.name).toBe("status-page");
    expect(packageJson.scripts.deploy).toBe(
      "npm run config:require && vite build && wrangler deploy && npm run db:setup",
    );
    expect(packageJson.scripts["db:setup"]).toContain(
      "d1 execute DB --remote --file database/schema.sql --yes",
    );
    expect(wranglerConfig).toContain('"name": "status-page"');
    expect(wranglerConfig).toContain('"database_name": "status-page"');
    expect(wranglerConfig).toContain('"global_fetch_strictly_public"');
    expect(wranglerConfig).toContain('"*/5 * * * *"');
    expect(wranglerConfig).not.toContain('"database_id"');
    expect(deployWorkflow).toContain("STATUS_SITE_CONFIG_YAML");
    expect(deployWorkflow).toContain("STATUS_MONITORS_CONFIG_YAML");
    expect(deployWorkflow).toContain("npm run build");
    expect(deployWorkflow).toContain("d1 execute DB --remote --file database/schema.sql --yes");
    expect(`${wranglerConfig}${deployWorkflow}`).not.toMatch(/cfstatuspage/i);
  });
});

describe("parseConfigSources", () => {
  it("normalizes omitted site and monitor defaults", () => {
    expect(parseConfigSources(sources())).toEqual({
      site: {
        title: "Example Status",
        url: "https://status.example.test",
        logo: "/logo.svg",
        theme: "default",
        colorMode: "system",
        historyDays: 90,
        requestTimeoutSeconds: 10,
        userAgent: "StatusPage/2",
        thresholds: {
          degradedAfterFailures: 2,
          outageAfterMinutes: 60,
          recoverAfterSuccesses: 2,
        },
        labels,
      },
      monitors: [
        {
          id: "api",
          name: "Example API",
          url: "https://api.example.test/health",
          linkable: true,
          method: "GET",
          expectStatus: 200,
          followRedirect: false,
        },
      ],
    });
  });

  it.each([
    ["duplicate monitor IDs", sourcesWithDuplicateIds()],
    ["invalid monitor ID", sources({ monitors: [{ ...monitor, id: "Invalid_ID" }] })],
    [
      "non-HTTP monitor URL",
      sources({ monitors: [{ ...monitor, url: "ftp://api.example.test" }] }),
    ],
    ["non-HTTP site URL", sources({ site: { url: "mailto:ops@example.test" } })],
    ["site timeout below one second", sources({ site: { requestTimeoutSeconds: 0 } })],
    [
      "monitor timeout above 60 seconds",
      sources({ monitors: [{ ...monitor, timeoutSeconds: 61 }] }),
    ],
    ["status code below 100", sources({ monitors: [{ ...monitor, expectStatus: 99 }] })],
    ["status code above 599", sources({ monitors: [{ ...monitor, expectStatus: 600 }] })],
    ["zero site threshold", sources({ site: { thresholds: { degradedAfterFailures: 0 } } })],
    [
      "negative monitor threshold",
      sources({
        monitors: [{ ...monitor, thresholds: { outageAfterMinutes: -1 } }],
      }),
    ],
    ["unsupported theme", sources({ site: { theme: "ocean" } })],
    ["unsupported method", sources({ monitors: [{ ...monitor, method: "POST" }] })],
    ["missing logo", sourcesWithLogo("/missing.svg")],
    [
      "missing presentation logo",
      sources({ monitors: [{ ...monitor, presentationLogo: "/missing.svg" }] }),
    ],
    ["unsupported cadence", sourcesWithCrons(["*/2 * * * *"])],
    ["multiple monitor Crons", sourcesWithCrons(["* * * * *", "*/5 * * * *"])],
    [
      "more than 25 monitors",
      sources({
        monitors: Array.from({ length: 26 }, (_, index) => ({
          ...monitor,
          id: `api-${index}`,
        })),
      }),
    ],
    ["history window below one day", sources({ site: { historyDays: 0 } })],
    ["site timeout equals cadence", sources({ site: { requestTimeoutSeconds: 60 } })],
    ["monitor timeout equals cadence", sources({ monitors: [{ ...monitor, timeoutSeconds: 60 }] })],
    ["user agent with line break", sources({ site: { userAgent: "Status\nInjected" } })],
    [
      "unsupported label interpolation",
      sources({
        site: { labels: { ...labels, historyStart: "{weeks} weeks ago" } },
      }),
    ],
  ])("rejects %s", (_name, invalidSources) => {
    expect(() => parseConfigSources(invalidSources)).toThrow();
  });
});

describe("config generator", () => {
  it("uses injected private YAML and emits deterministic public artifacts without monitor targets", () => {
    runConfigGenerator();
    const firstRun = [
      readFileSync("src/generated/config.ts", "utf8"),
      readFileSync("src/generated/public-config.ts", "utf8"),
      readFileSync("public/theme-bootstrap.js", "utf8"),
    ];

    runConfigGenerator();
    const secondRun = [
      readFileSync("src/generated/config.ts", "utf8"),
      readFileSync("src/generated/public-config.ts", "utf8"),
      readFileSync("public/theme-bootstrap.js", "utf8"),
    ];

    expect(secondRun).toEqual(firstRun);
    expect(firstRun[0]).toContain("https://api.example.test/health");
    expect(firstRun[1]).toContain("Example Status");
    expect(firstRun[1]).not.toContain("https://api.example.test/health");
    expect(firstRun[2]).not.toContain("https://api.example.test/health");
    expect(`${firstRun[1]}${firstRun[2]}`).not.toMatch(/SECRET_|WEBHOOK/i);
  });

  it("selects the injected Stardew theme in every generated theme artifact", () => {
    runConfigGenerator(generatorEnvironment({ theme: "stardew-inspired" }));

    expect(readFileSync("src/generated/public-config.ts", "utf8")).toContain(
      '"theme": "stardew-inspired"',
    );
    expect(readFileSync("src/generated/active-theme.ts", "utf8").trim()).toBe(
      'export { theme as activeTheme } from "../../themes/stardew-inspired/index";',
    );
    expect(readFileSync("public/theme-bootstrap.js", "utf8")).toContain(
      'dataset.theme = "stardew-inspired"',
    );
  });

  it("rejects a partially configured build secret pair", () => {
    expect(() =>
      runConfigGenerator({
        ...process.env,
        STATUS_SITE_CONFIG_YAML: stringify(site),
        STATUS_MONITORS_CONFIG_YAML: "",
      }),
    ).toThrow();
  });

  it("rejects a public asset symlink that resolves outside public", () => {
    let publicFixtureDirectory: string | undefined;
    let externalDirectory: string | undefined;

    try {
      publicFixtureDirectory = mkdtempSync("public/.config-test-assets-");
      externalDirectory = mkdtempSync(join(tmpdir(), "status-page-config-assets-"));
      const externalAsset = join(externalDirectory, "outside-logo.svg");
      const linkedAsset = join(publicFixtureDirectory, "linked-logo.svg");
      const configuredLogo = `/${basename(publicFixtureDirectory)}/linked-logo.svg`;
      writeFileSync(externalAsset, "outside public", "utf8");
      symlinkSync(externalAsset, linkedAsset);

      expect(() => runConfigGenerator(generatorEnvironment({ logo: configuredLogo }))).toThrow();
    } finally {
      if (publicFixtureDirectory) {
        rmSync(publicFixtureDirectory, { recursive: true, force: true });
      }
      if (externalDirectory) {
        rmSync(externalDirectory, { recursive: true, force: true });
      }
    }
  });

  it("rejects a directory configured as a public asset", () => {
    let assetDirectory: string | undefined;

    try {
      assetDirectory = mkdtempSync("public/.config-test-assets-");
      const configuredLogo = `/${basename(assetDirectory)}`;

      expect(() => runConfigGenerator(generatorEnvironment({ logo: configuredLogo }))).toThrow();
    } finally {
      if (assetDirectory) {
        rmSync(assetDirectory, { recursive: true, force: true });
      }
    }
  });
});
