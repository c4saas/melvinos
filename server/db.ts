import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from "@shared/schema";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// Standard PostgreSQL pool — works with any Postgres server (local, Docker, VPS, Neon)
export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle({ client: pool, schema });
