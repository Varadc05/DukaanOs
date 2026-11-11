import 'dotenv/config';
import { createApp } from './app.js';
import { GeminiExtractor } from './llm.js';
import { SupabaseRepo } from './repo.supabase.js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (see .env.example)');
  process.exit(1);
}

const repo = new SupabaseRepo(url, key);
const llm = process.env.GEMINI_API_KEY
  ? new GeminiExtractor(process.env.GEMINI_API_KEY, process.env.GEMINI_MODEL)
  : undefined;

const app = createApp({
  repo,
  authenticate: (token) => repo.getUserIdFromToken(token),
  llm,
  llmDailyCapPerStore: Number(process.env.LLM_DAILY_CAP_PER_STORE ?? 200),
});

const port = Number(process.env.PORT ?? 8080);
app.listen(port, () => console.log(`DukaanOS API listening on :${port}`));
