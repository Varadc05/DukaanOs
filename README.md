# DukaanOS

AI-assisted billing and inventory for Indian kirana stores. Built for GAVS 2026 (Tech4Bharat PS 5.1:
kiranas tie up cash in dead stock while running out of what sells).

See [PROGRESS.md](PROGRESS.md) for exactly what is built and tested.

## Layout

- `supabase/migrations/`: schema, row-level security, atomic idempotent checkout
- `supabase/tests/`: SQL behaviour tests (RLS, idempotency, append-only, PO states)
- `supabase/seed.sql`: demo store, products, stock
- `backend/`: Node + TypeScript + Express API (billing, voice parsing, dashboard, forecasts, reorder suggestions)
- `mobile/`: Flutter Android app (offline-first billing)

## Run the backend tests

```bash
cd backend && npm install && npm test && npm run typecheck
```

## Run the backend against Supabase

1. Create a free Supabase project. Run `supabase/migrations/0001_core.sql`, `0002_views.sql`, then `0003_analytics.sql`.
2. Create two users in Authentication, put their ids into `supabase/seed.sql`, and run it.
3. `cp backend/.env.example backend/.env`, fill in `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`
   (server only; never in the app). `GEMINI_API_KEY` is optional.
4. `npm run dev`

## Design rules

- Money is integer paise; quantities are integer thousandths.
- Stock is never edited: it is the sum of the append-only `stock_movements` ledger.
- The AI only suggests. The backend prices every bill from its own database.
- Bills carry a client-generated UUID, so offline retries never double-count.
- Cashiers cannot see cost, profit, khata or purchase orders; this is enforced by RLS, not the app.
