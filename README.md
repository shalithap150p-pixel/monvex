# MONVEX — Master Your Money

A personal finance intelligence PWA: accounts, transactions, internal transfers, pass-through money held for others, loans & debts, bills, salary advances, a payday planner, an explainable Safe-to-Spend engine, 30/60/90-day forecasts, budgets & goals, reports, and a private evidence vault. Offline-first (Dexie + idempotent sync) on top of Supabase (Auth + Postgres RLS + private Storage).

Stack: React 19, TypeScript, Vite, Tailwind CSS v4, React Router, Dexie, Recharts, Supabase, vite-plugin-pwa, Vitest.

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
```

Without Supabase variables the app shows a setup screen and a clearly-labelled **demo mode** (sample data stored only in this browser, never synced).

### Connect Supabase

1. Create a project at supabase.com.
2. Run `supabase/migrations/0001_schema.sql` → `0005_smart_safe_to_spend.sql` in order (SQL editor or `supabase db push`).
3. `cp .env.example .env.local` and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
4. In Auth settings add your site URL (local + deployed) as a redirect URL.
5. `npm run dev`, create an account, sign in.

### Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run build` | Typecheck + production build (+ service worker) |
| `npm run typecheck` / `npm run lint` | `tsc -b` / oxlint |
| `npm test` | Domain, data-layer, SQL/RLS (PGlite) and mapper-contract tests |

### Deploy

`vercel.json` rewrites all routes to the SPA and adds basic security headers. Set the two `VITE_` variables in the host's environment settings.

## Money rules that the code enforces

- Money is an integer in minor units in the app and `numeric(18,3)` in Postgres — never a float.
- Opening balances, transfers, pass-through money, loans, debt principal and salary advances are **not** income or expense. Debt interest, fees and transfer fees are expenses.
- Salary received after an advance deduction is counted once: recognised income = cash received + payroll deductions.
- Expected salary is a forecast only. Paid bills leave the forecast; every scheduled item has one id so it is never counted twice.
- Net savings (income − expenses) and projected closing balance are separate numbers.
- The app never pays anything, and never stores bank passwords, PINs or OTPs.

## Where things live

- `src/domain/` — pure, tested finance logic (ledger, bills, forecast, Safe-to-Spend, salary, savings, sync, validation).
- `src/data/` — Dexie store, record ↔ row mapper, sync engine, demo seed.
- `src/app/`, `src/ui/`, `src/forms/`, `src/pages/` — shell, design system, forms, screens.
- `supabase/migrations/` — schema, RLS, sync RPC, storage policies; `supabase/tests/` — executed against PGlite.
- `docs/DATABASE.md` — table relationships and design notes.

## Backup & recovery

Settings → **Export backup (JSON)** downloads every record (amounts in minor units). Cloud data lives in your Supabase project: enable its daily backups / point-in-time recovery for the production project.

## Known limits

- Forecast snapshots / forecast-accuracy reporting are not implemented in the UI (the table exists in the schema).
- Evidence uploads need a connection; they are not queued offline.
- Multi-currency totals are not converted; each account keeps its own currency.
