const POSTGRES_URL_PATTERN = /^postgres(?:ql)?:\/\//i;

function databaseTargetKey(target: string) {
  return `DATABASE_URL_${target.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_')}`;
}

export function resolveDatabaseUrl(env: NodeJS.ProcessEnv = process.env) {
  const target = env.DATABASE_TARGET?.trim();
  const databaseUrl = target ? env[databaseTargetKey(target)] : env.DATABASE_URL;

  if (!databaseUrl) {
    const suffix = target ? ` for DATABASE_TARGET=${target}` : '';
    throw new Error(`DATABASE_URL is required${suffix} and must point to a PostgreSQL database.`);
  }

  if (!POSTGRES_URL_PATTERN.test(databaseUrl)) {
    throw new Error('DATABASE_URL must be a PostgreSQL connection string.');
  }

  return databaseUrl;
}

export function describeDatabaseUrl(databaseUrl: string) {
  const url = new URL(databaseUrl);
  const username = url.username ? `${decodeURIComponent(url.username)}@` : '';
  return `${url.protocol}//${username}${url.host}${url.pathname}`;
}
