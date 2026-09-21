function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function mostRecentMonday(now: Date): Date {
  const result = startOfUtcDay(now);
  const daysSinceMonday = (result.getUTCDay() + 6) % 7;
  result.setUTCDate(result.getUTCDate() - daysSinceMonday);
  return result;
}

export function resolveQuestionSince(
  question: string,
  explicitSince: string | null = null,
  now = new Date(),
): string | null {
  if (explicitSince) {
    const parsed = new Date(explicitSince);
    if (!Number.isFinite(parsed.getTime())) {
      throw new Error("since must be a valid ISO timestamp");
    }
    return parsed.toISOString();
  }

  const normalized = question.toLowerCase();
  if (/since monday|from monday/.test(normalized)) {
    return mostRecentMonday(now).toISOString();
  }
  if (/since yesterday|from yesterday/.test(normalized)) {
    const result = startOfUtcDay(now);
    result.setUTCDate(result.getUTCDate() - 1);
    return result.toISOString();
  }
  if (/since today|from today/.test(normalized)) {
    return startOfUtcDay(now).toISOString();
  }
  const days = normalized.match(/(?:last|past|since)\s+(\d{1,3})\s+days?/);
  if (days) {
    const count = Math.min(365, Math.max(1, Number(days[1])));
    return new Date(now.getTime() - count * 24 * 60 * 60 * 1_000).toISOString();
  }
  const date = normalized.match(/(?:since|from)\s+(\d{4}-\d{2}-\d{2})/);
  if (date) {
    const parsed = new Date(`${date[1]}T00:00:00Z`);
    if (Number.isFinite(parsed.getTime())) return parsed.toISOString();
  }
  return null;
}
