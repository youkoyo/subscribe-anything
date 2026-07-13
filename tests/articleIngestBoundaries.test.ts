import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ingestArticles,
  type IngestArticlesInput,
} from '../src/lib/collection/ingestArticles';
import { sources } from '../src/lib/db/schema';
import {
  clearRetry,
  getRetryState,
  isCollecting,
  type CollectResultInfo,
} from '../src/lib/scheduler/retryManager';

interface SchedulerDependencies {
  db: unknown;
  runScript: () => Promise<unknown>;
  ingestArticles: (input: IngestArticlesInput) => ReturnType<typeof ingestArticles>;
  setLastResult: (sourceId: string, result: CollectResultInfo) => void;
}

type CollectWithDependencies = (
  sourceId: string,
  dependencies: SchedulerDependencies,
) => Promise<{ newItems: number; skipped: number; error?: string }>;

interface CreatorDependencies {
  db: unknown;
  ingestArticles: (input: IngestArticlesInput) => ReturnType<typeof ingestArticles>;
}

interface CreatorSourceInput {
  title: string;
  url: string;
  script: string;
  initialItems: Array<{
    title: string;
    url: string;
    summary: string;
    publishedAt: string;
  }>;
}

type CreateSourcesWithDependencies = (
  subscriptionId: string,
  sourcesInput: CreatorSourceInput[],
  criteria: string | undefined,
  dependencies: CreatorDependencies,
) => Promise<void>;

function createSchedulerDb() {
  const source = {
    id: 'source-boundary',
    subscriptionId: 'subscription-boundary',
    title: 'Boundary source',
    script: 'async function collect() {}',
    collectorType: 'feed_script',
    cronExpression: '0 * * * *',
  };
  const subscription = {
    id: 'subscription-boundary',
    topic: '鞋业动态资讯',
    criteria: '关注最近30天鞋业安全事故',
  };
  const selections = [[source], [subscription]];
  const updates: Array<Record<string, unknown>> = [];

  return {
    updates,
    db: {
      select() {
        return {
          from() {
            return {
              async where() {
                return selections.shift() ?? [];
              },
            };
          },
        };
      },
      update() {
        return {
          set(values: Record<string, unknown>) {
            updates.push(values);
            return { async where() {} };
          },
        };
      },
    },
  };
}

function rejectAtArticleStore(failure: Error) {
  return (input: IngestArticlesInput) => ingestArticles({
    ...input,
    store: {
      async persistArticles() {
        throw failure;
      },
    },
  });
}

function containsValue(value: unknown, target: unknown, seen = new Set<unknown>()): boolean {
  if (value === target) return true;
  if (!value || typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);

  for (const key of Reflect.ownKeys(value)) {
    try {
      if (containsValue((value as Record<PropertyKey, unknown>)[key], target, seen)) return true;
    } catch {
      // Some library objects expose guarded accessors; they are irrelevant to the SQL parameter.
    }
  }
  return false;
}

function createCreatorDb(deleteFailure?: Error) {
  const insertedValues: Array<Record<string, unknown>> = [];
  const deletions: Array<{ table: unknown; condition: unknown }> = [];
  const createdSource = {
    id: 'source-created-before-ingest',
    subscriptionId: 'subscription-boundary',
    title: 'Boundary source',
    url: 'https://example.com/feed.xml',
    script: 'async function collect() {}',
    collectorType: 'feed_script',
    collectorConfigJson: '{}',
    cronExpression: '0 * * * *',
    isEnabled: true,
    status: 'active',
  };

  return {
    insertedValues,
    deletions,
    db: {
      select() {
        return {
          from() {
            return {
              async where() {
                return [{
                  id: 'subscription-boundary',
                  topic: '鞋业动态资讯',
                  criteria: '关注最近30天鞋业安全事故',
                }];
              },
            };
          },
        };
      },
      insert(table: unknown) {
        assert.equal(table, sources);
        return {
          values(values: Record<string, unknown>) {
            insertedValues.push(values);
            return {
              async returning() {
                return [createdSource];
              },
            };
          },
        };
      },
      delete(table: unknown) {
        return {
          async where(condition: unknown) {
            deletions.push({ table, condition });
            if (deleteFailure) throw deleteFailure;
          },
        };
      },
    },
  };
}

async function loadCreateSourcesWithDependencies() {
  const creatorModule = await import('../src/lib/subscriptionCreator');
  const createSourcesWithDependencies = (
    creatorModule as unknown as {
      createSourcesForSubscriptionWithDependencies?: CreateSourcesWithDependencies;
    }
  ).createSourcesForSubscriptionWithDependencies;
  assert.equal(typeof createSourcesWithDependencies, 'function');
  return createSourcesWithDependencies;
}

function creatorSourceInput(): CreatorSourceInput {
  return {
    title: 'Boundary source',
    url: 'https://example.com/feed.xml',
    script: 'async function collect() {}',
    initialItems: [{
      title: '福建晋江一鞋厂发生火灾，当地正在处置',
      url: 'https://example.com/news/jinjiang-fire',
      summary: '事故发生在制鞋产业集聚区。',
      publishedAt: new Date().toISOString(),
    }],
  };
}

test('scheduler turns an ingestion store rejection into retry state and a failed result', async () => {
  const collectorModule = await import('../src/lib/scheduler/collector');
  const collectWithDependencies = (
    collectorModule as unknown as { collectWithDependencies?: CollectWithDependencies }
  ).collectWithDependencies;
  assert.equal(typeof collectWithDependencies, 'function');
  if (!collectWithDependencies) return;

  const sourceId = 'source-boundary';
  const failure = new Error('database unavailable during article ingestion');
  const { db, updates } = createSchedulerDb();
  let recorded: { sourceId: string; result: CollectResultInfo } | undefined;
  clearRetry(sourceId);

  try {
    const result = await collectWithDependencies(sourceId, {
      db,
      async runScript() {
        return {
          success: true,
          items: [{
            title: '福建晋江一鞋厂发生火灾，当地正在处置',
            url: 'https://example.com/news/jinjiang-fire',
            summary: '事故发生在制鞋产业集聚区。',
            publishedAt: new Date().toISOString(),
          }],
        };
      },
      ingestArticles: rejectAtArticleStore(failure),
      setLastResult(recordedSourceId, resultInfo) {
        recorded = { sourceId: recordedSourceId, result: resultInfo };
      },
    });

    assert.deepEqual(result, {
      newItems: 0,
      skipped: 0,
      error: failure.message,
    });
    assert.equal(getRetryState(sourceId)?.attempt, 1);
    assert.equal(getRetryState(sourceId)?.lastError, failure.message);
    assert.equal(isCollecting(sourceId), false);
    assert.equal(updates.length, 1);
    assert.equal(updates[0].lastRunSuccess, false);
    assert.equal(updates[0].lastError, failure.message);
    assert.equal(recorded?.sourceId, sourceId);
    assert.equal(recorded?.result.success, false);
    assert.equal(recorded?.result.error, failure.message);
  } finally {
    clearRetry(sourceId);
  }
});

test('subscription creation deletes the just-created source and rethrows ingestion failure', async () => {
  const createSourcesWithDependencies = await loadCreateSourcesWithDependencies();
  if (!createSourcesWithDependencies) return;
  const failure = new Error('database unavailable during initial ingestion');
  const { db, insertedValues, deletions } = createCreatorDb();

  await assert.rejects(
    createSourcesWithDependencies(
      'subscription-boundary',
      [creatorSourceInput()],
      undefined,
      {
        db,
        ingestArticles: rejectAtArticleStore(failure),
      },
    ),
    (error) => error === failure,
  );

  assert.equal(insertedValues.length, 1);
  assert.equal(deletions.length, 1);
  assert.equal(deletions[0].table, sources);
  assert.equal(containsValue(deletions[0].condition, 'source-created-before-ingest'), true);
});

test('subscription creation exposes both ingestion and compensation failures', async () => {
  const createSourcesWithDependencies = await loadCreateSourcesWithDependencies();
  if (!createSourcesWithDependencies) return;
  const ingestionFailure = new Error('initial ingestion failed');
  const deleteFailure = new Error('source cleanup failed');
  const { db, deletions } = createCreatorDb(deleteFailure);

  await assert.rejects(
    createSourcesWithDependencies(
      'subscription-boundary',
      [creatorSourceInput()],
      undefined,
      {
        db,
        ingestArticles: rejectAtArticleStore(ingestionFailure),
      },
    ),
    (error) => error instanceof AggregateError
      && error.errors[0] === ingestionFailure
      && error.errors[1] === deleteFailure,
  );

  assert.equal(deletions.length, 1);
});
