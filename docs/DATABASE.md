# MONVEX database notes

All tables live in `public`, are owned by `user_id` (defaults to `auth.uid()`), have RLS **enabled and forced**, and carry `created_at`, `updated_at`, `deleted_at` (soft delete). Money columns are `numeric(18,3)`.

## Relationships

```
auth.users ─┬─ profiles, user_preferences
            ├─ finance_accounts ◄─┬─ transactions ──► transaction_categories
            │                     ├─ internal_transfers (source, destination)
            │                     ├─ pass_through_transfers ◄─ pass_through_legs
            │                     ├─ loans_receivable ◄─ receivable_repayments
            │                     ├─ personal_debts ◄─ debt_repayments
            │                     ├─ salary_advances ◄─ payroll_deductions ─► transactions
            │                     ├─ savings_goals ◄─ savings_allocations
            │                     └─ balance_reconciliations
            ├─ payment_obligations ◄─ payment_occurrences ◄─ transactions.occurrence_id
            ├─ budgets ─► transaction_categories
            ├─ evidence_attachments ─► (transaction | transfer | pass-through | bill | loan | debt | advance)
            └─ forecast_snapshots, audit_log (read-only for users), sync_ops_applied
```

## Design decisions

- **Composite foreign keys `(id, user_id)`** make it impossible to reference another user's row, even with a forged id.
- **Bill payments** are transactions with `occurrence_id`; paid amounts are derived from them, and a trigger refuses over-payment.
- **Occurrences** are unique per `(obligation, due_date)` with deterministic ids, so two devices generating them cannot create duplicates.
- **Sync**: the client queues operations with stable ids; `sync_apply(ops)` (security invoker, so RLS applies) is idempotent by op id and reports a conflict when the server row is newer than the version the client edited.
- **Storage**: private `evidence` bucket, objects under `<user id>/…`, JPEG/PNG/WebP/PDF ≤ 10 MB; access only through short-lived signed URLs.
- **Audit**: every write is recorded in `audit_log`; users can read but not modify it.
- `supabase/tests/migrations.test.ts` runs the migrations in PGlite and checks RLS isolation, cross-tenant FK blocking, over-payment refusal, sync idempotency/conflicts and storage policies. `registry-contract.test.ts` checks that every column the app sends exists and every required column is sent.

## Smart Safe-to-Spend (migration `0005`)

Additive, optional columns only — existing rows keep working:

| Table | Column | Meaning |
| --- | --- | --- |
| `budgets` | `essential` | Essential spending (food, transport…). Covers part of the "daily essentials" reserve so it is not reserved twice. |
| `payment_obligations` | `category_id` | Expense category of a bill. If that category has a budget the bill counts **inside** the budget. |
| `savings_goals` | `priority` | `high` / `medium` / `low` — weights the suggested monthly savings. |
| `savings_goals` | `monthly_contribution` | The monthly amount the user **approved**. Only reserved in Safe-to-Spend; MONVEX never moves money. |

Run `0005` in the SQL editor **before** using the new fields: `sync_apply` ignores unknown columns, so values saved earlier would not reach the server (and a later pull would overwrite them locally).

### How the flexible pool is calculated (`src/domain/safeToSpend.ts`)

```
pool = available funds                        (active accounts − money held for others)
     − unpaid bills and debts due before the window ends
     − remaining category budgets             (limit − posted spending this month; bills inside a budgeted category count once)
     − essentials not covered by essential budgets
     − pending expenses not already inside a budget
     − money already set aside for reserved goals + approved monthly contributions
     − safety buffer
```

Expected salary and receivables are never added. Daily allowance = pool at start of day ÷ days left; unspent money stays in the pool (nothing is discarded at midnight). `src/domain/smartSafeToSpend.test.ts` covers the rules and the 14 edge cases.
