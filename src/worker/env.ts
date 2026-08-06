export interface Env extends Cloudflare.Env {
  DB: D1Database;
  SECRET_SLACK_WEBHOOK_URL?: string;
  SECRET_TELEGRAM_API_TOKEN?: string;
  SECRET_TELEGRAM_CHAT_ID?: string;
  SECRET_DISCORD_WEBHOOK_URL?: string;
}
