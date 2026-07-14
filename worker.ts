import { loadEnvConfig } from '@next/env';
import { describeDatabaseUrl, resolveDatabaseUrl } from './src/lib/db/config';

loadEnvConfig(process.cwd(), process.env.NODE_ENV !== 'production');

async function main() {
  console.log(`[Worker DB] Using ${describeDatabaseUrl(resolveDatabaseUrl())}`);
  const { initScheduler } = await import('./src/lib/scheduler');
  await initScheduler();
  const { runBackgroundWorker } = await import('./src/lib/background-jobs/worker');
  await runBackgroundWorker();
}

main().catch((error) => {
  console.error('[Worker] Fatal error:', error);
  process.exit(1);
});
