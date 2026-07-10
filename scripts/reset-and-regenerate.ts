// scripts/reset-and-regenerate.ts
// One-shot operator script that resets the two script-generation prompt
// templates to their latest defaults, then queues every source for LLM-driven
// regeneration against the new prompt.
//
// Run with the server already up:
//   tsx --env-file=.env.local scripts/reset-and-regenerate.ts
//   tsx --env-file=.env.local scripts/reset-and-regenerate.ts --reset-only
//   tsx --env-file=.env.local scripts/reset-and-regenerate.ts --regen-only
//
// The reset step writes directly to the DB (drizzle + pg). The regen step
// calls the admin API on the running server (because repair state lives in
// server memory).

import { inArray, sql } from 'drizzle-orm';
import { getDb } from '../src/lib/db';
import { promptTemplates } from '../src/lib/db/schema';

const args = new Set(process.argv.slice(2));
const doReset = !args.has('--regen-only');
const doRegen = !args.has('--reset-only');

const DEFAULT_IDS = ['generate-script', 'validate-script'];

async function resetPrompts() {
  console.log(`[reset] Resetting prompt templates: ${DEFAULT_IDS.join(', ')}`);
  const db = getDb();
  const result = await db
    .update(promptTemplates)
    .set({
      content: sql`default_content`,
      updatedAt: new Date(),
    })
    .where(inArray(promptTemplates.id, DEFAULT_IDS))
    .returning({ id: promptTemplates.id, name: promptTemplates.name });

  for (const row of result) {
    console.log(`  ✓ ${row.id} (${row.name})`);
  }
  console.log(`[reset] ${result.length} template(s) reset.`);
}

async function triggerRegeneration() {
  // Find the running server. The dev server is the source of truth for repair
  // state, so this script can only KICK the regeneration — actual LLM work
  // happens in the server process.
  const port = process.env.PORT ?? '3000';
  const baseUrl = process.env.APP_URL ?? `http://localhost:${port}`;

  // For an admin-only endpoint we need a session cookie. Easiest is to ask
  // the operator to provide ADMIN_COOKIE in their .env.local. Otherwise we
  // skip the regen step and tell them to call the endpoint by hand.
  const cookie = process.env.ADMIN_COOKIE;
  if (!cookie) {
    console.log(
      '[regen] No ADMIN_COOKIE set — skipping regeneration. ' +
        'Either set ADMIN_COOKIE=<your-session-cookie> in .env.local ' +
        'and re-run, or call POST /api/admin/regenerate-scripts from the admin UI.'
    );
    return;
  }

  console.log(`[regen] POST ${baseUrl}/api/admin/regenerate-scripts ...`);
  const res = await fetch(`${baseUrl}/api/admin/regenerate-scripts`, {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`regenerate-scripts returned ${res.status}: ${text}`);
  }
  const body = (await res.json()) as {
    total: number;
    queued: number;
    skipped: number;
    failed: number;
  };
  console.log(
    `[regen] total=${body.total} queued=${body.queued} skipped=${body.skipped} failed=${body.failed}`
  );
  console.log(
    '[regen] Done. Watch progress in the admin UI → 产业信息池 → 数据源 → AI 修复 dialog.'
  );
}

async function main() {
  if (doReset) {
    await resetPrompts();
  }
  if (doRegen) {
    await triggerRegeneration();
  }
  console.log('[done]');
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
