-- MONVEX schema — money is stored as exact NUMERIC in major units (never float).
-- Every user-owned table carries user_id (defaults to auth.uid()), created_at,
-- updated_at (server-maintained) and deleted_at (soft delete).
-- (id, user_id) is unique on parents so children can use composite foreign keys,
-- which makes it impossible to reference another user's row.


-- ---------------------------------------------------------------- helpers

create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := clock_timestamp();
  if tg_op = 'INSERT' then
    new.created_at := coalesce(new.created_at, clock_timestamp());
  end if;
  return new;
end $$;

create or replace function public.protect_owner() returns trigger
language plpgsql as $$
begin
  if new.user_id is distinct from old.user_id then
    raise exception 'user_id cannot be changed';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------- profile & preferences

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  locale text not null default 'en',
  timezone text not null default 'Asia/Colombo',
  preferred_currency char(3) not null default 'LKR',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_preferences (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  currency char(3) not null default 'LKR',
  payday_date date,
  expected_salary numeric(18,3) check (expected_salary is null or expected_salary >= 0),
  salary_frequency text not null default 'monthly'
    check (salary_frequency in ('once','weekly','monthly','quarterly','yearly')),
  salary_account_id uuid,
  essential_daily_amount numeric(18,3) not null default 0 check (essential_daily_amount >= 0),
  safety_buffer numeric(18,3) not null default 0 check (safety_buffer >= 0),
  safe_to_spend_period_days integer not null default 30 check (safe_to_spend_period_days between 1 and 366),
  carry_forward_allowance boolean not null default true,
  theme text not null default 'navy' check (theme in ('navy','noir')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- accounts & categories

create table public.finance_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  type text not null check (type in ('cash','bank','wallet','other')),
  currency char(3) not null default 'LKR',
  opening_balance numeric(18,3) not null default 0,
  confirmed_balance numeric(18,3),
  last_reconciled_at date,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, user_id)
);
create index finance_accounts_user_idx on public.finance_accounts (user_id) where deleted_at is null;

alter table public.user_preferences
  add constraint user_preferences_salary_account_fk
  foreign key (salary_account_id, user_id) references public.finance_accounts (id, user_id) on delete set null (salary_account_id);

create table public.transaction_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  type text not null check (type in ('income','expense')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, user_id)
);
create unique index transaction_categories_name_idx
  on public.transaction_categories (user_id, type, lower(name)) where deleted_at is null;

-- ---------------------------------------------------------------- bills

create table public.payment_obligations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  amount numeric(18,3) not null check (amount > 0),
  is_estimate boolean not null default false,
  currency char(3) not null default 'LKR',
  frequency text not null check (frequency in ('once','weekly','monthly','quarterly','yearly')),
  due_date date not null,
  end_date date check (end_date is null or end_date >= due_date),
  account_id uuid,
  reminder_days integer not null default 3 check (reminder_days between 0 and 90),
  essential boolean not null default true,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, user_id),
  foreign key (account_id, user_id) references public.finance_accounts (id, user_id)
);
create index payment_obligations_user_idx on public.payment_obligations (user_id) where deleted_at is null;

-- One occurrence per obligation per due date: generating twice (or from two
-- devices) can never create duplicates. Paid amounts are derived from the
-- transactions linked through transactions.occurrence_id.
create table public.payment_occurrences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  obligation_id uuid not null,
  due_date date not null,
  expected_amount numeric(18,3) not null check (expected_amount > 0),
  currency char(3) not null default 'LKR',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, user_id),
  unique (user_id, obligation_id, due_date),
  foreign key (obligation_id, user_id) references public.payment_obligations (id, user_id) on delete cascade
);
create index payment_occurrences_due_idx on public.payment_occurrences (user_id, due_date) where deleted_at is null;

-- ---------------------------------------------------------------- transactions

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  type text not null check (type in ('income','expense')),
  account_id uuid not null,
  amount numeric(18,3) not null check (amount > 0),
  currency char(3) not null default 'LKR',
  txn_date date not null,
  txn_time time,
  category_id uuid,
  description text not null check (length(btrim(description)) > 0),
  counterparty text,
  reference text,
  notes text,
  status text not null default 'posted' check (status in ('posted','pending')),
  occurrence_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, user_id),
  foreign key (account_id, user_id) references public.finance_accounts (id, user_id),
  foreign key (category_id, user_id) references public.transaction_categories (id, user_id),
  foreign key (occurrence_id, user_id) references public.payment_occurrences (id, user_id)
);
create index transactions_user_date_idx on public.transactions (user_id, txn_date desc) where deleted_at is null;
create index transactions_account_idx on public.transactions (account_id) where deleted_at is null;
create index transactions_occurrence_idx on public.transactions (occurrence_id) where occurrence_id is not null;

-- Refuse to over-pay a bill occurrence (prevents duplicate payments at the database level).
create or replace function public.check_occurrence_overpay() returns trigger
language plpgsql as $$
declare
  v_expected numeric;
  v_paid numeric;
begin
  if new.occurrence_id is null or new.deleted_at is not null or new.status <> 'posted' then
    return new;
  end if;
  select expected_amount into v_expected from public.payment_occurrences where id = new.occurrence_id;
  select coalesce(sum(amount), 0) into v_paid
    from public.transactions
   where occurrence_id = new.occurrence_id and deleted_at is null and status = 'posted' and id <> new.id;
  if v_paid + new.amount > v_expected then
    raise exception 'This payment would exceed the amount due for the bill (already paid %, due %).', v_paid, v_expected
      using errcode = '23514';
  end if;
  return new;
end $$;

create trigger transactions_overpay before insert or update on public.transactions
  for each row execute function public.check_occurrence_overpay();

-- Salary only: amounts withheld at payroll to recover advances / employer loans.
-- (table created after salary_advances below)

-- ---------------------------------------------------------------- transfers

create table public.internal_transfers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  source_account_id uuid not null,
  destination_account_id uuid not null,
  amount numeric(18,3) not null check (amount > 0),
  fee numeric(18,3) not null default 0 check (fee >= 0),
  currency char(3) not null default 'LKR',
  transfer_date date not null,
  reference text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, user_id),
  check (source_account_id <> destination_account_id),
  foreign key (source_account_id, user_id) references public.finance_accounts (id, user_id),
  foreign key (destination_account_id, user_id) references public.finance_accounts (id, user_id)
);
create index internal_transfers_user_idx on public.internal_transfers (user_id, transfer_date desc) where deleted_at is null;

create table public.pass_through_transfers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  account_id uuid not null,
  sender text not null,
  recipient text not null,
  destination text,
  amount numeric(18,3) not null check (amount > 0),
  currency char(3) not null default 'LKR',
  received_date date not null,
  status text not null default 'received'
    check (status in ('received','pending','partially_transferred','transferred','confirmed','cancelled')),
  reference text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, user_id),
  foreign key (account_id, user_id) references public.finance_accounts (id, user_id)
);

create table public.pass_through_legs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  pass_through_id uuid not null,
  amount numeric(18,3) not null check (amount > 0),
  fee numeric(18,3) not null default 0 check (fee >= 0),
  currency char(3) not null default 'LKR',
  leg_date date not null,
  reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, user_id),
  foreign key (pass_through_id, user_id) references public.pass_through_transfers (id, user_id) on delete cascade
);

-- ---------------------------------------------------------------- loans & debts

create table public.loans_receivable (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  borrower text not null,
  account_id uuid not null,
  principal numeric(18,3) not null check (principal > 0),
  currency char(3) not null default 'LKR',
  lent_date date not null,
  due_date date,
  written_off numeric(18,3) not null default 0 check (written_off >= 0 and written_off <= principal),
  reminder_days integer,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, user_id),
  foreign key (account_id, user_id) references public.finance_accounts (id, user_id)
);

create table public.receivable_repayments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  loan_id uuid not null,
  account_id uuid not null,
  amount numeric(18,3) not null check (amount > 0),
  currency char(3) not null default 'LKR',
  repaid_date date not null,
  reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, user_id),
  foreign key (loan_id, user_id) references public.loans_receivable (id, user_id) on delete cascade,
  foreign key (account_id, user_id) references public.finance_accounts (id, user_id)
);

create table public.personal_debts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  creditor text not null,
  account_id uuid not null,
  principal numeric(18,3) not null check (principal > 0),
  currency char(3) not null default 'LKR',
  borrowed_date date not null,
  due_date date,
  reminder_days integer,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, user_id),
  foreign key (account_id, user_id) references public.finance_accounts (id, user_id)
);

create table public.debt_repayments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  debt_id uuid not null,
  account_id uuid not null,
  principal_part numeric(18,3) not null default 0 check (principal_part >= 0),
  interest_part numeric(18,3) not null default 0 check (interest_part >= 0),
  currency char(3) not null default 'LKR',
  paid_date date not null,
  reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, user_id),
  check (principal_part + interest_part > 0),
  foreign key (debt_id, user_id) references public.personal_debts (id, user_id) on delete cascade,
  foreign key (account_id, user_id) references public.finance_accounts (id, user_id)
);

-- ---------------------------------------------------------------- salary advances

create table public.salary_advances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  employer text not null,
  kind text not null default 'advance' check (kind in ('advance','employer_loan')),
  account_id uuid not null,
  amount numeric(18,3) not null check (amount > 0),
  currency char(3) not null default 'LKR',
  advance_date date not null,
  status text not null default 'received' check (status in ('pending','received','cancelled')),
  payroll_month text check (payroll_month is null or payroll_month ~ '^\d{4}-\d{2}$'),
  -- user-configured deduction schedule: [{"month":"2026-11","amount":"10000.00"}]
  schedule jsonb not null default '[]'::jsonb,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, user_id),
  foreign key (account_id, user_id) references public.finance_accounts (id, user_id)
);

create table public.payroll_deductions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  transaction_id uuid not null,
  advance_id uuid not null,
  amount numeric(18,3) not null check (amount > 0),
  currency char(3) not null default 'LKR',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, user_id),
  foreign key (transaction_id, user_id) references public.transactions (id, user_id) on delete cascade,
  foreign key (advance_id, user_id) references public.salary_advances (id, user_id)
);

-- ---------------------------------------------------------------- budgets & savings

create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  category_id uuid not null,
  period text not null default 'monthly' check (period in ('monthly')),
  limit_amount numeric(18,3) not null check (limit_amount > 0),
  currency char(3) not null default 'LKR',
  alert_threshold_pct integer not null default 80 check (alert_threshold_pct between 1 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, user_id),
  foreign key (category_id, user_id) references public.transaction_categories (id, user_id)
);
create unique index budgets_category_idx on public.budgets (user_id, category_id, period) where deleted_at is null;

create table public.savings_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  target_amount numeric(18,3) not null check (target_amount > 0),
  currency char(3) not null default 'LKR',
  target_date date,
  account_id uuid,
  reserve_in_safe_to_spend boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, user_id),
  foreign key (account_id, user_id) references public.finance_accounts (id, user_id)
);

-- Allocated amount of a goal = sum of its allocations (not an expense, not a transfer).
create table public.savings_allocations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  goal_id uuid not null,
  account_id uuid,
  amount numeric(18,3) not null check (amount <> 0),
  currency char(3) not null default 'LKR',
  allocated_on date not null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, user_id),
  foreign key (goal_id, user_id) references public.savings_goals (id, user_id) on delete cascade,
  foreign key (account_id, user_id) references public.finance_accounts (id, user_id)
);

-- ---------------------------------------------------------------- evidence, reconciliation, forecasts, audit

create table public.evidence_attachments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  mime_type text not null check (mime_type in ('image/jpeg','image/png','image/webp','application/pdf')),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  reference_code text,
  description text,
  keywords text[] not null default '{}',
  document_date date,
  transaction_id uuid,
  internal_transfer_id uuid,
  pass_through_id uuid,
  obligation_id uuid,
  loan_id uuid,
  debt_id uuid,
  salary_advance_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, user_id),
  -- files live under "<user id>/..." in the private bucket
  check (storage_path like user_id::text || '/%'),
  foreign key (transaction_id, user_id) references public.transactions (id, user_id) on delete set null (transaction_id),
  foreign key (internal_transfer_id, user_id) references public.internal_transfers (id, user_id) on delete set null (internal_transfer_id),
  foreign key (pass_through_id, user_id) references public.pass_through_transfers (id, user_id) on delete set null (pass_through_id),
  foreign key (obligation_id, user_id) references public.payment_obligations (id, user_id) on delete set null (obligation_id),
  foreign key (loan_id, user_id) references public.loans_receivable (id, user_id) on delete set null (loan_id),
  foreign key (debt_id, user_id) references public.personal_debts (id, user_id) on delete set null (debt_id),
  foreign key (salary_advance_id, user_id) references public.salary_advances (id, user_id) on delete set null (salary_advance_id)
);
create index evidence_user_idx on public.evidence_attachments (user_id) where deleted_at is null;

create table public.balance_reconciliations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  account_id uuid not null,
  statement_balance numeric(18,3) not null,
  app_balance numeric(18,3) not null,
  difference numeric(18,3) generated always as (statement_balance - app_balance) stored,
  currency char(3) not null default 'LKR',
  reconciled_on date not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, user_id),
  foreign key (account_id, user_id) references public.finance_accounts (id, user_id)
);

create table public.forecast_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  horizon_days integer not null check (horizon_days in (30, 60, 90)),
  scenario text not null default 'expected' check (scenario in ('expected','conservative')),
  as_of date not null,
  target_date date not null,
  projected_total numeric(18,3) not null,
  currency char(3) not null default 'LKR',
  assumptions jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, user_id),
  unique (user_id, as_of, horizon_days, scenario)
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  table_name text not null,
  record_id uuid,
  action text not null check (action in ('INSERT','UPDATE','DELETE')),
  old_data jsonb,
  new_data jsonb,
  changed_at timestamptz not null default now()
);
create index audit_log_user_idx on public.audit_log (user_id, changed_at desc);

-- Idempotency ledger for offline sync operations.
create table public.sync_ops_applied (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  op_id uuid not null,
  applied_at timestamptz not null default now(),
  primary key (user_id, op_id)
);

-- ---------------------------------------------------------------- triggers

do $$
declare
  t text;
  owned text[] := array[
    'finance_accounts','transaction_categories','payment_obligations','payment_occurrences',
    'transactions','internal_transfers','pass_through_transfers','pass_through_legs',
    'loans_receivable','receivable_repayments','personal_debts','debt_repayments',
    'salary_advances','payroll_deductions','budgets','savings_goals','savings_allocations',
    'evidence_attachments','balance_reconciliations','forecast_snapshots',
    'profiles','user_preferences'
  ];
begin
  foreach t in array owned loop
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.set_updated_at()', t || '_touch', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.protect_owner()', t || '_owner', t);
  end loop;
end $$;

create or replace function public.write_audit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    insert into public.audit_log (user_id, table_name, record_id, action, old_data)
    values (old.user_id, tg_table_name, old.id, 'DELETE', to_jsonb(old));
    return old;
  elsif tg_op = 'UPDATE' then
    insert into public.audit_log (user_id, table_name, record_id, action, old_data, new_data)
    values (new.user_id, tg_table_name, new.id, 'UPDATE', to_jsonb(old), to_jsonb(new));
    return new;
  else
    insert into public.audit_log (user_id, table_name, record_id, action, new_data)
    values (new.user_id, tg_table_name, new.id, 'INSERT', to_jsonb(new));
    return new;
  end if;
end $$;

do $$
declare
  t text;
  audited text[] := array[
    'finance_accounts','transactions','internal_transfers','pass_through_transfers',
    'loans_receivable','receivable_repayments','personal_debts','debt_repayments',
    'salary_advances','payroll_deductions','balance_reconciliations'
  ];
begin
  foreach t in array audited loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.write_audit()', t || '_audit', t);
  end loop;
end $$;

-- Create profile + preferences when a user signs up.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (user_id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)))
  on conflict do nothing;
  insert into public.user_preferences (user_id) values (new.id) on conflict do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
