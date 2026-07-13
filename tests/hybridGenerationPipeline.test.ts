import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  generationLogFromOutcome,
  isReusableGeneratedSource,
  restoreGeneratedSourceFromSuccessPayload,
  runHybridGeneration,
} from '../src/lib/collection/hybridGeneration';
import type { FoundSource } from '../src/types/wizard';

const NOW = new Date('2026-07-13T08:00:00.000Z');

function currentSample(url: string) {
  return {
    title: 'Current footwear factory incident',
    url,
    summary: 'A current factory incident with a verified publication date.',
    publishedAt: '2026-07-12T06:00:00.000Z',
    publisherName: 'Industry Daily',
    evidenceLevel: 'search' as const,
    relevanceScore: 0.95,
    matchReason: 'current matching incident',
    queryEvidence: [],
  };
}

function searchSource(id: string): FoundSource {
  const searchPlan = {
    version: 1 as const,
    freshnessDays: 14,
    requirePublishedAt: true as const,
    queries: [{
      id: `query-${id}`,
      query: `footwear factory incident ${id}`,
      category: 'event' as const,
      enabled: true as const,
    }],
  };
  return {
    title: `Search ${id}`,
    url: `search://collection-plan/v1/${id}`,
    description: 'Validated deterministic search plan',
    collectionMode: 'search',
    searchPlan,
    collectorConfigJson: JSON.stringify(searchPlan),
    initialItems: [currentSample(`https://news.example.com/${id}`)],
    discoveryVersion: 1,
  };
}

function feedSource(id: string): FoundSource {
  return {
    title: `Feed ${id}`,
    url: `https://feeds.example.com/${id}`,
    description: 'Legacy feed that needs a script',
    collectionMode: 'feed_script',
    initialItems: [currentSample(`https://feeds.example.com/articles/${id}`)],
    discoveryVersion: 1,
  };
}

test('a mixed two-search two-feed build calls script generation only for feeds and isolates one feed failure', async () => {
  const sources = [searchSource('one'), feedSource('one'), searchSource('two'), feedSource('two')];
  const generatedUrls: string[] = [];

  const outcomes = await runHybridGeneration(
    sources,
    undefined,
    async (source) => {
      generatedUrls.push(source.url);
      if (source.url.endsWith('/two')) throw new Error('feed two generation failed');
      return {
        success: true,
        script: 'async function collect() { return []; }',
        cronExpression: '0 * * * *',
        initialItems: [currentSample('https://feeds.example.com/generated-one')],
      };
    },
    { now: NOW },
  );

  assert.deepEqual(generatedUrls, [
    'https://feeds.example.com/one',
    'https://feeds.example.com/two',
  ]);
  assert.deepEqual(outcomes.map((outcome) => outcome.status), [
    'success',
    'success',
    'success',
    'failed',
  ]);

  const searchOutcomes = outcomes.filter((outcome) => outcome.source.collectionMode === 'search');
  assert.equal(searchOutcomes.length, 2);
  for (const outcome of searchOutcomes) {
    assert.equal(outcome.generatedSource.script, '');
    assert.equal(outcome.generatedSource.collectionMode, 'search');
    assert.equal(outcome.generatedSource.discoveryVersion, 1);
    assert.ok(outcome.generatedSource.searchPlan?.queries.length);
    assert.ok(outcome.generatedSource.collectorConfigJson);
    assert.equal(outcome.generatedSource.initialItems.length, 1);

    const log = generationLogFromOutcome(outcome);
    assert.equal(log.level, 'success');
    assert.equal('script' in log.payload, false);
    assert.equal(log.payload.collectionMode, 'search');
    assert.equal(log.payload.initialItems?.length, 1);
  }

  assert.equal(outcomes[3].generatedSource.failedReason, 'feed two generation failed');
  assert.equal(outcomes[0].generatedSource.failedReason, undefined);
  assert.equal(outcomes[2].generatedSource.failedReason, undefined);
});

test('resume accepts a validated search success without script but rejects a scriptless feed success', () => {
  const search = searchSource('resume');
  const searchPayload = {
    sourceUrl: search.url,
    collectionMode: 'search' as const,
    searchPlan: search.searchPlan,
    collectorConfigJson: search.collectorConfigJson,
    discoveryVersion: 1 as const,
    initialItems: search.initialItems,
  };

  const restoredSearch = restoreGeneratedSourceFromSuccessPayload(
    search,
    searchPayload,
    undefined,
    NOW,
  );
  assert.ok(restoredSearch);
  assert.equal(restoredSearch.script, '');
  assert.equal(isReusableGeneratedSource(restoredSearch, undefined, NOW), true);

  const feed = feedSource('resume');
  const restoredFeed = restoreGeneratedSourceFromSuccessPayload(
    feed,
    {
      sourceUrl: feed.url,
      collectionMode: 'feed_script',
      initialItems: feed.initialItems,
    },
    undefined,
    NOW,
  );
  assert.equal(restoredFeed, null);
});

test('invalid or stale built-in collectors fail closed and never fall back to script generation', async () => {
  const invalidSearch = {
    ...searchSource('invalid'),
    discoveryVersion: undefined,
    initialItems: [],
  };
  let scriptCalls = 0;
  const [outcome] = await runHybridGeneration(
    [invalidSearch],
    undefined,
    async () => {
      scriptCalls += 1;
      return { success: true, script: 'should not run' };
    },
    { now: NOW },
  );

  assert.equal(scriptCalls, 0);
  assert.equal(outcome.status, 'failed');

  const validSearch = searchSource('stale');
  const staleItems = validSearch.initialItems!.map((item) => ({
    ...item,
    publishedAt: '2023-01-01T00:00:00.000Z',
  }));
  assert.equal(restoreGeneratedSourceFromSuccessPayload(
    validSearch,
    {
      sourceUrl: validSearch.url,
      collectionMode: 'search',
      searchPlan: validSearch.searchPlan,
      collectorConfigJson: validSearch.collectorConfigJson,
      discoveryVersion: 1,
      initialItems: staleItems,
    },
    undefined,
    NOW,
  ), null);
});

test('a legacy source with no collection mode remains a feed_script source', async () => {
  const legacy = { ...feedSource('legacy'), collectionMode: undefined };
  const calls: string[] = [];
  const [outcome] = await runHybridGeneration(
    [legacy],
    undefined,
    async (source) => {
      calls.push(source.url);
      return {
        success: true,
        script: 'async function collect() { return []; }',
        initialItems: source.initialItems,
      };
    },
    { now: NOW },
  );

  assert.deepEqual(calls, [legacy.url]);
  assert.equal(outcome.generatedSource.collectionMode, 'feed_script');
  assert.ok(outcome.generatedSource.script);
});

test('manual, managed, retry, and persistence paths are wired to mode-aware generation', async () => {
  const [manualRoute, pipeline, retryRoute, creator, step3] = await Promise.all([
    readFile('src/app/api/wizard/generate-scripts/route.ts', 'utf8'),
    readFile('src/lib/managed/pipeline.ts', 'utf8'),
    readFile('src/app/api/subscriptions/[id]/retry-source/route.ts', 'utf8'),
    readFile('src/lib/subscriptionCreator.ts', 'utf8'),
    readFile('src/components/wizard/Step3ScriptGen.tsx', 'utf8'),
  ]);

  assert.match(manualRoute, /runHybridGeneration\s*\(/);
  assert.ok((pipeline.match(/runHybridGeneration\s*\(/g) ?? []).length >= 2);
  assert.match(pipeline, /restoreGeneratedSourceFromSuccessPayload\s*\(/);
  assert.match(retryRoute, /requiresScriptGeneration\s*\(/);
  assert.ok(
    retryRoute.indexOf('requiresScriptGeneration(canonicalSource)')
    < retryRoute.indexOf('await deleteSourceLogs'),
  );
  assert.match(creator, /collectorConfigJson:\s*srcInput\.collectorConfigJson\s*\?\?/);
  assert.match(step3, /collectorConfigJson:\s*source\.collectorConfigJson/);
  assert.match(step3, /source\.collectionMode\s*\?\?\s*'feed_script'/);
});
