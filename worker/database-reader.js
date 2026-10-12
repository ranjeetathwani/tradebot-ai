
import pg from 'pg';
import fs from 'node:fs';

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL secret is missing');
  }

  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 10000,
    ssl: {
      ca: fs.readFileSync('prod-ca-2021.crt', 'utf8'),
      rejectUnauthorized: true
    }
  });

  try {
    const client = await pool.connect();

    try {
      await client.query('BEGIN READ ONLY');

      const settings = await client.query(`
        SELECT id, enabled, paper_only
        FROM public.bot_settings
        WHERE id = 'global'
      `);

      if (settings.rows.length !== 1) {
        throw new Error('Global bot settings not found');
      }

      if (settings.rows[0].paper_only !== true) {
        throw new Error('Paper-only protection is not enabled');
      }

      const accounts = await client.query(`
        SELECT market, currency, cash, starting_cash
        FROM public.paper_accounts
        ORDER BY market
      `);

      console.log(JSON.stringify({
        mode: 'DATABASE_READ_ONLY',
        botEnabled: settings.rows[0].enabled,
        paperOnly: settings.rows[0].paper_only,
        accounts: accounts.rows,
        ordersExecuted: 0,
        databaseWrites: 0
      }, null, 2));

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error('Database read test failed:', error.message);
  process.exitCode = 1;
});
