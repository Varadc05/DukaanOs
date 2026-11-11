import { addDays } from './dates.js';

export interface Festival {
  name: string;
  start: string; // first day of the demand lift (includes the run-up)
  end: string;
  uplift: number; // 1.4 = 40% more than normal
}

/**
 * Demand lifts around festivals. DATES AND UPLIFTS ARE APPROXIMATE STARTING POINTS: lunar
 * festival dates shift every year, so check them and let each shop tune the numbers.
 */
export const FESTIVALS: Festival[] = [
  { name: 'Diwali', start: '2026-11-03', end: '2026-11-08', uplift: 1.5 },
  { name: 'Pongal', start: '2027-01-11', end: '2027-01-16', uplift: 1.4 },
  { name: 'Holi', start: '2027-03-18', end: '2027-03-22', uplift: 1.3 },
  { name: 'Eid al-Fitr', start: '2027-03-06', end: '2027-03-10', uplift: 1.4 },
  { name: 'Ganesh Chaturthi', start: '2027-09-01', end: '2027-09-06', uplift: 1.3 },
  { name: 'Diwali', start: '2027-10-24', end: '2027-10-29', uplift: 1.5 },
];

export type Method = 'none' | 'moving-average' | 'exp-smoothing' | 'croston-sba';
export type Confidence = 'low' | 'medium' | 'high';

export interface Forecast {
  baseDailyMilli: number; // normal daily demand before any festival lift
  dailyMilli: number[]; // next 7 days, festival lift applied
  totalMilli: number;
  method: Method;
  confidence: Confidence;
  festival: string | null;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

function exponentialSmoothing(series: number[], alpha = 0.3): number {
  let level = mean(series.slice(0, 7));
  for (const x of series) level = alpha * x + (1 - alpha) * level;
  return level;
}

/** Croston with the Syntetos-Boylan bias correction: for items that sell on few days. */
export function crostonSba(series: number[], alpha = 0.1): number {
  const demands = series.filter((x) => x > 0);
  if (demands.length === 0) return 0;
  // Warm start from the whole history. Starting from "days until the first sale" would
  // overstate the rate whenever the first sale happens to come late.
  let z = mean(demands); // smoothed size of a sale
  let p = series.length / demands.length; // smoothed days between sales
  let gap = 1;
  for (const x of series) {
    if (x > 0) {
      z = alpha * x + (1 - alpha) * z;
      p = alpha * gap + (1 - alpha) * p;
      gap = 1;
    } else {
      gap++;
    }
  }
  return (1 - alpha / 2) * (z / p);
}

/**
 * 7-day forecast from daily sales (oldest first, ending yesterday).
 *  - under 28 days of history: moving average, always low confidence
 *  - sells on under half the days: Croston SBA
 *  - otherwise: exponential smoothing
 */
export function forecast7(series: number[], today: string, festivals: Festival[] = FESTIVALS): Forecast {
  const n = series.length;
  const sold = series.filter((x) => x > 0).length;

  let base = 0;
  let method: Method = 'none';
  let confidence: Confidence = 'low';

  if (n > 0 && sold > 0) {
    if (n < 28) {
      base = mean(series.slice(-14));
      method = 'moving-average';
    } else if (sold / n < 0.5) {
      base = crostonSba(series);
      method = 'croston-sba';
      confidence = n >= 56 && sold >= 8 ? 'medium' : 'low';
    } else {
      base = exponentialSmoothing(series);
      method = 'exp-smoothing';
      const avg = mean(series);
      const variance = mean(series.map((x) => (x - avg) ** 2));
      const cv = avg > 0 ? Math.sqrt(variance) / avg : Infinity;
      confidence = n >= 56 && cv < 0.8 ? 'high' : 'medium';
    }
  }

  let festivalName: string | null = null;
  const dailyMilli = Array.from({ length: 7 }, (_, i) => {
    const day = addDays(today, i);
    let lift = 1;
    for (const f of festivals) {
      if (day >= f.start && day <= f.end && f.uplift > lift) {
        lift = f.uplift;
        festivalName = f.name;
      }
    }
    return Math.round(base * lift);
  });

  return {
    baseDailyMilli: Math.round(base),
    dailyMilli,
    totalMilli: dailyMilli.reduce((s, x) => s + x, 0),
    method,
    confidence,
    festival: festivalName,
  };
}

/** Daily quantities for the `n` days before `today`, zero-filled, oldest first. */
export function buildSeries(
  sales: { day: string; qtyMilli: number }[],
  today: string,
  n: number,
): number[] {
  const byDay = new Map<string, number>();
  for (const s of sales) byDay.set(s.day, (byDay.get(s.day) ?? 0) + s.qtyMilli);
  return Array.from({ length: n }, (_, i) => byDay.get(addDays(today, i - n)) ?? 0);
}
