// Rule-based parser for spoken billing phrases (English, Hinglish, Devanagari).
// It handles the common patterns for free; only phrases it cannot read go to an LLM.

export interface ParsedItem {
  query: string;
  qty: number;
  unit: string | null; // kg, g, l, ml, pc, pack, dozen or null when not spoken
  confidence: 'high' | 'medium';
}

export interface ParseResult {
  items: ParsedItem[];
  unparsed: string[]; // segments the rules could not read
}

const DEVANAGARI_DIGITS = '०१२३४५६७८९';

const NUMBER_WORDS: Record<string, number> = {
  // english
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  half: 0.5,
  // hinglish
  ek: 1, do: 2, teen: 3, char: 4, chaar: 4, paanch: 5, panch: 5, chhe: 6, che: 6, chhah: 6,
  saat: 7, aath: 8, nau: 9, das: 10, aadha: 0.5, adha: 0.5, dedh: 1.5, dhai: 2.5, dhaai: 2.5,
  // devanagari
  एक: 1, दो: 2, तीन: 3, चार: 4, पांच: 5, पाँच: 5, छह: 6, सात: 7, आठ: 8, नौ: 9, दस: 10,
  आधा: 0.5, डेढ़: 1.5, ढाई: 2.5,
};

const UNIT_WORDS: Record<string, string> = {
  kg: 'kg', kilo: 'kg', kilos: 'kg', kilogram: 'kg', किलो: 'kg', केजी: 'kg',
  g: 'g', gm: 'g', gms: 'g', gram: 'g', grams: 'g', ग्राम: 'g',
  l: 'l', ltr: 'l', litre: 'l', liter: 'l', litres: 'l', liters: 'l', लीटर: 'l',
  ml: 'ml', मिलीलीटर: 'ml',
  packet: 'pack', packets: 'pack', pkt: 'pack', pack: 'pack', पैकेट: 'pack',
  piece: 'pc', pieces: 'pc', pcs: 'pc', pc: 'pc', nos: 'pc', नग: 'pc',
  dozen: 'dozen', दर्जन: 'dozen',
};

const STOPWORDS = new Set([
  'of', 'ka', 'ki', 'ke', 'ko', 'wala', 'wali', 'dena', 'dijiye', 'dedo', 'chahiye', 'please',
  'mujhe', 'add', 'aur', 'and', 'ek', 'का', 'की', 'के', 'को', 'दीजिए', 'चाहिए', 'मुझे',
]);

function normalize(text: string): string {
  let out = text.toLowerCase();
  out = out.replace(/[०-९]/g, (d) => String(DEVANAGARI_DIGITS.indexOf(d)));
  out = out.replace(/\bde\s+do\b/g, ' '); // "chini de do" = give (me) sugar, not "2"
  out = out.replace(/(\d+)\s*\/\s*(\d+)/g, (_, a, b) => String(Number(a) / Number(b)));
  out = out.replace(/[,;]+/g, ' | '); // keep item separators before stripping punctuation
  // \p{M} keeps Devanagari vowel signs (matras); stripping them mangles Hindi words.
  return out.replace(/[^\p{L}\p{M}\p{N}.|\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

function toNumber(token: string): number | null {
  if (/^\d+(\.\d+)?$/.test(token)) return Number(token);
  return NUMBER_WORDS[token] ?? null;
}

function parseSegment(segment: string): ParsedItem | null {
  const tokens = segment.split(' ').filter(Boolean);
  let qty: number | null = null;
  let unit: string | null = null;
  const rest: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!;
    const n: number | null = qty === null ? toNumber(tok) : null;
    if (n !== null) {
      const next = tokens[i + 1];
      const nextIsUnit = next !== undefined && UNIT_WORDS[next] !== undefined;
      // "ek"/"do" are also common words; accept as numbers only at an edge or before a unit.
      const ambiguous = tok === 'ek' || tok === 'do' || tok === 'एक' || tok === 'दो';
      if (!ambiguous || nextIsUnit || i === 0) {
        qty = n;
        if (nextIsUnit) {
          unit = UNIT_WORDS[next]!;
          i++;
        }
        continue;
      }
    }
    // A unit right after the product also works: "sugar 2 kg" handled above; "kg" alone:
    if (UNIT_WORDS[tok] !== undefined && unit === null && qty !== null) {
      unit = UNIT_WORDS[tok]!;
      continue;
    }
    if (!STOPWORDS.has(tok)) rest.push(tok);
  }

  // "1 dozen" -> 12 pieces
  if (unit === 'dozen' && qty !== null) {
    qty *= 12;
    unit = 'pc';
  }

  const query = rest.join(' ').trim();
  if (!query || /^\d+(\.\d+)?$/.test(query)) return null;
  return { query, qty: qty ?? 1, unit, confidence: qty === null ? 'medium' : 'high' };
}

export function parseVoiceText(text: string): ParseResult {
  const normalized = normalize(text);
  const segments = normalized
    .split(/\s+(?:aur|and|plus|और)\s+|\s*\|\s*/u)
    .map((s) => s.trim())
    .filter(Boolean);

  const items: ParsedItem[] = [];
  const unparsed: string[] = [];
  for (const seg of segments) {
    const parsed = parseSegment(seg);
    if (parsed) items.push(parsed);
    else unparsed.push(seg);
  }
  return { items, unparsed };
}
