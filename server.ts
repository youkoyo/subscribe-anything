// server.ts — Custom Next.js server
// Startup order: runMigrations → initScheduler → initDeliveryScheduler → createServer
//
// Run dev:   tsx server.ts
// Run prod:  node dist/server.js  (after tsc -p tsconfig.server.json)

import { createServer } from 'http';
import { parse } from 'url';
import { loadEnvConfig } from '@next/env';
import next from 'next';
import { describeDatabaseUrl, resolveDatabaseUrl } from './src/lib/db/config';

const dev = process.env.NODE_ENV !== 'production';
loadEnvConfig(process.cwd(), dev);

const port = parseInt(process.env.PORT ?? '3000', 10);

function requireDatabaseUrl() {
  const databaseUrl = resolveDatabaseUrl();
  console.log(`[DB] Using ${describeDatabaseUrl(databaseUrl)}`);
}

async function main() {
  requireDatabaseUrl();

  // 1. Run DB migrations + seed prompt templates + enable WAL
  const { runMigrations } = await import('./src/lib/db/migrate');
  await runMigrations();

  // 2. Init scheduler — load all enabled sources and register cron jobs
  const { initScheduler } = await import('./src/lib/scheduler');
  await initScheduler();

  // 3. Init enterprise delivery scheduler — load enabled industry email jobs
  const { initDeliveryScheduler } = await import('./src/lib/enterprise/deliveryScheduler');
  await initDeliveryScheduler();

  // 4. Start Next.js
  const app = next({ dev, hostname: 'localhost', port });
  const handle = app.getRequestHandler();

  await app.prepare();

  createServer((req, res) => {
    const parsedUrl = parse(req.url ?? '/', true);
    handle(req, res, parsedUrl);
  }).listen(port, '0.0.0.0', () => {
    console.log(`[Server] Ready on http://localhost:${port} (${dev ? 'dev' : 'prod'})`);
  });
}

main().catch((err) => {
  console.error('[Server] Fatal error:', err);
  process.exit(1);
});
