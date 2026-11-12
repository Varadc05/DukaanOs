import express, { type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { ZodError, z } from 'zod';
import { checkout } from './checkout.js';
import { addDays, istToday } from './dates.js';
import { buildInsights } from './insights.js';
import { HttpError } from './errors.js';
import type { LlmExtractor } from './llm.js';
import { matchProduct } from './matcher.js';
import { convertQty, toMilli } from './money.js';
import { parseVoiceText, type ParsedItem } from './parser.js';
import type { Repo } from './repo.js';
import { adjustStock, createProduct, receiveStock, requireOwner, updateProduct } from './stock.js';
import { buildWorkingCapital } from './workingCapital.js';

export interface AppDeps {
  repo: Repo;
  /** Verifies the bearer token and returns the user id, or null. */
  authenticate: (token: string) => Promise<string | null>;
  llm?: LlmExtractor;
  llmDailyCapPerStore?: number;
  /** Injectable clock, for tests. */
  now?: () => Date;
}

type AuthedRequest = Request & { userId: string };

const voiceSchema = z.object({
  store_id: z.string().uuid(),
  text: z.string().min(1).max(500),
});

export function createApp(deps: AppDeps) {
  const app = express();
  app.disable('x-powered-by');
  // Behind a hosting proxy (Render, Railway, Fly) every request arrives from the proxy's address.
  // Without this the per-IP rate limit would throttle all users together.
  if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1);
  app.use(helmet());
  app.use(express.json({ limit: '100kb' }));
  app.use(rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false }));

  const llmUsage = new Map<string, { day: string; count: number }>();
  const llmAllowed = (storeId: string) => {
    const cap = deps.llmDailyCapPerStore ?? 200;
    const day = new Date().toISOString().slice(0, 10);
    const entry = llmUsage.get(storeId);
    if (!entry || entry.day !== day) {
      llmUsage.set(storeId, { day, count: 1 });
      return true;
    }
    if (entry.count >= cap) return false;
    entry.count++;
    return true;
  };

  app.get('/v1/health', (_req, res) => {
    res.json({ ok: true });
  });

  const auth = async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const header = req.header('authorization') ?? '';
      const token = header.startsWith('Bearer ') ? header.slice(7) : '';
      const userId = token ? await deps.authenticate(token) : null;
      if (!userId) throw new HttpError(401, 'unauthorized', 'Sign in again');
      (req as AuthedRequest).userId = userId;
      next();
    } catch (e) {
      next(e);
    }
  };

  // Create a bill. Idempotent on body.id, so offline retries are safe.
  app.post('/v1/bills', auth, async (req, res, next) => {
    try {
      const result = await checkout(deps.repo, (req as AuthedRequest).userId, req.body, istToday(deps.now?.()), deps.now?.() ?? new Date());
      res.status(result.duplicate ? 200 : 201).json(result);
    } catch (e) {
      next(e);
    }
  });

  // Turn a spoken phrase (already transcribed) into SUGGESTED cart lines.
  // Suggestions only: the app shows them for confirmation, and /v1/bills re-prices everything.
  app.post('/v1/voice/parse', auth, async (req, res, next) => {
    try {
      const { store_id, text } = voiceSchema.parse(req.body);
      const userId = (req as AuthedRequest).userId;
      if (!(await deps.repo.getRole(store_id, userId))) {
        throw new HttpError(403, 'not_a_member', 'You do not belong to this store');
      }

      const rules = parseVoiceText(text);
      let items: ParsedItem[] = rules.items;
      let usedLlm = false;

      if (rules.unparsed.length > 0 && deps.llm && llmAllowed(store_id)) {
        try {
          // Send only the unreadable fragments, never customer data.
          items = items.concat(await deps.llm.extract(rules.unparsed.join(', ')));
          usedLlm = true;
        } catch {
          // Fall through: unparsed fragments are returned for manual entry.
        }
      }

      const catalogue = await deps.repo.listCatalogue(store_id);
      const suggestions = items.map((item) => {
        const match = matchProduct(item.query, catalogue);
        const best = match.candidates[0];
        const product = best ? catalogue.find((p) => p.id === best.productId) : undefined;
        const qty =
          product && item.unit ? convertQty(item.qty, item.unit, product.unit) : item.qty;
        return {
          heard: item.query,
          qty_milli: qty === null ? null : toMilli(qty ?? item.qty),
          unit: product?.unit ?? item.unit,
          decision: qty === null ? 'confirm' : match.decision,
          candidates: match.candidates,
        };
      });

      res.json({ suggestions, unparsed: usedLlm ? [] : rules.unparsed, used_llm: usedLlm });
    } catch (e) {
      next(e);
    }
  });

  const storeParam = z.object({ storeId: z.string().uuid() });

  // Today's takings, the last 7 days, and best sellers. Any member of the store may read it.
  app.get('/v1/stores/:storeId/dashboard', auth, async (req, res, next) => {
    try {
      const { storeId } = storeParam.parse(req.params);
      if (!(await deps.repo.getRole(storeId, (req as AuthedRequest).userId))) {
        throw new HttpError(403, 'not_a_member', 'You do not belong to this store');
      }
      const today = istToday(deps.now?.());
      const since = addDays(today, -6);
      const [totals, sales, inventory] = await Promise.all([
        deps.repo.getDayTotals(storeId, since),
        deps.repo.getDailySales(storeId, since),
        deps.repo.getInventory(storeId),
      ]);
      const names = new Map(inventory.map((r) => [r.productId, r]));
      const qty = new Map<string, number>();
      for (const s of sales) qty.set(s.productId, (qty.get(s.productId) ?? 0) + s.qtyMilli);
      const top = [...qty.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([id, q]) => ({ product_id: id, name: names.get(id)?.name ?? 'Unknown', unit: names.get(id)?.unit ?? '', qty_milli: q }));
      const todayRow = totals.find((t) => t.day === today);
      res.json({
        as_of: today,
        today: { total_paise: todayRow?.totalPaise ?? 0, bills: todayRow?.bills ?? 0 },
        last_7_days: Array.from({ length: 7 }, (_, i) => {
          const day = addDays(since, i);
          const t = totals.find((x) => x.day === day);
          return { day, total_paise: t?.totalPaise ?? 0, bills: t?.bills ?? 0 };
        }),
        top_sellers: top,
      });
    } catch (e) {
      next(e);
    }
  });

  const insightsQuery = z.object({
    budget_paise: z.coerce.number().int().min(0).max(100_000_000).optional(),
    lead_days: z.coerce.number().int().min(0).max(30).default(2),
  });

  // Low stock, expiry, dead stock, 7-day forecasts and budget-aware reorder lines.
  // Owner only: it reveals cost and cash tied up.
  app.get('/v1/stores/:storeId/insights', auth, async (req, res, next) => {
    try {
      const { storeId } = storeParam.parse(req.params);
      const role = await deps.repo.getRole(storeId, (req as AuthedRequest).userId);
      if (!role) throw new HttpError(403, 'not_a_member', 'You do not belong to this store');
      if (role !== 'owner') throw new HttpError(403, 'owner_only', 'Only the owner can see this');
      const q = insightsQuery.parse(req.query);
      const today = istToday(deps.now?.());
      const [inventory, sales] = await Promise.all([
        deps.repo.getInventory(storeId),
        deps.repo.getDailySales(storeId, addDays(today, -56)),
      ]);
      res.json(buildInsights(inventory, sales, { today, budgetPaise: q.budget_paise ?? null, leadDays: q.lead_days }));
    } catch (e) {
      next(e);
    }
  });

  // ---------- catalogue and stock management (owner writes, any member reads) ----------

  const productParam = z.object({ storeId: z.string().uuid(), productId: z.string().uuid() });

  // Product list with stock on hand. No cost or margin here, so cashiers may read it.
  app.get('/v1/stores/:storeId/products', auth, async (req, res, next) => {
    try {
      const { storeId } = storeParam.parse(req.params);
      if (!(await deps.repo.getRole(storeId, (req as AuthedRequest).userId))) {
        throw new HttpError(403, 'not_a_member', 'You do not belong to this store');
      }
      const [catalogue, inventory] = await Promise.all([deps.repo.listCatalogue(storeId), deps.repo.getInventory(storeId)]);
      const qty = new Map(inventory.map((r) => [r.productId, r.qtyMilli]));
      res.json({
        products: catalogue
          .map((p) => ({
            id: p.id,
            name: p.name,
            barcode: p.barcode,
            unit: p.unit,
            pack_size_milli: p.packSizeMilli ?? 1000,
            gst_rate: p.gstRate,
            mrp_paise: p.mrpPaise ?? 0,
            sell_paise: p.sellPaise,
            aliases: p.aliases,
            qty_milli: qty.get(p.id) ?? 0,
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      });
    } catch (e) {
      next(e);
    }
  });

  app.post('/v1/stores/:storeId/products', auth, async (req, res, next) => {
    try {
      const { storeId } = storeParam.parse(req.params);
      res.status(201).json(await createProduct(deps.repo, storeId, (req as AuthedRequest).userId, req.body));
    } catch (e) {
      next(e);
    }
  });

  app.patch('/v1/stores/:storeId/products/:productId', auth, async (req, res, next) => {
    try {
      const { storeId, productId } = productParam.parse(req.params);
      res.json(await updateProduct(deps.repo, storeId, (req as AuthedRequest).userId, productId, req.body));
    } catch (e) {
      next(e);
    }
  });

  // Goods arrived. Idempotent on body.id.
  app.post('/v1/stores/:storeId/stock/receive', auth, async (req, res, next) => {
    try {
      const { storeId } = storeParam.parse(req.params);
      const r = await receiveStock(deps.repo, storeId, (req as AuthedRequest).userId, req.body, istToday(deps.now?.()));
      res.status(r.duplicate ? 200 : 201).json(r);
    } catch (e) {
      next(e);
    }
  });

  // Physical count: send what is really on the shelf, the backend writes the difference.
  app.post('/v1/stores/:storeId/stock/adjust', auth, async (req, res, next) => {
    try {
      const { storeId } = storeParam.parse(req.params);
      const r = await adjustStock(deps.repo, storeId, (req as AuthedRequest).userId, req.body);
      res.status(r.applied ? 201 : 200).json(r);
    } catch (e) {
      next(e);
    }
  });

  const capitalQuery = z.object({ budget_paise: z.coerce.number().int().min(0).max(100_000_000).optional() });

  // Where the shop's cash is sitting: five buckets that add up to the total stock value. Owner only.
  app.get('/v1/stores/:storeId/working-capital', auth, async (req, res, next) => {
    try {
      const { storeId } = storeParam.parse(req.params);
      await requireOwner(deps.repo, storeId, (req as AuthedRequest).userId);
      const q = capitalQuery.parse(req.query);
      const today = istToday(deps.now?.());
      const [inventory, sales] = await Promise.all([
        deps.repo.getInventory(storeId),
        deps.repo.getDailySales(storeId, addDays(today, -56)),
      ]);
      const capital = buildWorkingCapital(inventory, sales, { today });
      const needed = buildInsights(inventory, sales, { today, budgetPaise: null }).reorder.total_paise;
      res.json({
        ...capital,
        reorder_needed_paise: needed,
        // Only the owner knows the cash in hand, so we never guess it.
        budget_paise: q.budget_paise ?? null,
        headroom_paise: q.budget_paise === undefined ? null : q.budget_paise - needed,
      });
    } catch (e) {
      next(e);
    }
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.code, message: err.message });
    } else if (err instanceof ZodError) {
      res.status(400).json({ error: 'bad_request', issues: err.issues });
    } else if (
      typeof err === 'object' && err !== null && 'status' in err &&
      typeof (err as { status: unknown }).status === 'number' &&
      (err as { status: number }).status >= 400 && (err as { status: number }).status < 500
    ) {
      // Errors raised by the JSON body parser: malformed JSON (400), body too large (413).
      const status = (err as { status: number }).status;
      res.status(status).json({
        error: status === 413 ? 'payload_too_large' : 'bad_request',
        message: status === 413 ? 'Request is too large' : 'Request could not be read',
      });
    } else {
      console.error(err);
      res.status(500).json({ error: 'internal', message: 'Something went wrong' });
    }
  });

  return app;
}
