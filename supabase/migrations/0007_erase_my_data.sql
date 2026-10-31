-- "Start fresh": lets a signed-in user permanently erase ALL of their own finance records.
--
-- * Only ever touches rows whose user_id = auth.uid(); nobody can erase someone else's data.
-- * Requires the exact confirmation phrase, so a stray call cannot wipe anything.
-- * Child tables are deleted before their parents (the composite foreign keys forbid the reverse).
-- * Keeps the account itself, the profile, the currency and the theme.
-- * Keeps sync_ops_applied (just operation ids, no data): another device that still holds old
--   offline changes cannot bring erased records back, because those operations are "duplicates".
-- * The audit log is erased too. Otherwise it would keep a copy of every erased record
--   (the delete triggers write the old row into it). It is only reachable through this function.
-- * Evidence files live in Storage and are removed by the app (Storage API) before this runs.

create or replace function public.erase_my_data(p_confirm text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  t text;
  n bigint;
  v_counts jsonb := '{}'::jsonb;
  -- children first, parents last
  v_tables text[] := array[
    'payroll_deductions', 'evidence_attachments',
    'savings_allocations', 'savings_goals',
    'debt_repayments', 'personal_debts',
    'receivable_repayments', 'loans_receivable',
    'pass_through_legs', 'pass_through_transfers',
    'internal_transfers', 'transactions',
    'payment_occurrences', 'payment_obligations',
    'salary_advances', 'budgets',
    'balance_reconciliations', 'forecast_snapshots',
    'bank_account_details',
    'finance_accounts', 'transaction_categories'
  ];
begin
  if v_uid is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  if p_confirm is distinct from 'ERASE ALL MY DATA' then
    raise exception 'Confirmation phrase is missing or wrong. Nothing was erased.' using errcode = '22023';
  end if;

  -- Salary / Safe-to-Spend settings go back to their starting values (currency and theme stay).
  update public.user_preferences
     set payday_date = null,
         expected_salary = null,
         salary_frequency = 'monthly',
         salary_account_id = null,
         essential_daily_amount = 0,
         safety_buffer = 0,
         safe_to_spend_period_days = 30,
         carry_forward_allowance = true
   where user_id = v_uid;

  foreach t in array v_tables loop
    execute format('delete from public.%I where user_id = $1', t) using v_uid;
    get diagnostics n = row_count;
    v_counts := v_counts || jsonb_build_object(t, n);
  end loop;

  -- Last, so the rows written by the delete triggers above are removed as well.
  delete from public.audit_log where user_id = v_uid;
  get diagnostics n = row_count;
  v_counts := v_counts || jsonb_build_object('audit_log', n);

  return v_counts;
end $$;

revoke all on function public.erase_my_data(text) from public, anon;
grant execute on function public.erase_my_data(text) to authenticated;
