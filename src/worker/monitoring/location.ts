const TRACE_URL = "https://www.cloudflare.com/cdn-cgi/trace";
const DEFAULT_TIMEOUT_MS = 1_500;
const COLO_PATTERN = /^[A-Z0-9]{3,8}$/;

export async function resolveLocation(
  fetcher: typeof fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetcher(TRACE_URL, { signal: controller.signal });
    if (!response.ok) {
      return "unknown";
    }

    const coloLine = (await response.text())
      .split(/\r?\n/)
      .find((line) => line.startsWith("colo="));
    const location = coloLine?.slice("colo=".length).trim();

    return location !== undefined && COLO_PATTERN.test(location) ? location : "unknown";
  } catch {
    return "unknown";
  } finally {
    clearTimeout(timer);
  }
}
