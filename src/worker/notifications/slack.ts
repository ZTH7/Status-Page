export interface SlackBlock {
  type: "section";
  text: {
    type: "mrkdwn";
    text: string;
  };
}

export interface SlackPayload {
  webhookUrl: string;
  blocks: readonly SlackBlock[];
}

const SEND_FAILED = "notification-send-failed";

export async function sendSlack(payload: SlackPayload, fetcher: typeof fetch): Promise<void> {
  try {
    const response = await fetcher(payload.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blocks: payload.blocks }),
    });

    if (!response.ok) {
      throw new Error(SEND_FAILED);
    }
  } catch {
    throw new Error(SEND_FAILED);
  }
}
