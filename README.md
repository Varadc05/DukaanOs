# DukaanOS

**Beyond billing. Smarter inventory. Better business decisions.**

An AI-assisted Android app that helps Indian kirana store owners bill customers by voice, barcode or tap, and turns every sale into stock, forecast and reorder decisions.

Built for **GAVS 2026** · Problem statement: **Tech4Bharat PS 5.1, "Kiranas tie up cash in dead stock while running out of what sells."**

Team: _add your names here_

---

## The problem

Most kirana stores track stock from memory and shelf checks. The result:

- Cash is trapped in slow-moving and expiring stock.
- Fast sellers run out, especially around festivals.
- Purchase decisions are guesses, made without sales records.
- Credit given to customers (khata) is not linked to how much the owner can spend on stock.

## The idea

A normal billing app only records sales. DukaanOS uses those same sales to tell the owner what to do next:

> "You have 4 packets of sunflower oil and sell about 2 a day. Order 8 more to last 5 days after delivery."

One cart takes **voice, barcode scan and manual search**. Every bill updates stock automatically. The owner then sees what is running low, what is about to expire, how much cash is stuck in dead stock, and a reorder list that fits their budget.

## Status

This is an early build. Here is exactly what works.

| Feature | Status |
| --- | --- |
| Secure multi-store database with owner and cashier roles | ✅ Built and tested |
| Billing API: server-side pricing, GST, discounts, offline-safe retries | ✅ Built and tested |
| Stock as an append-only ledger with batches and first-expiry-first-out | ✅ Built and tested |
| Voice phrase parsing (English, Hinglish, Hindi) and product matching | ✅ Built and tested |
| Sales dashboard data (today, 7 days, best sellers) | ✅ Built and tested |
| Low-stock, expiry and dead-stock detection (with cash tied up) | ✅ Built and tested |
| 7-day demand forecast with festival lift and confidence level | ✅ Built and tested |
| Budget-aware reorder suggestions with plain-language reasons | ✅ Built and tested |
| Add and edit products, receive stock, physical stock count (owner only, retry-safe) | ✅ Built and tested (API and database) |
| Cash-in-stock breakdown: expired, expiring, not selling, slow, selling well; adds up to the total | ✅ Built and tested |
| Flutter app: login, offline billing, barcode, voice, sync, dashboard, insights, products and stock screens, cash-in-stock screen | 🟡 Written, not yet compiled |
| Gemini language fallback for voice phrases the rules cannot read | 🟡 Written, not yet run against the live API |
| Push alerts, AI chat assistant, purchase-order screens, bill PDF, khata screens | ⬜ Planned |
| Sarvam speech-to-text, Tamil and Marathi interface | ⬜ Planned |

✅ = covered by automated tests (74 backend tests and a SQL behaviour suite run on Postgres 16). Details in [PROGRESS.md](PROGRESS.md).

## How it works

```
Flutter app  ──HTTPS──▶  Node/Express API  ──▶  Supabase (Postgres, Auth, RLS)
 offline SQLite           validates and prices    ├─ Gemini (voice fallback, optional)
 outbox + sync            everything              └─ forecasts, reorder logic
```

- **Offline first.** Bills are saved on the phone and synced later. Each bill has its own ID, so a retry never double-counts.
- **The AI only suggests.** The backend prices every bill from its own database, checks permissions and updates stock. Nothing an AI model or the app sends can change a price.
- **Voice, cheaply.** A rule parser reads common phrases like "do kilo chini" for free. An AI model is called only for phrases the rules cannot read, with a daily cap per store.
- **Honest forecasts.** New shops get a simple average marked "low confidence". Slow sellers use Croston's method. Festival lifts are applied and named.

## Security and privacy

- Row-level security isolates every store; cashiers cannot see cost, profit, khata or purchase orders.
- Money is stored as whole paise, and quantities as thousandths, so there are no rounding errors.
- Bills and the stock ledger cannot be edited or deleted; corrections are new reversing entries.
- Purchase-order approval rules are enforced in the database, and only the owner can approve.
- No AI or service keys in the app. Rate limits, request validation and security headers on the API.
- Voice audio is not stored, and customer details are never sent to AI services.

## Tech stack

Flutter · Node.js, TypeScript, Express · Supabase (PostgreSQL, Auth) · SQLite · Google ML Kit barcode scanning · Gemini API (optional) · Zod · Vitest

## Project layout

```
supabase/migrations/   schema, security rules, atomic checkout, analytics views
supabase/tests/        SQL behaviour tests (security, idempotency, approval rules, views)
supabase/seed.sql      demo store, products and stock
backend/               API, voice parser, matcher, forecasting, insights
mobile/                Flutter Android app
PROGRESS.md            what is built, tested and still to do
```

## Run it

**Backend tests (no accounts needed)**

```bash
cd backend
npm install
npm test
npm run typecheck
```

**Backend with a real database**

1. Create a free [Supabase](https://supabase.com) project. In the SQL editor run `0001_core.sql`, `0002_views.sql`, `0003_analytics.sql`, then `0004_stock_change.sql` from `supabase/migrations/`.
2. In Authentication, create an owner and a cashier. Put their IDs into `supabase/seed.sql` and run it.
3. `cp backend/.env.example backend/.env` and fill in `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. The service key belongs on the server only. `GEMINI_API_KEY` is optional.
4. `npm run dev`

**Mobile app** (needs the Flutter SDK; see [mobile/README.md](mobile/README.md))

```bash
cd mobile
flutter create . --platforms=android
flutter pub get
flutter run --dart-define=SUPABASE_URL=... --dart-define=SUPABASE_ANON_KEY=... --dart-define=API_URL=http://10.0.2.2:8080
```

## Roadmap

1. Compile and polish the Flutter app and run it end to end against a live Supabase project.
2. Push alerts for low stock and expiry.
3. Purchase orders with owner approval, supplier price comparison, goods received.
4. AI store assistant in Tamil, Hindi, Marathi and English, using fixed read-only business queries.
5. Sarvam speech-to-text for better Indian-language accuracy; bill PDFs; khata screens.
6. Collaborative purchasing and distributor integrations.

## Known limitations

- Festival dates and demand lifts in `backend/src/forecast.ts` are approximate starting points and need checking each year.
- Voice needs internet; barcode and manual billing work offline.
- The Supabase connection and the Flutter app have not yet been run end to end.
