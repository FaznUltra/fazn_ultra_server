import { Pool } from 'pg';
import { env } from '../config/env';

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
});

pool.on('error', (err) => {
  // eslint-disable-next-line no-console
  console.error(JSON.stringify({ level: 'error', msg: 'pg.pool.error', error: err.message }));
});
