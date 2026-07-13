import assert from 'node:assert/strict';
import test from 'node:test';
import { extractArticleMetadata } from '../src/lib/collection/articleMetadata';
import type { ArticleCandidate } from '../src/lib/collection/articleTypes';
import { validateArticleCandidate } from '../src/lib/collection/articleValidator';
import type { MonitoringIntent } from '../src/lib/search/queryPlan';

const now = new Date('2026-07-13T12:00:00Z');

function intent(overrides: Partial<MonitoringIntent> = {}): MonitoringIntent {
  return {
    topic: '鞋业动态资讯',
    criteria: '关注最近30天鞋业安全事故',
    industryTerms: ['鞋业'],
    eventTerms: ['事故', '火灾'],
    businessTerms: [],
    entities: [],
    regions: [],
    freshnessDays: 30,
    requirePublishedAt: true,
    ...overrides,
  };
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

function assertRejected(
  result: ReturnType<typeof validateArticleCandidate>,
  reason: string,
) {
  assert.equal(result.accepted, false);
  if (result.accepted) assert.fail('expected a rejected article');
  assert.equal(result.reason, reason);
}

test('accepts a current matching shoe-factory fire with canonical evidence', () => {
  const result = validateArticleCandidate(candidate(), intent(), now);

  if (!result.accepted) assert.fail(result.message);
  assert.equal(result.accepted, true);
  assert.equal(result.canonicalUrl, 'https://example.com/news/jinjiang-fire?id=7');
  assert.equal(result.publishedAt, '2026-07-12T08:00:00Z');
  assert.equal(result.publisherName, '福建新闻社');
  assert.equal(result.origin, 'search');
  assert.equal(result.evidenceLevel, 'search');
  assert.equal(result.queryEvidence.length, 1);
  assert.deepEqual(result.raw, { provider: 'serper', rank: 1 });
  assert.ok(result.relevanceScore >= 45);
  assert.match(result.matchReason, /鞋|火灾/);
});

test('rejects an otherwise relevant article published in 2023', () => {
  assertRejected(
    validateArticleCandidate(candidate({ publishedAt: '2023-07-12T08:00:00Z' }), intent(), now),
    'stale',
  );
});

test('does not rescue a missing publication date from ingestion timestamps in raw data', () => {
  assertRejected(
    validateArticleCandidate(
      candidate({
        publishedAt: undefined,
        raw: {
          createdAt: '2026-07-13T12:00:00Z',
          collectedAt: '2026-07-13T12:00:00Z',
          ingestedAt: '2026-07-13T12:00:00Z',
        },
      }),
      intent(),
      now,
    ),
    'missing_date',
  );
});

test('returns a typed rejection for an invalid publication date', () => {
  assertRejected(
    validateArticleCandidate(candidate({ publishedAt: 'not-a-real-date' }), intent(), now),
    'invalid_date',
  );
  assertRejected(
    validateArticleCandidate(candidate({ publishedAt: '2026-02-30T08:00:00Z' }), intent(), now),
    'invalid_date',
  );
  assertRejected(
    validateArticleCandidate(candidate({ publishedAt: 'Feb 30, 2026' }), intent(), now),
    'invalid_date',
  );
});

test('accepts a valid RFC 2822 feed publication date', () => {
  const result = validateArticleCandidate(
    candidate({
      origin: 'feed',
      publishedAt: 'Tue, 11 Mar 2025 17:00:00 GMT',
    }),
    intent(),
    new Date('2025-03-12T12:00:00Z'),
  );

  assert.equal(result.accepted, true);
  if (result.accepted) assert.equal(result.evidenceLevel, 'feed');
});

test('rejects a publication date more than 24 hours in the future', () => {
  assertRejected(
    validateArticleCandidate(candidate({ publishedAt: '2026-07-14T12:00:01Z' }), intent(), now),
    'future_date',
  );
});

for (const [label, url] of [
  ['homepage', 'https://example.com/'],
  ['search page', 'https://example.com/search?q=鞋厂'],
  ['product page', 'https://example.com/products/running-shoe'],
  ['about page', 'https://example.com/about'],
  ['contact page', 'https://example.com/contact-us'],
  ['listing page', 'https://example.com/category/industry-news'],
  ['search page with an HTML extension', 'https://example.com/search.html?q=鞋厂'],
  ['listing page with an HTML extension', 'https://example.com/list.html'],
] as const) {
  test(`rejects a clear ${label} URL`, () => {
    assertRejected(validateArticleCandidate(candidate({ url }), intent(), now), 'page_type');
  });
}

test('does not reject article slugs merely containing generic page-type substrings', () => {
  const result = validateArticleCandidate(
    candidate({ url: 'https://example.com/news/research-productivity-contactless-breakthrough' }),
    intent(),
    now,
  );

  assert.equal(result.accepted, true);
});

test('accepts a matching article 20 days old under an explicit 30-day intent', () => {
  const result = validateArticleCandidate(
    candidate({ publishedAt: '2026-06-23T12:00:00Z' }),
    intent(),
    now,
  );

  assert.equal(result.accepted, true);
});

test('accepts a clear search-provider date when original HTML is unavailable', () => {
  const result = validateArticleCandidate(candidate({ rawHtml: undefined }), intent(), now);

  if (!result.accepted) assert.fail(result.message);
  assert.equal(result.accepted, true);
  assert.equal(result.evidenceLevel, 'search');
});

test('original HTML publication date wins over a conflicting current search date', () => {
  const rawHtml = `
    <script type="application/ld+json">
      {"@type":"NewsArticle","headline":"鞋厂火灾旧闻","datePublished":"2023-07-12T08:00:00Z"}
    </script>
  `;

  assertRejected(
    validateArticleCandidate(candidate({ rawHtml }), intent(), now),
    'stale',
  );
});

test('merges usable fields across multiple JSON-LD article nodes', () => {
  const rawHtml = `
    <script type="application/ld+json">
      {"@type":"NewsArticle","headline":"多节点鞋厂火灾"}
    </script>
    <script type="application/ld+json">
      {"@type":"NewsArticle","datePublished":"2023-07-12T08:00:00Z"}
    </script>
    <script type="application/ld+json">
      {"@type":"NewsArticle","publisher":{"name":"多节点新闻社"}}
    </script>
    <script type="application/ld+json">
      {"@type":"NewsArticle","url":"/news/multi-node-fire"}
    </script>
  `;

  assert.deepEqual(
    extractArticleMetadata(rawHtml, 'https://example.com/source/story'),
    {
      canonicalUrl: 'https://example.com/news/multi-node-fire',
      title: '多节点鞋厂火灾',
      publisherName: '多节点新闻社',
      publishedAt: '2023-07-12T08:00:00Z',
    },
  );
});

test('merged original JSON-LD date outranks a current search date', () => {
  const rawHtml = `
    <script type="application/ld+json">
      {"@type":"NewsArticle","headline":"多节点鞋厂火灾"}
    </script>
    <script type="application/ld+json">
      {"@type":"NewsArticle","datePublished":"2023-07-12T08:00:00Z"}
    </script>
  `;

  assertRejected(validateArticleCandidate(candidate({ rawHtml }), intent(), now), 'stale');
});

test('rejects a candidate search URL even when HTML supplies an article canonical URL', () => {
  const rawHtml = '<link rel="canonical" href="https://example.com/news/canonical-fire">';

  assertRejected(
    validateArticleCandidate(
      candidate({ url: 'https://example.com/search?q=fire', rawHtml }),
      intent(),
      now,
    ),
    'page_type',
  );
});

test('rejects a non-HTTP candidate even when HTML supplies an HTTP canonical URL', () => {
  const rawHtml = '<link rel="canonical" href="https://example.com/news/canonical-fire">';

  assertRejected(
    validateArticleCandidate(candidate({ url: 'javascript:alert(1)', rawHtml }), intent(), now),
    'invalid_url',
  );
});

test('original HTML metadata wins for accepted title, description, publisher, date, and canonical URL', () => {
  const rawHtml = `
    <link href="/reports/original-fire?utm_campaign=digest#details" rel="canonical">
    <meta property="og:title" content="晋江制鞋企业火灾完成处置">
    <meta content="鞋业园区事故未造成人员伤亡。" name="description">
    <meta content="晋江发布" property="og:site_name">
    <meta content="2026-07-11T10:30:00+08:00" property="article:published_time">
  `;
  const result = validateArticleCandidate(
    candidate({
      title: '搜索标题',
      summary: '搜索摘要',
      publisherName: '搜索来源',
      publishedAt: '2026-07-13T08:00:00Z',
      rawHtml,
    }),
    intent(),
    now,
  );

  if (!result.accepted) assert.fail(result.message);
  assert.equal(result.accepted, true);
  assert.equal(result.canonicalUrl, 'https://example.com/reports/original-fire');
  assert.equal(result.title, '晋江制鞋企业火灾完成处置');
  assert.equal(result.summary, '鞋业园区事故未造成人员伤亡。');
  assert.equal(result.publisherName, '晋江发布');
  assert.equal(result.publishedAt, '2026-07-11T10:30:00+08:00');
  assert.equal(result.evidenceLevel, 'original');
});

test('rejects a current but unrelated article', () => {
  assertRejected(
    validateArticleCandidate(
      candidate({
        title: '多地优化住房公积金政策',
        summary: '房地产市场迎来新的金融支持措施。',
      }),
      intent(),
      now,
    ),
    'irrelevant',
  );
});

test('extracts JSON-LD article fields and resolves a relative canonical URL', () => {
  const metadata = extractArticleMetadata(
    `
      <link href='../canonical/fire-story' rel='canonical'>
      <script type='application/ld+json'>
        {
          "@context": "https://schema.org",
          "@type": "NewsArticle",
          "headline": "JSON-LD 鞋厂火灾",
          "description": "JSON-LD 事故摘要",
          "datePublished": "2026-07-12T09:30:00+08:00",
          "dateModified": "2026-07-13T10:00:00+08:00",
          "publisher": { "@type": "Organization", "name": "权威鞋业报" }
        }
      </script>
    `,
    'https://news.example.com/industry/2026/page.html',
  );

  assert.deepEqual(metadata, {
    canonicalUrl: 'https://news.example.com/industry/canonical/fire-story',
    title: 'JSON-LD 鞋厂火灾',
    description: 'JSON-LD 事故摘要',
    publisherName: '权威鞋业报',
    publishedAt: '2026-07-12T09:30:00+08:00',
  });
});

test('extracts article meta tags regardless of attribute order and quote style', () => {
  const metadata = extractArticleMetadata(
    `
      <meta content='Meta 鞋业标题' property='og:title'>
      <meta name="description" content='Meta 摘要'>
      <meta content="Meta 发布方" property='og:site_name'>
      <meta content='2026-07-10T03:04:05Z' property="article:published_time">
    `,
    'https://example.com/news/meta-story',
  );

  assert.equal(metadata.title, 'Meta 鞋业标题');
  assert.equal(metadata.description, 'Meta 摘要');
  assert.equal(metadata.publisherName, 'Meta 发布方');
  assert.equal(metadata.publishedAt, '2026-07-10T03:04:05Z');
});

test('skips malformed JSON-LD without throwing and still uses valid meta tags', () => {
  const metadata = extractArticleMetadata(
    `
      <script type="application/ld+json">{"headline": "broken",}</script>
      <meta property="og:title" content="Meta fallback title">
      <meta property="article:published_time" content="2026-07-09T01:02:03Z">
    `,
    'https://example.com/news/fallback',
  );

  assert.equal(metadata.title, 'Meta fallback title');
  assert.equal(metadata.publishedAt, '2026-07-09T01:02:03Z');
});

test('never treats JSON-LD dateModified as a publication date', () => {
  const metadata = extractArticleMetadata(
    `
      <script type="application/ld+json">
        {"@type":"NewsArticle","headline":"Only modified","dateModified":"2026-07-12T08:00:00Z"}
      </script>
    `,
    'https://example.com/news/modified-only',
  );

  assert.equal(metadata.publishedAt, undefined);
});
