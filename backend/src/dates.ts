/** Calendar helpers on YYYY-MM-DD strings. Shops run on India time (UTC+5:30). */

export const istToday = (now: Date = new Date()): string =>
  new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Whole days from a to b (positive when b is later). */
export const daysBetween = (a: string, b: string): number =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
