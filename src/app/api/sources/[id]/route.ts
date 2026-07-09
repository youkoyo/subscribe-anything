import { eq, and, isNull, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { sources, subscriptions, messageCards } from '@/lib/db/schema';
import { validateCron } from '@/lib/utils/cron';
import { requireAuth } from '@/lib/auth';

// Helper to verify source belongs to user
async function verifySourceOwnership(db: ReturnType<typeof getDb>, sourceId: string, userId: string) {
  const source = (await db.select()
    .from(sources)
    .innerJoin(subscriptions, eq(sources.subscriptionId, subscriptions.id))
    .where(and(eq(sources.id, sourceId), eq(subscriptions.userId, userId))))[0];
  return source;
}

// GET /api/sources/[id]
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth();
    const { id } = await params;
    const db = getDb();
    const result = await verifySourceOwnership(db, id, session.userId);
    if (!result) return Response.json({ error: 'Not found' }, { status: 404 });
    return Response.json(result.sources);
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('[sources/[id] GET]', err);
    return Response.json({ error: 'Failed to load source' }, { status: 500 });
  }
}

// PATCH /api/sources/[id] — update title, description, script, cronExpression, isEnabled, status, lastError
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth();
    const { id } = await params;
    const db = getDb();

    const result = await verifySourceOwnership(db, id, session.userId);
    if (!result) return Response.json({ error: 'Not found' }, { status: 404 });

    const body = await req.json();
    const patch: Record<string, unknown> = { updatedAt: new Date() };

    if (typeof body.title === 'string') patch.title = body.title.trim();
    if (typeof body.description === 'string') patch.description = body.description.trim() || null;
    if (typeof body.script === 'string') patch.script = body.script;
    if (typeof body.isEnabled === 'boolean') patch.isEnabled = body.isEnabled;
    if (typeof body.status === 'string') patch.status = body.status;
    if (typeof body.lastError === 'string' || body.lastError === null) patch.lastError = body.lastError;
    if (typeof body.cronExpression === 'string') {
      if (!validateCron(body.cronExpression)) {
        return Response.json({ error: 'Invalid cron expression' }, { status: 400 });
      }
      patch.cronExpression = body.cronExpression;
    }

    await db.update(sources).set(patch).where(eq(sources.id, id));

    // Trigger scheduler reload when isEnabled or cronExpression changes
    if (typeof body.isEnabled === 'boolean' || typeof body.cronExpression === 'string') {
      try {
        const { jobManager } = await import('@/lib/scheduler/jobManager');
        const updated = (await db.select().from(sources).where(eq(sources.id, id)))[0]!;
        if (!updated.isEnabled) {
          jobManager.unscheduleSource(id);
        } else if (updated.status === 'active') {
          jobManager.scheduleSource(updated);
        }
      } catch {
        // Scheduler may not be initialised in API-only context
      }
    }

    const updated = (await db.select().from(sources).where(eq(sources.id, id)))[0];
    return Response.json(updated);
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('[sources/[id] PATCH]', err);
    return Response.json({ error: 'Failed to update source' }, { status: 500 });
  }
}

// DELETE /api/sources/[id]
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth();
    const { id } = await params;
    const db = getDb();

    const result = await verifySourceOwnership(db, id, session.userId);
    if (!result) return Response.json({ error: 'Not found' }, { status: 404 });

    const subscriptionId = result.sources.subscriptionId;

    try {
      const { jobManager } = await import('@/lib/scheduler/jobManager');
      jobManager.unscheduleSource(id);
    } catch {
      // Scheduler may not be initialised
    }

    await db.delete(sources).where(eq(sources.id, id));

    // Recalculate subscription unreadCount and totalCount after cascade delete
    const counts = (await db.select({
      total: sql<number>`count(*)`,
      unread: sql<number>`count(*) filter (where ${messageCards.readAt} is null)`,
    }).from(messageCards).where(eq(messageCards.subscriptionId, subscriptionId)))[0];

    await db.update(subscriptions)
      .set({
        totalCount: counts?.total ?? 0,
        unreadCount: counts?.unread ?? 0,
        updatedAt: new Date(),
      })
      .where(eq(subscriptions.id, subscriptionId));

    return new Response(null, { status: 204 });
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('[sources/[id] DELETE]', err);
    return Response.json({ error: 'Failed to delete source' }, { status: 500 });
  }
}
