-- Fix: reconciliations could never be saved on the server.
--
-- sync_apply inserted with "select *", which also tries to write generated columns.
-- balance_reconciliations.difference is generated, and PostgreSQL refuses any value for it
-- ("cannot insert a non-DEFAULT value into column difference"), so every reconciliation
-- stayed "failed" in the sync queue. The function now lists only the writable columns.
-- Everything else about sync_apply (allow-list, idempotency, conflicts, RLS) is unchanged.

create or replace function public.sync_apply(
  p_op_id uuid,
  p_table text,
  p_type text,
  p_record_id uuid,
  p_base timestamptz,
  p_record jsonb
) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_allowed text[] := array[
    'finance_accounts','transaction_categories','payment_obligations','payment_occurrences',
    'transactions','internal_transfers','pass_through_transfers','pass_through_legs',
    'loans_receivable','receivable_repayments','personal_debts','debt_repayments',
    'salary_advances','payroll_deductions','budgets','savings_goals','savings_allocations',
    'balance_reconciliations','bank_account_details'
  ];
  v_current timestamptz;
  v_sets text;
  v_cols text;
  v_new timestamptz;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not (p_table = any (v_allowed)) then raise exception 'table "%" cannot be synced', p_table; end if;
  if p_type not in ('upsert','delete') then raise exception 'unknown operation type "%"', p_type; end if;

  begin
    insert into public.sync_ops_applied (user_id, op_id) values (v_uid, p_op_id);
  exception when unique_violation then
    return jsonb_build_object('status','duplicate');
  end;

  execute format('select updated_at from public.%I where id = $1', p_table) into v_current using p_record_id;

  if v_current is not null and p_base is not null and v_current > p_base then
    delete from public.sync_ops_applied where user_id = v_uid and op_id = p_op_id;
    return jsonb_build_object('status','conflict','server_updated_at', v_current);
  end if;

  if p_type = 'delete' then
    execute format('update public.%I set deleted_at = clock_timestamp() where id = $1 returning updated_at', p_table)
      into v_new using p_record_id;
    return jsonb_build_object('status','applied','updated_at', v_new);
  end if;

  if v_current is not null and p_base is null then
    -- the same new record was already created (e.g. retried after a lost response)
    return jsonb_build_object('status','duplicate','updated_at', v_current);
  end if;

  select string_agg(format('%I = excluded.%I', column_name, column_name), ', ')
    into v_sets
    from information_schema.columns
   where table_schema = 'public' and table_name = p_table
     and column_name not in ('id','user_id','created_at','updated_at')
     and is_generated = 'NEVER';

  -- Generated columns (for example balance_reconciliations.difference) cannot be written, not even with NULL,
  -- so name the writable columns instead of using "select *".
  select string_agg(format('%I', column_name), ', ' order by ordinal_position)
    into v_cols
    from information_schema.columns
   where table_schema = 'public' and table_name = p_table
     and is_generated = 'NEVER';

  execute format(
    'insert into public.%1$I (%3$s) select %3$s from jsonb_populate_record(null::public.%1$I, $1) '
    'on conflict (id) do update set %2$s returning updated_at', p_table, v_sets, v_cols)
    into v_new
    using (p_record - 'user_id' - 'created_at' - 'updated_at') || jsonb_build_object('id', p_record_id, 'user_id', v_uid);

  return jsonb_build_object('status','applied','updated_at', v_new);
end $$;

revoke all on function public.sync_apply(uuid, text, text, uuid, timestamptz, jsonb) from public, anon;
grant execute on function public.sync_apply(uuid, text, text, uuid, timestamptz, jsonb) to authenticated;
