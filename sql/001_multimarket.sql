-- Additive migration; does not change existing backtests table.
create table if not exists public.bot_settings (
 id text primary key default 'global', enabled boolean not null default false,
 paper_only boolean not null default true check (paper_only = true),
 updated_at timestamptz not null default now()
);
insert into public.bot_settings(id) values ('global') on conflict do nothing;
create table if not exists public.paper_accounts (
 market text primary key check (market in ('BINANCE','US','PSX')),
 currency text not null, cash numeric(24,8) not null check (cash >= 0),
 starting_cash numeric(24,8) not null check (starting_cash > 0),
 updated_at timestamptz not null default now()
);
create table if not exists public.paper_positions (
 market text not null, symbol text not null,
 quantity numeric(24,8) not null default 0 check (quantity >= 0),
 avg_price numeric(24,8) not null default 0,
 primary key(market,symbol)
);
create table if not exists public.paper_orders (
 id bigserial primary key, idempotency_key text unique not null,
 market text not null, symbol text not null,
 side text not null check (side in ('BUY','SELL')),
 quantity numeric(24,8) not null check (quantity > 0),
 fill_price numeric(24,8) not null check (fill_price > 0),
 status text not null default 'FILLED' check(status in ('FILLED')),
 source text not null, created_at timestamptz not null default now()
);
create table if not exists public.bot_events (
 id bigserial primary key, market text, symbol text,
 level text not null, message text not null,
 created_at timestamptz not null default now()
);
-- All tables are worker-only. Browser clients have no access.
alter table public.bot_settings enable row level security;
alter table public.paper_accounts enable row level security;
alter table public.paper_positions enable row level security;
alter table public.paper_orders enable row level security;
alter table public.bot_events enable row level security;
revoke all on public.bot_settings, public.paper_accounts, public.paper_positions, public.paper_orders, public.bot_events from anon, authenticated;
revoke all on sequence public.paper_orders_id_seq, public.bot_events_id_seq from anon, authenticated;
