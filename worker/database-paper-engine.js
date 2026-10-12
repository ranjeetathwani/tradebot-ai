
import pg from 'pg';
import fs from 'node:fs';

const FEE_RATE = 0.001;
const TRADE_ALLOCATION = 0.10;
const MAX_TRADE_VALUE = 1000;
const MARKET = 'BINANCE';
const SYMBOL = 'BTC-USD';

function validateOrder({ signal, price, orderId }) {
  if (!['BUY', 'SELL', 'HOLD'].includes(signal)) {
    throw new Error('Invalid signal');
  }

  if (!Number.isFinite(price) || price <= 0) {
    throw new Error('Invalid market price');
  }

  if (
    signal !== 'HOLD' &&
    (
      typeof orderId !== 'string' ||
      !/^[A-Za-z0-9:_-]{1,128}$/.test(orderId)
    )
  ) {
    throw new Error('Invalid order ID');
  }
}

function makePool() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL secret is missing');
  }

  return new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 10000,
    ssl: {
      ca: fs.readFileSync('prod-ca-2021.crt', 'utf8'),
      rejectUnauthorized: true
    }
  });
}

export async function executeDatabasePaperOrder(
  { signal, price, orderId },
  { commit = false } = {}
) {
  validateOrder({ signal, price, orderId });

  if (process.env.PAPER_ONLY !== 'true') {
    throw new Error('PAPER_ONLY=true is required');
  }

  if (process.env.BOT_ENABLED !== 'false') {
    throw new Error('BOT_ENABLED=false is required for manual safety testing');
  }

  if (commit) {
    throw new Error('Database writes are not enabled in this safety-test version');
  }

  if (signal === 'HOLD') {
    return {
      status: 'SKIPPED',
      reason: 'No trade signal',
      databaseWrites: 0
    };
  }

  const pool = makePool();
  let client;

  try {
    client = await pool.connect();
    await client.query('BEGIN READ ONLY');

    try {
      const settings = await client.query(
        "SELECT enabled, paper_only FROM public.bot_settings WHERE id = 'global'"
      );

      if (
        settings.rowCount !== 1 ||
        settings.rows[0].paper_only !== true ||
        settings.rows[0].enabled !== false
      ) {
        throw new Error('Database safety settings are not valid for dry run');
      }

      const accountResult = await client.query(
        'SELECT cash FROM public.paper_accounts WHERE market = $1',
        [MARKET]
      );

      if (accountResult.rowCount !== 1) {
        throw new Error('BINANCE paper account missing');
      }

      const positionResult = await client.query(
        `SELECT quantity, avg_price
         FROM public.paper_positions
         WHERE market = $1 AND symbol = $2`,
        [MARKET, SYMBOL]
      );

      const duplicate = await client.query(
        'SELECT 1 FROM public.paper_orders WHERE idempotency_key = $1',
        [orderId]
      );

      const cash = Number(accountResult.rows[0].cash);
      const quantity = positionResult.rowCount
        ? Number(positionResult.rows[0].quantity)
        : 0;

      if (
        !Number.isFinite(cash) ||
        !Number.isFinite(quantity) ||
        cash < 0 ||
        quantity < 0
      ) {
        throw new Error('Invalid paper account data');
      }

      let result;

      if (duplicate.rowCount) {
        result = {
          status: 'SKIPPED',
          reason: 'Duplicate order'
        };
      } else if (signal === 'BUY' && quantity > 0) {
        result = {
          status: 'SKIPPED',
          reason: 'Position already open'
        };
      } else if (signal === 'SELL' && quantity <= 0) {
        result = {
          status: 'SKIPPED',
          reason: 'No position to sell'
        };
      } else {
        const value = signal === 'BUY'
          ? Math.min(
              cash * TRADE_ALLOCATION,
              MAX_TRADE_VALUE,
              cash / (1 + FEE_RATE)
            )
          : quantity * price;

        const fee = value * FEE_RATE;
        const tradeQuantity = signal === 'BUY'
          ? value / price
          : quantity;

        result = {
          status: 'PREVIEW_ONLY',
          market: MARKET,
          symbol: SYMBOL,
          side: signal,
          price,
          quantity: tradeQuantity,
          value,
          fee,
          projectedCash: signal === 'BUY'
            ? cash - value - fee
            : cash + value - fee
        };
      }

      await client.query('COMMIT');

      return {
        mode: 'PAPER_ONLY_DATABASE_PREVIEW',
        ...result,
        databaseWrites: 0,
        realOrdersExecuted: 0
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  } finally {
    if (client) client.release();
    await pool.end();
  }
}

async function main() {
  const result = await executeDatabasePaperOrder({
    signal: 'BUY',
    price: 80000,
    orderId: 'preview-btc-buy-001'
  });

  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1]?.endsWith('database-paper-engine.js')) {
  main().catch(error => {
    console.error('Paper engine preview failed:', error.message);
    process.exitCode = 1;
  });
}
