-- Row Level Security: every user-owned table is locked to its owner.
-- No policy is ever "using (true)". Anonymous users get nothing.

do $$
declare
  t text;
  owned text[] := array[
    'finance_accounts','transaction_categories','payment_obligations','payment_occurrences',
    'transactions','internal_transfers','pass_through_transfers','pass_through_legs',
    'loans_receivable','receivable_repayments','personal_debts','debt_repayments',
    'salary_advances','payroll_deductions','budgets','savings_goals','savings_allocations',
    'evidence_attachments','balance_reconciliations','forecast_snapshots',
    'user_preferences','sync_ops_applied'
  ];
begin
  foreach t in array owned loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (user_id = (select auth.uid()))', t || '_select_own', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (user_id = (select auth.uid()))', t || '_insert_own', t);
    execute format('create policy %I on public.%I for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t || '_update_own', t);
    execute format('create policy %I on public.%I for delete to authenticated using (user_id = (select auth.uid()))', t || '_delete_own', t);
  end loop;
end $$;

-- profiles: keyed by user_id; users can read and edit only their own row.
alter table public.profiles enable row level security;
alter table public.profiles force row level security;
create policy profiles_select_own on public.profiles for select to authenticated using (user_id = (select auth.uid()));
create policy profiles_insert_own on public.profiles for insert to authenticated with check (user_id = (select auth.uid()));
create policy profiles_update_own on public.profiles for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- audit_log: owners may read their history; nobody can alter it through the API.
alter table public.audit_log enable row level security;
alter table public.audit_log force row level security;
create policy audit_log_select_own on public.audit_log for select to authenticated using (user_id = (select auth.uid()));

-- Table privileges: signed-in users only; never anon.
revoke all on all tables in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke insert, update, delete on public.audit_log from authenticated;
grant select on public.audit_log to authenticated;
revoke delete on public.profiles from authenticated;
