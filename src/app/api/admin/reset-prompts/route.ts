// POST /api/admin/reset-prompts — admin only
// Resets the active content of `generate-script` and `validate-script` templates
// to match their `defaultContent` (which was already updated by runMigrations).
//
// DESTRUCTIVE: overwrites any user customizations. Use after pulling new
// prompt defaults from src/lib/db/migrate.ts to roll everyone onto the new
// behavior.
//
// Body (optional):
//   { ids: string[] }   — only reset these template ids; defaults to the
//                          two script-generation templates.

import { inArray, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { promptTemplates } from '@/lib/db/schema';
import { requireAdmin } from '@/lib/auth';

const DEFAULT_IDS = ['generate-script', 'validate-script'];

export async function POST(req: Request) {
  try {
    await requireAdmin();

    let ids = DEFAULT_IDS;
    try {
      const body = (await req.json().catch(() => null)) as { ids?: string[] } | null;
      if (Array.isArray(body?.ids) && body.ids.length > 0) {
        ids = body.ids;
      }
    } catch {
      // ignore — use defaults
    }

    const db = getDb();
    const result = await db
      .update(promptTemplates)
      .set({
        content: sql`default_content`,
        updatedAt: new Date(),
      })
      .where(inArray(promptTemplates.id, ids))
      .returning({ id: promptTemplates.id, name: promptTemplates.name });

    return Response.json({ reset: result });
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') {
      return new Response('Unauthorized', { status: 401 });
    }
    if (err instanceof Error && err.message === 'FORBIDDEN') {
      return new Response('Admin access required', { status: 403 });
    }
    console.error('[admin reset-prompts POST]', err);
    return new Response('Internal server error', { status: 500 });
  }
}
