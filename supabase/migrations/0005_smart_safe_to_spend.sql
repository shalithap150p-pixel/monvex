-- Smart Safe-to-Spend: extra planning fields (all additive and optional — existing rows keep working).
--
--   budgets.essential                 essential spending (food, transport…) covers part of the daily-essentials reserve
--   payment_obligations.category_id   the expense category a bill belongs to; when that category has a budget the
--                                     bill is counted inside the budget instead of being reserved twice
--   savings_goals.priority            high / medium / low (drives the share of the recommended savings)
--   savings_goals.monthly_contribution  the monthly amount the user APPROVED. It is only reserved in Safe-to-Spend;
--                                     MONVEX never moves or withdraws money.
--
-- Run this in the Supabase SQL editor BEFORE using the new fields: the sync function silently ignores columns
-- that do not exist yet, so values saved earlier would not reach the server.

alter table public.budgets
  add column if not exists essential boolean not null default false;

alter table public.payment_obligations
  add column if not exists category_id uuid;

alter table public.savings_goals
  add column if not exists priority text not null default 'medium',
  add column if not exists monthly_contribution numeric(18,3) not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'savings_goals_priority_check') then
    alter table public.savings_goals
      add constraint savings_goals_priority_check check (priority in ('high','medium','low'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'savings_goals_monthly_contribution_check') then
    alter table public.savings_goals
      add constraint savings_goals_monthly_contribution_check check (monthly_contribution >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'payment_obligations_category_fk') then
    alter table public.payment_obligations
      add constraint payment_obligations_category_fk
      foreign key (category_id, user_id) references public.transaction_categories (id, user_id);
  end if;
end $$;
