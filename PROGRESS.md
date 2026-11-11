# DukaanOS: build progress

_Last updated: 2026-11-11_

Legend: ✅ built and tested here · 🟡 written, not run against the real service · ⬜ not started

## Done

| Area | Status | Evidence |
| --- | --- | --- |
| Database schema (stores, roles, catalogue, batches, bills, ledger, khata, suppliers, POs, forecasts) | ✅ | Applied to a real Postgres 16 and exercised by `supabase/tests/rls_and_checkout.sql` |
| Row-level security (store isolation, owner vs cashier) | ✅ | SQL test: cashier cannot see cost, khata or POs; another store's owner sees nothing |
| Append-only bills and stock ledger | ✅ | SQL test: update and delete rejected |
| Atomic, idempotent checkout (`checkout_bill`) | ✅ | SQL test: retry creates no second bill and no double stock deduction |
| Purchase-order approval state machine in the database | ✅ | SQL test: illegal transitions rejected, only the owner approves |
| Analytics views (daily sales, daily totals, inventory snapshot with cash tied up) | ✅ | SQL tests; app roles are blocked from reading them |
| Money in integer paise, GST, discount sharing | ✅ | Unit tests |
| Voice phrase parser (English, Hinglish, Devanagari) | ✅ | Unit tests |
| Catalogue matcher (typos, aliases, confirm vs auto) | ✅ | Unit tests |
| FEFO batch allocation, expired stock skipped, negative stock flagged | ✅ | Unit tests |
| `POST /v1/bills` (server prices, roles, cashier discount limit, idempotency, cross-store block) | ✅ | API tests |
| `POST /v1/voice/parse` (rules first, LLM only for leftovers, daily cap) | ✅ | API tests with a fake LLM |
| 7-day forecast (moving average, exponential smoothing, Croston SBA, festival lift, confidence) | ✅ | Unit tests. Festival dates and uplifts are approximate and need checking |
| Low-stock, expiry and dead-stock detection with cash tied up | ✅ | Unit tests |
| Budget-aware reorder suggestions with a plain-language reason | ✅ | Unit tests (trimming, deferring, pack rounding, estimated cost flag) |
| `GET /v1/stores/:id/dashboard` (members) and `/insights` (owner only) | ✅ | API tests |
| Backend hardening (helmet, rate limit, Zod, body limit) | ✅ | In `app.ts` |
| Supabase repo (production storage, paged reads) | 🟡 | Typechecks; never run against a live Supabase project |
| Gemini fallback extractor | 🟡 | Output validation tested with a fake; the real API was never called |
| Flutter app: login, catalogue cache, cart, manual + barcode + voice billing, offline outbox, sync | 🟡 | **Never compiled** (no Flutter SDK in this workspace). Expect small compile fixes |
| Flutter sales dashboard and owner insights screens | 🟡 | Same: written, not compiled |

Totals: 48 backend tests passing, TypeScript typecheck clean, SQL behaviour tests passing on Postgres 16.

## Not started

- ⬜ Push notifications for low stock and expiry (the data exists; sending does not)
- ⬜ AI sales assistant (chat)
- ⬜ Purchase order screens and approval flow in the app (database rules exist)
- ⬜ Bill PDF and sharing
- ⬜ Khata screens
- ⬜ Catalogue management screens (add product, receive stock)
- ⬜ Sarvam speech-to-text (voice uses the phone's built-in recogniser for now)
- ⬜ Tamil and Marathi interface strings
- ⬜ Nightly job that stores forecasts in the `forecasts` table (forecasts are computed on request instead)

## Known gaps before real shops use it

- No screen to add products or receive stock; use `supabase/seed.sql` or the Supabase table editor.
- Returns and voids are designed (reversal rows) but not implemented.
- First run against a real Supabase project may need small fixes in `repo.supabase.ts`.
- Rate limiting is in memory, which is fine for a single server instance.
- Forecasts use at most 56 days of history and are low confidence for shops under 4 weeks old; the app says so.

## Run it

See `README.md`. Backend: `cd backend && npm install && npm test`. SQL tests: apply the three migrations and
`supabase/tests/rls_and_checkout.sql` (with `stub_auth.sql` first if you are not on Supabase) to a scratch Postgres.
