import { eq, and, inArray } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { notifications, subscriptions } from '@/lib/db/schema';
import { requireAuth } from '@/lib/auth';

// POST /api/notifications/[id]/read — mark a notification as read
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth();
    const { id } = await params;
    const db = getDb();

    // Get notification and verify ownership via subscription
    const notification = (await db
      .select({
        id: notifications.id,
        subscriptionId: notifications.subscriptionId,
      })
      .from(notifications)
      .where(eq(notifications.id, id)))[0];

    if (!notification) {
      return Response.json({ error: 'Not found' }, { status: 404 });
    }

    // Verify the notification's subscription belongs to user
    if (notification.subscriptionId) {
      const sub = (await db.select()
        .from(subscriptions)
        .where(and(
          eq(subscriptions.id, notification.subscriptionId),
          eq(subscriptions.userId, session.userId)
        )))[0];

      if (!sub) {
        return Response.json({ error: 'Not found' }, { status: 404 });
      }
    }

    await db.update(notifications).set({ isRead: true }).where(eq(notifications.id, id));
    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('[notifications/[id]/read POST]', err);
    return Response.json({ error: 'Failed to mark notification as read' }, { status: 500 });
  }
}
