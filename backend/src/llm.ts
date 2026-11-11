import { z } from 'zod';
import type { ParsedItem } from './parser.js';

/** The model only ever returns this shape. It never sees prices, stock or customer data. */
const llmItemsSchema = z.object({
  items: z
    .array(
      z.object({
        query: z.string().min(1).max(80),
        qty: z.number().positive().max(10_000),
        unit: z.enum(['kg', 'g', 'l', 'ml', 'pc', 'pack']).nullable(),
      }),
    )
    .max(30),
});

export interface LlmExtractor {
  extract(text: string): Promise<ParsedItem[]>;
}

/**
 * Gemini fallback for phrases the rule parser could not read.
 * NOTE: not yet exercised against the live API (needs GEMINI_API_KEY).
 */
export class GeminiExtractor implements LlmExtractor {
  constructor(
    private apiKey: string,
    private model = 'gemini-2.5-flash-lite',
  ) {}

  async extract(text: string): Promise<ParsedItem[]> {
    const prompt =
      'Extract shop billing items from this spoken phrase (English, Hindi, Tamil or Marathi, ' +
      'possibly mixed). Return product name as spoken (transliterated to Latin letters), a ' +
      'numeric quantity and unit (kg, g, l, ml, pc, pack, or null). Phrase: ' +
      JSON.stringify(text.slice(0, 300));

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0 },
        }),
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!res.ok) throw new Error(`LLM request failed: ${res.status}`);

    const body = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const raw = body.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';
    // Treat model output as untrusted: parse and validate strictly.
    const parsed = llmItemsSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) throw new Error('LLM returned an invalid shape');
    return parsed.data.items.map((i) => ({ ...i, confidence: 'medium' as const }));
  }
}
