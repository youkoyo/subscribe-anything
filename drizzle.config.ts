import type { Config } from 'drizzle-kit';
import { loadEnvConfig } from '@next/env';
import { resolveDatabaseUrl } from './src/lib/db/config';

loadEnvConfig(process.cwd());

const databaseUrl = resolveDatabaseUrl();

export default {
  schema: './src/lib/db/schema.ts',
  out: './drizzle-pg',
  dialect: 'postgresql',
  dbCredentials: {
    url: databaseUrl,
  },
} satisfies Config;
