import { describe, expect, it, vi } from "vitest";

import type { MonitorConfig, SiteConfig } from "../../src/config/types";
import type { NotificationAction } from "../../src/domain/types";
import { sendDiscord } from "../../src/worker/notifications/discord";
import { dispatchNotifications } from "../../src/worker/notifications";
import { sendSlack } from "../../src/worker/notifications/slack";
import { sendTelegram } from "../../src/worker/notifications/telegram";

const ACTION_TIME = Date.UTC(2026, 7, 5, 12, 34, 56);

function monitor(overrides: Partial<MonitorConfig> = {}): MonitorConfig {
  return {
    id: "api",
    name: "Public API",
    url: "https://api.example.test/health",
    linkable: true,
    method: "HEAD",
    expectStatus: 200,
    followRedirect: false,
    ...overrides,
  };
}

function site(overrides: Partial<SiteConfig> = {}): Pick<SiteConfig, "title" | "url" | "labels"> {
  return {
    title: "Example Status",
    url: "https://status.example.test",
    labels: {
      allOperational: "All systems operational",
      someDegraded: "Some services are degraded",
      someOutage: "Some services are unavailable",
      statusUnknown: "Status unknown",
      operational: "Operational now",
      degraded: "Degraded now",
      outage: "Outage",
      noData: "No data",
      searchPlaceholder: "Search",
      noServices: "No services",
      noMatches: "No matches",
      recentIncidents: "Incidents",
      noIncidents: "No incidents",
      lastChecked: "Last checked",
      responseTime: "Response time",
      location: "Location",
      historyStart: "History begins",
      today: "Today",
      startedAt: "Started",
      escalatedAt: "Escalated",
      recoveredAt: "Recovered",
      ongoing: "Ongoing",
    },
    ...overrides,
  };
}

function configuredEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    SECRET_SLACK_WEBHOOK_URL: "https://hooks.slack.test/services/private-slack",
    SECRET_TELEGRAM_API_TOKEN: "private-telegram-token",
    SECRET_TELEGRAM_CHAT_ID: "private-chat-id",
    SECRET_DISCORD_WEBHOOK_URL: "https://discord.test/api/webhooks/private-discord",
    ...overrides,
  };
}

function actions(...items: NotificationAction[]): readonly NotificationAction[] {
  return items;
}

function okFetch(): typeof fetch {
  return vi.fn(async () => new Response(null, { status: 204 })) as unknown as typeof fetch;
}

async function sentPayloads(fetcher: typeof fetch): Promise<Record<string, unknown>[]> {
  const calls = vi.mocked(fetcher).mock.calls;
  return calls.map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>);
}

describe("dispatchNotifications", () => {
  it("sends degraded failure aggregates with the exact degraded label and yellow channel presentations", async () => {
    const fetcher = okFetch();

    const result = await dispatchNotifications({
      actions: actions({ type: "failure", monitorId: "api", at: ACTION_TIME }),
      monitors: [monitor()],
      site: site(),
      env: configuredEnv(),
      fetch: fetcher,
    });

    expect(result).toEqual([
      { channel: "slack", status: "sent" },
      { channel: "telegram", status: "sent" },
      { channel: "discord", status: "sent" },
    ]);
    const [slack, telegram, discord] = await sentPayloads(fetcher);
    expect(JSON.stringify(slack)).toContain("Degraded now");
    expect(JSON.stringify(slack)).toContain("🟡");
    expect(JSON.stringify(telegram)).toContain("Degraded now");
    expect(JSON.stringify(telegram)).toContain("🟡");
    expect(JSON.stringify(discord)).toContain("Degraded now");
    expect(discord).toMatchObject({ embeds: [{ color: 0xFEE75C }] });
    expect(JSON.stringify([slack, telegram, discord])).not.toContain("Outage");
  });

  it("sends recovery aggregates with the exact operational label and green channel presentations", async () => {
    const fetcher = okFetch();

    await dispatchNotifications({
      actions: actions({ type: "recovery", monitorId: "api", at: ACTION_TIME }),
      monitors: [monitor()],
      site: site(),
      env: configuredEnv(),
      fetch: fetcher,
    });

    const [slack, telegram, discord] = await sentPayloads(fetcher);
    expect(JSON.stringify(slack)).toContain("Operational now");
    expect(JSON.stringify(slack)).toContain("🟢");
    expect(JSON.stringify(telegram)).toContain("Operational now");
    expect(JSON.stringify(telegram)).toContain("🟢");
    expect(discord).toMatchObject({ embeds: [{ color: 0x57F287 }] });
  });

  it("includes the monitor method and URL, action time, and site title and URL in every channel payload", async () => {
    const fetcher = okFetch();

    await dispatchNotifications({
      actions: actions({ type: "failure", monitorId: "api", at: ACTION_TIME }),
      monitors: [monitor()],
      site: site(),
      env: configuredEnv(),
      fetch: fetcher,
    });

    const payloads = await sentPayloads(fetcher);
    for (const payload of payloads) {
      const serialized = JSON.stringify(payload);
      expect(serialized).toContain("Public API");
      expect(serialized).toContain("HEAD");
      expect(serialized).toContain("https://api.example.test/health");
      expect(serialized).toContain(
        payload === payloads[2] ? "2026\\\\-08\\\\-05T12:34:56.000Z" : "2026-08-05T12:34:56.000Z",
      );
      expect(serialized).toContain("Example Status");
      expect(serialized).toContain("https://status.example.test");
    }
  });

  it("renders hostile dynamic values literally in Slack and Discord while preserving the validated site link", async () => {
    const fetcher = okFetch();

    await dispatchNotifications({
      actions: actions({ type: "failure", monitorId: "api", at: ACTION_TIME }),
      monitors: [monitor({
        name: "API <https://attacker.example|Injected> [replace](https://attacker.example) @everyone",
        url: "https://api.example.test/health",
      })],
      site: site({
        title: "Status <!channel> [replace](https://attacker.example) @everyone",
        url: "https://status.example.test/legitimate",
        labels: { ...site().labels, degraded: "Degraded <!channel>" },
      }),
      env: configuredEnv(),
      fetch: fetcher,
    });

    const [slack, telegram, discord] = await sentPayloads(fetcher);
    const slackText = String((slack as { blocks?: Array<{ text?: { text?: string } }> })
      .blocks?.[0]?.text?.text);
    expect(slackText).toContain("&lt;!channel&gt;");
    expect(slackText).toContain("&lt;https://attacker.example|Injected&gt;");
    expect(slackText).not.toContain("<!channel>");
    expect(slackText).toContain("<https://status.example.test/legitimate|");

    expect(telegram).toMatchObject({ parse_mode: "HTML" });
    const text = String(telegram?.text);
    expect(text).toContain("&lt;");
    expect(text).not.toContain("API <https://attacker.example|Injected>");

    const discordEmbed = (discord as {
      allowed_mentions?: { parse?: string[] };
      embeds?: Array<{ title?: string; url?: string; fields?: Array<{ name: string; value: string }> }>;
    }).embeds?.[0];
    const discordSite = discordEmbed?.fields?.find((field) => field.name === "Site")?.value ?? "";
    const discordMonitor = discordEmbed?.fields?.find((field) => field.name === "Monitor")?.value ?? "";
    expect(discord).toMatchObject({ allowed_mentions: { parse: [] } });
    expect(discordEmbed?.title).toContain("Degraded \\<\\!channel\\>");
    expect(discordEmbed?.url).toBe("https://status.example.test/legitimate");
    expect(discordSite).toContain("\\[replace\\]");
    expect(discordSite).toContain("(https://status.example.test/legitimate)");
    expect(discordSite).not.toContain("](https://attacker.example)");
    expect(discordMonitor).toContain("\\[replace\\]");
    expect(discordMonitor).not.toContain("<https://attacker.example|Injected>");
    expect(JSON.stringify(discord)).toContain("https://api.example.test/health");
  });

  it("omits active Slack and Discord site links for an invalid site URL while keeping it literal", async () => {
    const fetcher = okFetch();

    await dispatchNotifications({
      actions: actions({ type: "failure", monitorId: "api", at: ACTION_TIME }),
      monitors: [monitor()],
      site: site({ title: "Example Status", url: "javascript:alert(1)" }),
      env: configuredEnv(),
      fetch: fetcher,
    });

    const [slack, , discord] = await sentPayloads(fetcher);
    const slackText = String((slack as { blocks?: Array<{ text?: { text?: string } }> })
      .blocks?.[0]?.text?.text);
    const discordEmbed = (discord as {
      embeds?: Array<{ url?: string; fields?: Array<{ name: string; value: string }> }>;
    }).embeds?.[0];
    const discordSite = discordEmbed?.fields?.find((field) => field.name === "Site")?.value ?? "";

    expect(slackText).not.toContain("<javascript:alert(1)|");
    expect(slackText).toContain("javascript:alert(1)");
    expect(discordEmbed?.url).toBeUndefined();
    expect(discordSite).toContain("javascript:alert\\(1\\)");
  });

  it.each([
    ["missing Slack secret", { SECRET_SLACK_WEBHOOK_URL: undefined }],
    ["partial Telegram secrets", { SECRET_TELEGRAM_CHAT_ID: "" }],
    ["missing Discord secret", { SECRET_DISCORD_WEBHOOK_URL: undefined }],
  ] as const)("skips a %s without calling its fetch", async (_name, overrides) => {
    const fetcher = okFetch();

    const result = await dispatchNotifications({
      actions: actions({ type: "failure", monitorId: "api", at: ACTION_TIME }),
      monitors: [monitor()],
      site: site(),
      env: configuredEnv(overrides),
      fetch: fetcher,
    });

    expect(result.filter((item) => item.status === "skipped")).toEqual([
      expect.objectContaining({ status: "skipped", reason: "not-configured" }),
    ]);
    expect(vi.mocked(fetcher)).toHaveBeenCalledTimes(2);
  });

  it("allows other channels to send when one channel returns non-2xx", async () => {
    const fetcher = vi.fn(async (url: RequestInfo | URL) => new Response(null, {
      status: String(url).includes("slack") ? 500 : 204,
    })) as unknown as typeof fetch;

    await expect(dispatchNotifications({
      actions: actions({ type: "failure", monitorId: "api", at: ACTION_TIME }),
      monitors: [monitor()],
      site: site(),
      env: configuredEnv(),
      fetch: fetcher,
    })).resolves.toEqual([
      { channel: "slack", status: "failed", reason: "send-failed" },
      { channel: "telegram", status: "sent" },
      { channel: "discord", status: "sent" },
    ]);
    expect(vi.mocked(fetcher)).toHaveBeenCalledTimes(3);
  });

  it("isolates synchronous and rejected fetch exceptions without returning their values", async () => {
    const secretError = "private exception with https://private.example/token";
    const fetcher = vi.fn((url: RequestInfo | URL) => {
      if (String(url).includes("slack")) throw new Error(secretError);
      if (String(url).includes("telegram")) return Promise.reject(new Error(secretError));
      return Promise.resolve(new Response(null, { status: 204 }));
    }) as unknown as typeof fetch;

    const result = await dispatchNotifications({
      actions: actions({ type: "failure", monitorId: "api", at: ACTION_TIME }),
      monitors: [monitor()],
      site: site(),
      env: configuredEnv(),
      fetch: fetcher,
    });

    expect(result).toEqual([
      { channel: "slack", status: "failed", reason: "send-failed" },
      { channel: "telegram", status: "failed", reason: "send-failed" },
      { channel: "discord", status: "sent" },
    ]);
    expect(JSON.stringify(result)).not.toContain(secretError);
    expect(JSON.stringify(result)).not.toContain("private-telegram-token");
  });

  it("treats a false response ok value as failure without reading its body or leaking it", async () => {
    const body = "private response body";
    const fetcher = vi.fn(async (url: RequestInfo | URL) => new Response(
      String(url).includes("slack") ? body : null,
      { status: String(url).includes("slack") ? 500 : 204 },
    )) as unknown as typeof fetch;

    const result = await dispatchNotifications({
      actions: actions({ type: "failure", monitorId: "api", at: ACTION_TIME }),
      monitors: [monitor()],
      site: site(),
      env: configuredEnv(),
      fetch: fetcher,
    });

    expect(result[0]).toEqual({ channel: "slack", status: "failed", reason: "send-failed" });
    expect(JSON.stringify(result)).not.toContain(body);
  });

  it.each([
    ["an unknown monitor", actions({ type: "failure", monitorId: "unknown", at: ACTION_TIME })],
    ["no actions", actions()],
  ] as const)("skips every channel safely for %s", async (_name, notificationActions) => {
    const fetcher = okFetch();

    const result = await dispatchNotifications({
      actions: notificationActions,
      monitors: [monitor()],
      site: site(),
      env: configuredEnv(),
      fetch: fetcher,
    });

    expect(result).toEqual([
      { channel: "slack", status: "skipped", reason: "no-actions" },
      { channel: "telegram", status: "skipped", reason: "no-actions" },
      { channel: "discord", status: "skipped", reason: "no-actions" },
    ]);
    expect(vi.mocked(fetcher)).not.toHaveBeenCalled();
  });
});

describe("channel senders", () => {
  it.each([
    [
      "Slack synchronous exception",
      () => sendSlack(
        { webhookUrl: "https://hooks.slack.test/private", blocks: [] },
        vi.fn(() => { throw new Error("private Slack URL and response"); }) as unknown as typeof fetch,
      ),
    ],
    [
      "Telegram rejected exception",
      () => sendTelegram(
        { token: "private-token", chatId: "private-chat", text: "message" },
        vi.fn(() => Promise.reject(new Error("private Telegram token"))) as unknown as typeof fetch,
      ),
    ],
    [
      "Discord non-2xx response",
      () => sendDiscord(
        { webhookUrl: "https://discord.test/private", embeds: [] },
        vi.fn(async () => new Response("private Discord response", { status: 500 })) as unknown as typeof fetch,
      ),
    ],
  ] as const)("rejects %s with a constant safe error", async (_name, send) => {
    const rejection = await send().catch((error: unknown) => error);

    expect(rejection).toBeInstanceOf(Error);
    expect((rejection as Error).message).toBe("notification-send-failed");
    expect(JSON.stringify(rejection)).not.toContain("private");
  });
});
