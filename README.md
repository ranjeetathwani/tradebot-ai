# TradeBot AI — Full-Stack Capstone MVP

Educational algorithmic trading and **paper-trading/backtesting only** dashboard. No brokerage integration or real orders.

## Problem and users

New traders and finance students need a safe way to experiment with systematic trading and understand performance. TradeBot AI offers a simulated strategy dashboard with a moving-average crossover backtest, performance chart, trades and optional cloud saving.

## Stack

- Next.js App Router, React, TypeScript, Recharts
- Next.js API routes for market dataset and backtesting
- Supabase Auth and PostgreSQL with RLS for saved backtest results
- Vercel hosting, GitHub source control
- Deterministic synthetic candles, explicitly labeled as **SIMULATED**

## Run locally

```bash
npm install
cp .env.example .env.local
npm run dev
```

Supabase is optional for running local backtests. To enable authentication and saving, create a Supabase project, run `supabase/schema.sql` in SQL Editor, and set `NEXT_PUBLIC_SUPABASE_URL` (base URL only) and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (publishable key). Configure the same variables in Vercel for production.

## API

- `GET /api/market` — synthetic demonstration candles
- `POST /api/backtest` with JSON `{ "fast": 10, "slow": 30 }` — SMA crossover backtest
- `GET /api/portfolio` — virtual starting balance
- `GET /api/trades` — documents persistence design

## Research and limitations

A simple moving average is the arithmetic mean of the latest N closing prices. A buy occurs on a fast SMA crossing above a slow SMA; a sell on the opposite crossover. This demonstration fills trades at the same close used to detect the crossover, an optimistic simplification; real systems should trade no earlier than the next bar, model fees/slippage, validate on out-of-sample data and use market-data APIs. Synthetic data is not market data. No LLM or external market API is currently implemented; AI assistance was used in development, not as a live inference feature. No guarantee of returns.

## Deployment

1. Upload files to GitHub repository root.
2. Import repository into Vercel with Next.js preset.
3. Add Supabase environment variables if cloud saving is desired.
4. Deploy and test the backtest and sign-in flows.

## Demonstration

Run a backtest with fast=10 and slow=30; observe the equity curve and trades. Create a Supabase account and save a backtest. Explain the limitations of backtesting on synthetic data.
