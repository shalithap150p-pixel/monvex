-- Bank details: the user's own bank account information (bank, branch, account number, IBAN/SWIFT…).
--
-- What this table must NEVER hold (the app refuses it, and there is no column for it):
-- online-banking passwords, PINs, OTPs, CVV/CVC, or full card numbers (only the last four digits).
--
-- Protected exactly like every other user table: row level security (owner only, forced), owner cannot be
-- changed, and it syncs through sync_apply. It is deliberately NOT audited: the audit log copies whole rows
-- as JSON, which would duplicate account numbers into a second table.
--
-- Run this in the Supabase SQL editor (after 0005). Until it is run, the Bank details page works on this
-- device only and sync reports that the database update is missing.

create table if not exists public.bank_account_details (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  label text not null check (length(btrim(label)) > 0),
  bank_name text not null check (length(btrim(bank_name)) > 0),
  branch_name text,
  branch_code text,
  bank_code text,
  account_holder text,
  account_number text not null check (length(btrim(account_number)) > 0),
  account_type text not null default 'savings'
    check (account_type in ('savings','current','fixed_deposit','foreign_currency','other')),
  currency char(3) not null default 'LKR',
  iban text,
  swift_bic text,
  card_last4 text check (card_last4 is null or card_last4 ~ '^[0-9]{4}$'),
  opened_on date,
  contact_phone text,
  linked_account_id uuid,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, user_id),
  foreign key (linked_account_id, user_id) references public.finance_accounts (id, user_id)
);
create index if not exists bank_account_details_user_idx on public.bank_account_details (user_id) where deleted_at is null;

create trigger bank_account_details_touch before insert or update on public.bank_account_details
  for each row execute function public.set_updated_at();
create trigger bank_account_details_owner before update on public.bank_account_details
  for each row execute function public.protect_owner();

alter table public.bank_account_details enable row level security;
alter table public.bank_account_details force row level security;
create policy bank_account_details_select_own on public.bank_account_details for select to authenticated using (user_id = (select auth.uid()));
create policy bank_account_details_insert_own on public.bank_account_details for insert to authenticated with check (user_id = (select auth.uid()));
create policy bank_account_details_update_own on public.bank_account_details for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy bank_account_details_delete_own on public.bank_account_details for delete to authenticated using (user_id = (select auth.uid()));

revoke all on public.bank_account_details from anon;
grant select, insert, update, delete on public.bank_account_details to authenticated;

-- Allow the sync endpoint to write the new table (same function as 0003 with one more table in the allow-list).
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

  execute format(
    'insert into public.%1$I select * from jsonb_populate_record(null::public.%1$I, $1) '
    'on conflict (id) do update set %2$s returning updated_at', p_table, v_sets)
    into v_new
    using (p_record - 'user_id' - 'created_at' - 'updated_at') || jsonb_build_object('id', p_record_id, 'user_id', v_uid);

  return jsonb_build_object('status','applied','updated_at', v_new);
end $$;

revoke all on function public.sync_apply(uuid, text, text, uuid, timestamptz, jsonb) from public, anon;
grant execute on function public.sync_apply(uuid, text, text, uuid, timestamptz, jsonb) to authenticated;
