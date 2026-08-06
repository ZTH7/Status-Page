export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function listUtcDays(endMs: number, count: number): string[] {
  if (!Number.isInteger(count) || count <= 0) {
    throw new RangeError("count must be a positive integer.");
  }

  const end = new Date(endMs);
  const cursor = new Date(Date.UTC(
    end.getUTCFullYear(),
    end.getUTCMonth(),
    end.getUTCDate(),
  ));
  cursor.setUTCDate(cursor.getUTCDate() - count + 1);

  const days: string[] = [];
  for (let index = 0; index < count; index += 1) {
    days.push(utcDay(cursor.getTime()));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}
