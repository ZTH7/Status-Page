const millisecondsFormatter = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 2,
});

export function formatMilliseconds(value: number): string {
  return `${millisecondsFormatter.format(value)} ms`;
}

export function formatTimestamp(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}
