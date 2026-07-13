import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { ArticleCandidate } from '../src/lib/collection/articleTypes';
import type {
  ArticleRecord,
  ArticleStore,
  PersistArticlesInput,
} from '../src/lib/collection/articleStore';
import {
  buildArticleDedupeKey,
  ingestArticles,
} from '../src/lib/collection/ingestArticles';
import { hash } from '../src/lib/utils/hash';

const now = new Date('2026-07-13T12:00:00Z');
const db = {} as never;

function subscription(id = 'subscription-1') {
  return {
    id,
    topic: '鞋业动态资讯',
    criteria: '关注最近30天鞋业安全事故',
  };
}

function source(
  id = 'source-search',
  collectorType: 'search' | 'rss' | 'json' | 'feed_script' = 'search',
) {
  return { id, collectorType };
}

function candidate(overrides: Partial<ArticleCandidate> = {}): ArticleCandidate {
  return {
    origin: 'search',
    url: 'https://Example.com:443/news/jinjiang-fire?utm_source=mail&id=7#section',
    title: '福建晋江一鞋厂发生火灾，当地正在处置',
    summary: '事故发生在制鞋产业集聚区，相关部门已开展应急处置。',
    publishedAt: '2026-07-12T08:00:00Z',
    publisherName: '福建新闻社',
    queryEvidence: [
      {
        queryId: 'query-1',
        query: '鞋业 火灾',
        title: '福建晋江一鞋厂发生火灾，当地正在处置',
        url: 'https://example.com/news/jinjiang-fire',
        snippet: '事故发生在制鞋产业集聚区。',
        publishedAt: '2026-07-12T08:00:00Z',
        publisherName: '福建新闻社',
      },
    ],
    raw: { provider: 'serper', rank: 1 },
    ...overrides,
  };
}

interface SubscriptionCounters {
  unreadCount: number;
  totalCount: number;
  lastUpdatedAt?: Date;
}

class InMemoryArticleStore implements ArticleStore {
  readonly records: ArticleRecord[] = [];
  readonly sourceItemsCollected = new Map<string, number>();
  readonly subscriptionCounters = new Map<string, SubscriptionCounters>();
  private readonly dedupeKeys = new Set<string>();

  seedConflict(subscriptionId: string, dedupeKey: string) {
    this.dedupeKeys.add(`${subscriptionId}\0${dedupeKey}`);
  }

  async persistArticles(input: PersistArticlesInput): Promise<number> {
    let inserted = 0;

    for (const article of input.articles) {
      const key = `${article.subscriptionId}\0${article.dedupeKey}`;
      if (this.dedupeKeys.has(key)) continue;
      this.dedupeKeys.add(key);
      this.records.push(article);
      inserted += 1;
    }

    if (inserted > 0) {
      this.sourceItemsCollected.set(
        input.sourceId,
        (this.sourceItemsCollected.get(input.sourceId) ?? 0) + inserted,
      );
      const counters = this.subscriptionCounters.get(input.subscriptionId) ?? {
        unreadCount: 0,
        totalCount: 0,
      };
      counters.unreadCount += inserted;
      counters.totalCount += inserted;
      counters.lastUpdatedAt = input.now;
      this.subscriptionCounters.set(input.subscriptionId, counters);
    }

    return inserted;
  }
}

test('persists a validated current article with canonical evidence and its exact date', async () => {
  const store = new InMemoryArticleStore();

  const result = await ingestArticles({
    db,
    source: source(),
    subscription: subscription(),
    candidates: [candidate()],
    now,
    store,
  });

  assert.deepEqual(result, { inserted: 1, rejected: 0, duplicates: 0 });
  assert.equal(store.records.length, 1);
  const record = store.records[0];
  assert.equal(record.subscriptionId, 'subscription-1');
  assert.equal(record.sourceId, 'source-search');
  assert.equal(record.title, candidate().title);
  assert.equal(record.summary, candidate().summary);
  assert.equal(record.sourceUrl, 'https://Example.com:443/news/jinjiang-fire?utm_source=mail&id=7#section');
  assert.equal(record.canonicalUrl, 'https://example.com/news/jinjiang-fire?id=7');
  assert.equal(record.publisherName, '福建新闻社');
  assert.equal(record.collectionMethod, 'search');
  assert.equal(record.evidenceLevel, 'search');
  assert.equal(record.publishedAt.toISOString(), '2026-07-12T08:00:00.000Z');
  assert.equal(record.authorityScore, null);
  assert.equal(record.meetsCriteriaFlag, true);
  assert.equal(record.criteriaResult, 'matched');
  assert.ok(record.relevanceScore >= 45);
  assert.match(record.matchReason, /鞋|火灾/);
  assert.equal(record.contentHash, hash(candidate().title + candidate().url));
  assert.ok(record.dedupeKey);
  assert.deepEqual(JSON.parse(record.rawData), {
    queryEvidence: candidate().queryEvidence,
    raw: { provider: 'serper', rank: 1 },
  });
});

test('rejects a missing publication date despite raw ingestion timestamps', async () => {
  const store = new InMemoryArticleStore();

  const result = await ingestArticles({
    db,
    source: source(),
    subscription: subscription(),
    candidates: [candidate({
      publishedAt: undefined,
      raw: {
        createdAt: now.toISOString(),
        collectedAt: now.toISOString(),
        ingestedAt: now.toISOString(),
      },
    })],
    now,
    store,
  });

  assert.deepEqual(result, { inserted: 0, rejected: 1, duplicates: 0 });
  assert.equal(store.records.length, 0);
  assert.equal(store.sourceItemsCollected.size, 0);
  assert.equal(store.subscriptionCounters.size, 0);
});

test('deduplicates one canonical article across search and feed sources', async () => {
  const store = new InMemoryArticleStore();

  const searchResult = await ingestArticles({
    db,
    source: source('source-search', 'search'),
    subscription: subscription(),
    candidates: [candidate()],
    now,
    store,
  });
  const feedResult = await ingestArticles({
    db,
    source: source('source-feed', 'rss'),
    subscription: subscription(),
    candidates: [candidate({
      origin: 'feed',
      url: 'https://example.com/news/jinjiang-fire?id=7',
      queryEvidence: [],
      raw: { feed: 'https://example.com/feed.xml' },
    })],
    now,
    store,
  });

  assert.deepEqual(searchResult, { inserted: 1, rejected: 0, duplicates: 0 });
  assert.deepEqual(feedResult, { inserted: 0, rejected: 0, duplicates: 1 });
  assert.equal(store.records.length, 1);
  assert.equal(store.records[0].sourceId, 'source-search');
});

test('counts a repeated canonical URL in one batch as one insert and one duplicate', async () => {
  const store = new InMemoryArticleStore();

  const result = await ingestArticles({
    db,
    source: source(),
    subscription: subscription(),
    candidates: [
      candidate(),
      candidate({ url: 'https://example.com/news/jinjiang-fire?id=7' }),
    ],
    now,
    store,
  });

  assert.deepEqual(result, { inserted: 1, rejected: 0, duplicates: 1 });
  assert.equal(store.records.length, 1);
});

test('uses the store conflict result for exact counters and only timestamps real inserts', async () => {
  const store = new InMemoryArticleStore();
  const conflictUrl = 'https://example.com/news/jinjiang-fire?id=7';
  store.seedConflict(
    'subscription-1',
    buildArticleDedupeKey('subscription-1', conflictUrl),
  );

  const conflictOnly = await ingestArticles({
    db,
    source: source(),
    subscription: subscription(),
    candidates: [candidate({ url: conflictUrl })],
    now,
    store,
  });

  assert.deepEqual(conflictOnly, { inserted: 0, rejected: 0, duplicates: 1 });
  assert.equal(store.sourceItemsCollected.size, 0);
  assert.equal(store.subscriptionCounters.size, 0);

  const mixed = await ingestArticles({
    db,
    source: source(),
    subscription: subscription(),
    candidates: [
      candidate({ url: conflictUrl }),
      candidate({
        url: 'https://example.com/news/quanzhou-shoe-factory-fire',
        title: '泉州一鞋厂发生火灾，消防部门及时处置',
      }),
    ],
    now,
    store,
  });

  assert.deepEqual(mixed, { inserted: 1, rejected: 0, duplicates: 1 });
  assert.equal(store.sourceItemsCollected.get('source-search'), 1);
  assert.deepEqual(store.subscriptionCounters.get('subscription-1'), {
    unreadCount: 1,
    totalCount: 1,
    lastUpdatedAt: now,
  });
});

test('derives a stable dedupe key from both subscription and canonical URL', () => {
  const canonicalUrl = 'https://example.com/news/jinjiang-fire';
  const first = buildArticleDedupeKey('subscription-1', canonicalUrl);

  assert.equal(first, buildArticleDedupeKey('subscription-1', canonicalUrl));
  assert.notEqual(first, buildArticleDedupeKey('subscription-2', canonicalUrl));
  assert.notEqual(
    first,
    buildArticleDedupeKey('subscription-1', 'https://example.com/news/another-fire'),
  );
});

test('propagates unexpected article store failures', async () => {
  const failure = new Error('database unavailable');
  const store: ArticleStore = {
    async persistArticles() {
      throw failure;
    },
  };

  await assert.rejects(
    ingestArticles({
      db,
      source: source(),
      subscription: subscription(),
      candidates: [candidate()],
      now,
      store,
    }),
    (error) => error === failure,
  );
});

test('production store uses one transaction and counts returned inserts only', () => {
  const articleStore = readFileSync(
    new URL('../src/lib/collection/articleStore.ts', import.meta.url),
    'utf8',
  );

  assert.match(articleStore, /db\.transaction\s*\(/);
  assert.match(articleStore, /\.onConflictDoNothing\s*\(/);
  assert.match(articleStore, /\.returning\s*\(/);
  assert.match(articleStore, /insertedRows\.length/);
});

test('scheduler and subscription creation route every item through unified ingestion', () => {
  const scheduler = readFileSync(
    new URL('../src/lib/scheduler/collector.ts', import.meta.url),
    'utf8',
  );
  const creator = readFileSync(
    new URL('../src/lib/subscriptionCreator.ts', import.meta.url),
    'utf8',
  );

  assert.match(scheduler, /ingestArticles\s*\(/);
  assert.match(scheduler, /items\.map\s*\(/);
  assert.match(scheduler, /rejected\s*\+\s*ingestResult\.duplicates/);
  assert.doesNotMatch(scheduler, /db\.insert\(messageCards\)/);
  assert.doesNotMatch(scheduler, /itemsCollected\s*:/);
  assert.doesNotMatch(scheduler, /publishedAt\s*:.*\bnow\b/);

  assert.match(creator, /\.select\(\)\.from\(subscriptions\)/);
  assert.match(creator, /collectorType:\s*srcInput\.collectionMode\s*\?\?\s*'feed_script'/);
  assert.match(creator, /collectorConfigJson:\s*JSON\.stringify\(srcInput\.searchPlan\s*\?\?\s*\{\}\)/);
  assert.match(creator, /ingestArticles\s*\(/);
  assert.doesNotMatch(creator, /messageCards/);
  assert.doesNotMatch(creator, /itemsCollected\s*:/);
  assert.doesNotMatch(creator, /publishedAt\s*:.*\bnow\b/);
});
