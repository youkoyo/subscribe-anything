import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { resolveDatabaseUrl } from './config';
import * as schema from './schema';

// Persist across Next.js HMR reloads in dev mode
declare global {
  // eslint-disable-next-line no-var
  var __db: ReturnType<typeof createDb> | undefined;
  // eslint-disable-next-line no-var
  var __dbPool: Pool | undefined;
}

function createDb() {
  const pool = global.__dbPool ?? new Pool({ connectionString: resolveDatabaseUrl() });
  global.__dbPool = pool;
  return drizzle(pool, { schema });
}

export function getDb() {
  if (!global.__db) {
    global.__db = createDb();
  }
  return global.__db;
}

export type Db = ReturnType<typeof getDb>;
