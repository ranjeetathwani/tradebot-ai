create table if not exists public.backtests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  fast_period integer not null,
  slow_period integer not null,
  final_equity numeric not null,
  return_pct numeric not null,
  trade_count integer not null,
  created_at timestamptz not null default now()
);
alter table public.backtests enable row level security;
create policy "Owners read own backtests" on public.backtests for select to authenticated using (auth.uid() = user_id);
create policy "Owners create own backtests" on public.backtests for insert to authenticated with check (auth.uid() = user_id);
create policy "Owners delete own backtests" on public.backtests for delete to authenticated using (auth.uid() = user_id);
