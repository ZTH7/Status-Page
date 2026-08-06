import type { MonitorConfig, SiteConfig } from "../../config/types";
import type { NotificationAction } from "../../domain/types";
import type { Env } from "../env";
import { sendDiscord, type DiscordEmbed } from "./discord";
import { sendSlack, type SlackBlock } from "./slack";
import { sendTelegram } from "./telegram";

type NotificationChannel = "slack" | "telegram" | "discord";

export interface NotificationDispatchResult {
  channel: NotificationChannel;
  status: "sent" | "skipped" | "failed";
  reason?: string;
}

export interface DispatchNotificationsInput {
  actions: readonly NotificationAction[];
  monitors: readonly MonitorConfig[];
  site: Pick<SiteConfig, "title" | "url" | "labels">;
  env: Pick<Env,
    | "SECRET_SLACK_WEBHOOK_URL"
    | "SECRET_TELEGRAM_API_TOKEN"
    | "SECRET_TELEGRAM_CHAT_ID"
    | "SECRET_DISCORD_WEBHOOK_URL"
  >;
  fetch: typeof fetch;
}

interface PresentedAction {
  label: string;
  emoji: "🟡" | "🟢";
  color: number;
  monitorName: string;
  method: string;
  monitorUrl: string;
  actionTime: string;
}

const CHANNELS: readonly NotificationChannel[] = ["slack", "telegram", "discord"];
const SEND_FAILED = "send-failed";
const YELLOW = 0xFEE75C;
const GREEN = 0x57F287;

export async function dispatchNotifications(
  input: DispatchNotificationsInput,
): Promise<NotificationDispatchResult[]> {
  try {
    const actions = presentActions(input.actions, input.monitors, input.site);
    if (actions.length === 0) {
      return skippedAll("no-actions");
    }

    const sends = [
      dispatchSlack(input, actions),
      dispatchTelegram(input, actions),
      dispatchDiscord(input, actions),
    ];
    const outcomes = await Promise.allSettled(sends);

    return outcomes.map((outcome, index) => {
      const channel = CHANNELS[index];
      if (channel === undefined) {
        return { channel: "slack", status: "failed", reason: SEND_FAILED };
      }
      if (outcome.status === "fulfilled") {
        return outcome.value;
      }
      return { channel, status: "failed", reason: SEND_FAILED };
    });
  } catch {
    return CHANNELS.map((channel) => ({ channel, status: "failed", reason: SEND_FAILED }));
  }
}

function presentActions(
  actions: readonly NotificationAction[],
  monitors: readonly MonitorConfig[],
  site: Pick<SiteConfig, "title" | "url" | "labels">,
): PresentedAction[] {
  const monitorsById = new Map(monitors.map((monitor) => [monitor.id, monitor]));

  return actions.flatMap((action) => {
    const monitor = monitorsById.get(action.monitorId);
    if (monitor === undefined) {
      return [];
    }

    const failure = action.type === "failure";
    return [{
      label: failure ? site.labels.degraded : site.labels.operational,
      emoji: failure ? "🟡" : "🟢",
      color: failure ? YELLOW : GREEN,
      monitorName: monitor.name,
      method: monitor.method,
      monitorUrl: monitor.url,
      actionTime: actionTime(action.at),
    }];
  });
}

function actionTime(at: number): string {
  try {
    return new Date(at).toISOString();
  } catch {
    return "unknown-time";
  }
}

async function dispatchSlack(
  input: DispatchNotificationsInput,
  actions: readonly PresentedAction[],
): Promise<NotificationDispatchResult> {
  const webhookUrl = input.env.SECRET_SLACK_WEBHOOK_URL;
  if (!configured(webhookUrl)) {
    return skipped("slack", "not-configured");
  }

  await sendSlack({ webhookUrl, blocks: slackBlocks(input.site, actions) }, input.fetch);
  return sent("slack");
}

async function dispatchTelegram(
  input: DispatchNotificationsInput,
  actions: readonly PresentedAction[],
): Promise<NotificationDispatchResult> {
  const token = input.env.SECRET_TELEGRAM_API_TOKEN;
  const chatId = input.env.SECRET_TELEGRAM_CHAT_ID;
  if (!configured(token) || !configured(chatId)) {
    return skipped("telegram", "not-configured");
  }

  await sendTelegram({ token, chatId, text: telegramText(input.site, actions) }, input.fetch);
  return sent("telegram");
}

async function dispatchDiscord(
  input: DispatchNotificationsInput,
  actions: readonly PresentedAction[],
): Promise<NotificationDispatchResult> {
  const webhookUrl = input.env.SECRET_DISCORD_WEBHOOK_URL;
  if (!configured(webhookUrl)) {
    return skipped("discord", "not-configured");
  }

  await sendDiscord({ webhookUrl, embeds: discordEmbeds(input.site, actions) }, input.fetch);
  return sent("discord");
}

function configured(value: string | undefined): value is string {
  return value !== undefined && value.trim().length > 0;
}

function slackBlocks(
  site: Pick<SiteConfig, "title" | "url">,
  actions: readonly PresentedAction[],
): SlackBlock[] {
  return actions.map((action) => ({
    type: "section",
    text: {
      type: "mrkdwn",
      text: `${action.emoji} *${escapeSlack(action.label)}*\n*Site:* ${slackSite(site)}\n*Monitor:* ${escapeSlack(action.monitorName)}\n*Method:* ${escapeSlack(action.method)}\n*Target:* ${escapeSlack(action.monitorUrl)}\n*Time:* ${escapeSlack(action.actionTime)}`,
    },
  }));
}

function slackSite(site: Pick<SiteConfig, "title" | "url">): string {
  const url = httpUrl(site.url);
  if (url === undefined) {
    return `${escapeSlack(site.title)} (${escapeSlack(site.url)})`;
  }

  return `<${escapeSlackLinkUrl(url)}|${escapeSlack(site.title)}>`;
}

function telegramText(
  site: Pick<SiteConfig, "title" | "url">,
  actions: readonly PresentedAction[],
): string {
  return actions.map((action) => [
    `<b>${escapeHtml(action.emoji)} ${escapeHtml(action.label)}</b>`,
    `<b>Site:</b> <a href="${escapeHtml(site.url)}">${escapeHtml(site.title)}</a>`,
    `<b>Monitor:</b> ${escapeHtml(action.monitorName)}`,
    `<b>Method:</b> ${escapeHtml(action.method)}`,
    `<b>Target:</b> ${escapeHtml(action.monitorUrl)}`,
    `<b>Time:</b> ${escapeHtml(action.actionTime)}`,
  ].join("\n")).join("\n\n");
}

function discordEmbeds(
  site: Pick<SiteConfig, "title" | "url">,
  actions: readonly PresentedAction[],
): DiscordEmbed[] {
  const siteUrl = httpUrl(site.url);
  const siteValue = siteUrl === undefined
    ? `${escapeDiscordMarkdown(site.title)} (${escapeDiscordMarkdown(site.url)})`
    : `[${escapeDiscordMarkdown(site.title)}](${escapeDiscordMarkdown(siteUrl)})`;

  return actions.map((action) => ({
    title: `${action.emoji} ${escapeDiscordMarkdown(action.label)}`,
    color: action.color,
    ...(siteUrl === undefined ? {} : { url: siteUrl }),
    fields: [
      { name: "Site", value: siteValue },
      { name: "Monitor", value: escapeDiscordMarkdown(action.monitorName) },
      { name: "Method", value: escapeDiscordMarkdown(action.method) },
      { name: "Target", value: escapeDiscordMarkdown(action.monitorUrl) },
      { name: "Time", value: escapeDiscordMarkdown(action.actionTime) },
    ],
  }));
}

function httpUrl(value: string): string | undefined {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return undefined;
    }
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function escapeSlack(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeSlackLinkUrl(value: string): string {
  return escapeSlack(value).replaceAll("|", "%7C");
}

function escapeDiscordMarkdown(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replace(/([`*_{}\[\]<>()[\]#!+\-|~])/g, "\\$1");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function sent(channel: NotificationChannel): NotificationDispatchResult {
  return { channel, status: "sent" };
}

function skipped(channel: NotificationChannel, reason: string): NotificationDispatchResult {
  return { channel, status: "skipped", reason };
}

function skippedAll(reason: string): NotificationDispatchResult[] {
  return CHANNELS.map((channel) => skipped(channel, reason));
}
