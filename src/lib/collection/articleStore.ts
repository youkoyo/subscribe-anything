import { eq, sql } from 'drizzle-orm';
import type { getDb } from '@/lib/db';
import { messageCards, sources, subscriptions } from '@/lib/db/schema';

export type ArticleCollectionMethod = 'search' | 'rss' | 'json' | 'feed_script';

export interface ArticleRecord {
  subscriptionId: string;
  sourceId: string;
  contentHash: string;
  dedupeKey: string;
  title: string;
  summary: string | null;
  sourceUrl: string;
  canonicalUrl: string;
  publisherName: string | null;
  publishedAt: Date;
  collectionMethod: ArticleCollectionMethod;
  evidenceLevel: 'original' | 'search' | 'feed';
  relevanceScore: number;
  authorityScore: null;
  matchReason: string;
  meetsCriteriaFlag: true;
  criteriaResult: 'matched';
  rawData: string;
}

export interface PersistArticlesInput {
  sourceId: string;
  subscriptionId: string;
  articles: ArticleRecord[];
  now: Date;
}

export interface ArticleStore {
  persistArticles(input: PersistArticlesInput): Promise<number>;
}

type Database = ReturnType<typeof getDb>;

export function createArticleStore(db: Database): ArticleStore {
  return {
    async persistArticles(input) {
      if (input.articles.length === 0) return 0;

      return db.transaction(async (tx) => {
        const insertedRows = await tx
          .insert(messageCards)
          .values(input.articles.map((article) => ({
            ...article,
            createdAt: input.now,
          })))
          .onConflictDoNothing({
            target: [messageCards.subscriptionId, messageCards.dedupeKey],
          })
          .returning({ id: messageCards.id });

        const inserted = insertedRows.length;
        if (inserted === 0) return 0;

        await tx
          .update(sources)
          .set({
            itemsCollected: sql`${sources.itemsCollected} + ${inserted}`,
            updatedAt: input.now,
          })
          .where(eq(sources.id, input.sourceId));

        await tx
          .update(subscriptions)
          .set({
            unreadCount: sql`${subscriptions.unreadCount} + ${inserted}`,
            totalCount: sql`${subscriptions.totalCount} + ${inserted}`,
            lastUpdatedAt: input.now,
            updatedAt: input.now,
          })
          .where(eq(subscriptions.id, input.subscriptionId));

        return inserted;
      });
    },
  };
}
