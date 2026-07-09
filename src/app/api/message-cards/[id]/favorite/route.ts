import { eq, and } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { messageCards, favorites, subscriptions, sources } from '@/lib/db/schema';
import { requireAuth } from '@/lib/auth';

// POST /api/message-cards/[id]/favorite — toggle favorite status
// Uses soft-delete: sets isFavorite flag instead of deleting
// Returns { ok: true, isFavorite: boolean }
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth();
    const { id } = await params;
    const db = getDb();

    // Check if already favorited by this user (including soft-deleted ones)
    const existingFavorite = (await db
      .select()
      .from(favorites)
      .where(and(
        eq(favorites.originalCardId, id),
        eq(favorites.userId, session.userId)
      )))[0];

    if (existingFavorite) {
      if (existingFavorite.isFavorite) {
        // Currently favorited: unfavorite by setting flag to false
        await db.update(favorites)
          .set({ isFavorite: false })
          .where(eq(favorites.id, existingFavorite.id));
        return Response.json({ ok: true, isFavorite: false });
      } else {
        // Soft-deleted: restore by setting flag to true and updating timestamp
        await db.update(favorites)
          .set({ isFavorite: true, favoriteAt: new Date() })
          .where(eq(favorites.id, existingFavorite.id));
        return Response.json({ ok: true, isFavorite: true });
      }
    }

    // Favorite: get card data and copy to favorites table
    // Verify card belongs to user via subscription
    const card = (await db
      .select({
        id: messageCards.id,
        title: messageCards.title,
        summary: messageCards.summary,
        thumbnailUrl: messageCards.thumbnailUrl,
        sourceUrl: messageCards.sourceUrl,
        publishedAt: messageCards.publishedAt,
        meetsCriteriaFlag: messageCards.meetsCriteriaFlag,
        criteriaResult: messageCards.criteriaResult,
        metricValue: messageCards.metricValue,
        subscriptionId: messageCards.subscriptionId,
        sourceId: messageCards.sourceId,
        userId: subscriptions.userId,
        subscriptionTopic: subscriptions.topic,
      })
      .from(messageCards)
      .innerJoin(subscriptions, eq(messageCards.subscriptionId, subscriptions.id))
      .where(eq(messageCards.id, id)))[0];

    if (!card || card.userId !== session.userId) {
      return Response.json({ error: 'Card not found' }, { status: 404 });
    }

    // Get source title for snapshot
    let sourceTitle: string | null = null;
    if (card.sourceId) {
      const src = (await db
        .select({ title: sources.title })
        .from(sources)
        .where(eq(sources.id, card.sourceId)))[0];
      sourceTitle = src?.title ?? null;
    }

    // Insert into favorites
    await db.insert(favorites)
      .values({
        userId: session.userId,
        originalCardId: card.id,
        title: card.title,
        summary: card.summary,
        thumbnailUrl: card.thumbnailUrl,
        sourceUrl: card.sourceUrl,
        publishedAt: card.publishedAt,
        meetsCriteriaFlag: card.meetsCriteriaFlag,
        criteriaResult: card.criteriaResult,
        metricValue: card.metricValue,
        subscriptionTopic: card.subscriptionTopic,
        sourceTitle,
        favoriteAt: new Date(),
        isFavorite: true,
      });

    return Response.json({ ok: true, isFavorite: true });
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('[message-cards/[id]/favorite POST]', err);
    return Response.json({ error: 'Failed to toggle favorite' }, { status: 500 });
  }
}

// GET /api/message-cards/[id]/favorite — check if card is favorited
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth();
    const { id } = await params;
    const db = getDb();

    const favorite = (await db
      .select()
      .from(favorites)
      .where(and(
        eq(favorites.originalCardId, id),
        eq(favorites.userId, session.userId),
        eq(favorites.isFavorite, true)
      )))[0];

    return Response.json({ isFavorite: !!favorite });
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('[message-cards/[id]/favorite GET]', err);
    return Response.json({ error: 'Failed to check favorite status' }, { status: 500 });
  }
}
