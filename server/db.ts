import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from "@shared/schema";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// PostgreSQL connection pool — tuned for long-running agent tasks (up to 20-iteration loops)
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,                    // concurrent connections (default, but explicit)
  idleTimeoutMillis: 30_000,  // close idle connections after 30s
  connectionTimeoutMillis: 5_000, // fail fast if pool is exhausted
});

pool.on('error', (err) => {
  console.error('[db] Unexpected pool error:', err.message);
});

export const db = drizzle({ client: pool, schema });
