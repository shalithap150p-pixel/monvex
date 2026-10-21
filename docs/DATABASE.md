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
