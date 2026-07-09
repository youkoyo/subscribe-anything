import { eq, isNull, sql, and } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { messageCards, subscriptions } from '@/lib/db/schema';
import { requireAuth } from '@/lib/auth';

// POST /api/message-cards/[id]/read — mark a single card as read
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth();
    const { id } = await params;
    const db = getDb();

    // Verify card belongs to user via subscription
    const card = (await db
      .select({
        id: messageCards.id,
        subscriptionId: messageCards.subscriptionId,
        readAt: messageCards.readAt,
        userId: subscriptions.userId,
      })
      .from(messageCards)
      .innerJoin(subscriptions, eq(messageCards.subscriptionId, subscriptions.id))
      .where(eq(messageCards.id, id)))[0];

    if (!card || card.userId !== session.userId) {
      return Response.json({ error: 'Not found' }, { status: 404 });
    }

    // Only update if not already read
    if (!card.readAt) {
      const now = new Date();
      await db.update(messageCards).set({ readAt: now }).where(eq(messageCards.id, id));

      // Decrement subscription.unreadCount (floor at 0)
      await db.update(subscriptions)
        .set({
          unreadCount: sql`MAX(0, ${subscriptions.unreadCount} - 1)`,
          updatedAt: now,
        })
        .where(eq(subscriptions.id, card.subscriptionId));
    }

    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('[message-cards/[id]/read POST]', err);
    return Response.json({ error: 'Failed to mark as read' }, { status: 500 });
  }
}
