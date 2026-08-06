export interface TelegramPayload {
  token: string;
  chatId: string;
  text: string;
}

const SEND_FAILED = "notification-send-failed";

export async function sendTelegram(payload: TelegramPayload, fetcher: typeof fetch): Promise<void> {
  try {
    const response = await fetcher(`https://api.telegram.org/bot${payload.token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: payload.chatId,
        text: payload.text,
        parse_mode: "HTML",
      }),
    });

    if (!response.ok) {
      throw new Error(SEND_FAILED);
    }
  } catch {
    throw new Error(SEND_FAILED);
  }
}
