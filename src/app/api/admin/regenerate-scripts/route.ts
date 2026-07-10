// POST /api/admin/regenerate-scripts — admin only
// Triggers the repair flow for every source in the DB so the LLM rewrites each
// script against the latest `generate-script` prompt (which now enforces hard
// topic filtering, 30-day freshness, and a non-robot User-Agent).
//
// This is fire-and-forget. Each source enters the in-memory repair queue;
// progress streams over the existing /api/sources/repair SSE channel. The
// frontend admin tools page can subscribe per source to watch.
//
// Body (optional):
//   { sourceIds?: string[] }   — only regenerate these; defaults to all sources
//   { force?: boolean }        — re-queue even sources that are already being repaired

import { inArray, ne, notInArray } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { sources } from '@/lib/db/schema';
import { startRepair, isRepairing } from '@/lib/repair/manager';
import { requireAdmin } from '@/lib/auth';

export async function POST(req: Request) {
  try {
    const session = await requireAdmin();
    const db = getDb();

    let onlyIds: string[] | null = null;
    let force = false;
    try {
      const body = (await req.json().catch(() => null)) as
        | { sourceIds?: string[]; force?: boolean }
        | null;
      if (Array.isArray(body?.sourceIds) && body.sourceIds.length > 0) {
        onlyIds = body.sourceIds;
      }
      if (typeof body?.force === 'boolean') {
        force = body.force;
      }
    } catch {
      // ignore
    }

    // Build the source query
    const allSources = onlyIds
      ? await db.select().from(sources).where(inArray(sources.id, onlyIds))
      : await db.select().from(sources).where(notInArray(sources.status, ['pending']));

    const queued: Array<{ id: string; title: string; status: 'queued' | 'skipped' | 'failed' }> = [];
    let skippedAlreadyRunning = 0;
    let failed = 0;

    for (const src of allSources) {
      if (!force && isRepairing(src.id)) {
        queued.push({ id: src.id, title: src.title, status: 'skipped' });
        skippedAlreadyRunning++;
        continue;
      }
      try {
        const ok = startRepair(
          src.id,
          {
            title: src.title,
            url: src.url,
            script: src.script,
            lastError: src.lastError,
            subscriptionId: src.subscriptionId,
          },
          session.userId
        );
        if (!ok) {
          queued.push({ id: src.id, title: src.title, status: 'failed' });
          failed++;
        } else {
          queued.push({ id: src.id, title: src.title, status: 'queued' });
        }
      } catch (err) {
        queued.push({ id: src.id, title: src.title, status: 'failed' });
        failed++;
        console.error(`[admin regenerate-scripts] failed to queue ${src.id}:`, err);
      }
    }

    return Response.json({
      total: allSources.length,
      queued: queued.filter((q) => q.status === 'queued').length,
      skipped: skippedAlreadyRunning,
      failed,
      details: queued,
    });
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') {
      return new Response('Unauthorized', { status: 401 });
    }
    if (err instanceof Error && err.message === 'FORBIDDEN') {
      return new Response('Admin access required', { status: 403 });
    }
    console.error('[admin regenerate-scripts POST]', err);
    return new Response('Internal server error', { status: 500 });
  }
}
