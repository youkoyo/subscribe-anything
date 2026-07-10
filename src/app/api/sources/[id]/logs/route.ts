// GET /api/sources/[id]/logs?limit=50
// Returns recent collection_logs entries for a single source, newest first.
// Used by the source page to display diagnostic info (start, success, failure, retries).

import { and, desc, eq, gte } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { collectionLogs, sources } from '@/lib/db/schema';
import { getOptionalSession } from '@/lib/auth/session';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const RETENTION_HOURS = 72; // Don't ship logs older than 3 days by default

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getOptionalSession();
  if (!session) {
    return new Response('Unauthorized', { status: 401 });
  }

  const { id: sourceId } = await params;
  const db = getDb();

  // Confirm the source exists — a missing source returns 404 to distinguish
  // from a legitimate "no logs yet" empty list.
  const source = (await db
    .select({ id: sources.id, subscriptionId: sources.subscriptionId })
    .from(sources)
    .where(eq(sources.id, sourceId)))[0];
  if (!source) {
    return new Response('Source not found', { status: 404 });
  }

  const url = new URL(req.url);
  const rawLimit = Number.parseInt(url.searchParams.get('limit') ?? '', 10);
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number.isFinite(rawLimit) ? rawLimit : DEFAULT_LIMIT));

  const since = new Date(Date.now() - RETENTION_HOURS * 60 * 60 * 1000);

  const rows = await db
    .select({
      id: collectionLogs.id,
      level: collectionLogs.level,
      event: collectionLogs.event,
      message: collectionLogs.message,
      payload: collectionLogs.payload,
      createdAt: collectionLogs.createdAt,
    })
    .from(collectionLogs)
    .where(
      and(
        eq(collectionLogs.sourceId, sourceId),
        gte(collectionLogs.createdAt, since)
      )
    )
    .orderBy(desc(collectionLogs.createdAt))
    .limit(limit);

  return Response.json({
    sourceId: source.subscriptionId,
    logs: rows.map((row) => ({
      ...row,
      payload: row.payload ? safeParseJson(row.payload) : null,
    })),
  });
}

function safeParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
