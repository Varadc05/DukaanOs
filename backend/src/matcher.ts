export interface CatalogueProduct {
  id: string;
  name: string;
  barcode: string | null;
  unit: string;
  sellPaise: number;
  gstRate: number;
  aliases: string[];
}

export interface Candidate {
  productId: string;
  name: string;
  score: number;
}

export interface MatchResult {
  decision: 'auto' | 'confirm' | 'none';
  candidates: Candidate[]; // best first, at most 3
}

const clean = (s: string) =>
  s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = temp;
    }
  }
  return prev[b.length]!;
}

const similarity = (a: string, b: string): number => {
  const longest = Math.max(a.length, b.length);
  return longest === 0 ? 1 : 1 - levenshtein(a, b) / longest;
};

/** How well a spoken query matches one name: whole-string similarity or token coverage. */
function scoreName(query: string, name: string): number {
  const q = clean(query);
  const n = clean(name);
  if (!q || !n) return 0;
  if (q === n) return 1;

  const qTokens = q.split(' ');
  const nTokens = n.split(' ');
  const covered = qTokens.filter((qt) =>
    nTokens.some((nt) => nt === qt || (qt.length >= 4 && similarity(qt, nt) >= 0.75)),
  ).length;
  const coverage = covered / qTokens.length;
  const tokenScore = coverage * (qTokens.length === nTokens.length ? 1 : 0.9);

  return Math.max(similarity(q, n), tokenScore);
}

export function matchProduct(query: string, catalogue: CatalogueProduct[]): MatchResult {
  const scored: Candidate[] = catalogue
    .map((p) => ({
      productId: p.id,
      name: p.name,
      score: Math.max(scoreName(query, p.name), ...p.aliases.map((a) => scoreName(query, a))),
    }))
    .filter((c) => c.score >= 0.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  const top = scored[0];
  if (!top) return { decision: 'none', candidates: [] };
  const second = scored[1];
  const clearWinner = !second || top.score - second.score >= 0.1;
  return { decision: top.score >= 0.85 && clearWinner ? 'auto' : 'confirm', candidates: scored };
}
