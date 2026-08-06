export interface DiscordEmbed {
  title: string;
  color: number;
  url?: string;
  fields: readonly {
    name: string;
    value: string;
  }[];
}

export interface DiscordPayload {
  webhookUrl: string;
  embeds: readonly DiscordEmbed[];
}

const SEND_FAILED = "notification-send-failed";

export async function sendDiscord(payload: DiscordPayload, fetcher: typeof fetch): Promise<void> {
  try {
    const response = await fetcher(payload.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        embeds: payload.embeds,
        allowed_mentions: { parse: [] },
      }),
    });

    if (!response.ok) {
      throw new Error(SEND_FAILED);
    }
  } catch {
    throw new Error(SEND_FAILED);
  }
}
