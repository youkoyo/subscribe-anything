import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('managed pipeline runs the catalog first and only falls back after zero qualified items', async () => {
  const pipeline = await readFile('src/lib/managed/pipeline.ts', 'utf8');
  const discovery = await readFile('src/lib/discovery-sources/discovery.ts', 'utf8');

  assert.match(pipeline, /discoverSourcesWithFallback/);
  assert.match(pipeline, /termProfile\?\.version === 2/);
  assert.match(pipeline, /!needsIndustryProfileExpansion\(input\.snapshot\.termProfile\)/);
  assert.doesNotMatch(pipeline, /normalizeIndustryTermProfile\(input\.snapshot\?\.termProfile/);
  assert.match(pipeline, /curated\.qualifiedItemCount > 0/);
  assert.match(pipeline, /预置源暂无强相关或有关内容/);
  assert.match(pipeline, /collectionStrategy === 'generic_rss'/);
  assert.match(pipeline, /catalogSources/);
  assert.match(discovery, /pLimit\(4\)/);
  assert.match(discovery, /classifyProfileItems/);
  assert.doesNotMatch(discovery, /classifyCandidatesWithAI/);
  assert.doesNotMatch(pipeline, /curated\.validFeedCount\s*[<>=]/);
});

test('manual wizard lets an administrator choose every discovered catalog source', async () => {
  const step2 = await readFile('src/components/wizard/Step2FindSources.tsx', 'utf8');

  assert.match(step2, /collectionStrategy === 'generic_rss'/);
  assert.match(step2, /allCatalogSources/);
  assert.doesNotMatch(step2, /if \(sources\[idx\]\?\.collectionStrategy === 'generic_rss'\) return;/);
  assert.doesNotMatch(step2, /disabled=\{!isDone \|\| isCatalogSource\}/);
  assert.doesNotMatch(step2, /\[\.\.\.allCatalogSources\(sources\), \.\.\.manuallySelected\]/);
  assert.match(step2, /return new Set\(state\.selectedIndices\);/);
  assert.match(step2, /catalog_summary/);
  assert.match(step2, /正在执行预置 RSS/);
});

test('publishing the wizard preserves preset RSS provenance for scheduled collection', async () => {
  const step4 = await readFile('src/components/wizard/Step4Confirm.tsx', 'utf8');

  for (const field of ['catalogSourceId', 'discoveryOrigin', 'collectionStrategy']) {
    assert.match(step4, new RegExp(`${field}: s\\.${field}`));
  }
});

test('script generation prioritizes preset RSS and keeps AI work from monopolizing the server', async () => {
  const pipeline = await readFile('src/lib/managed/pipeline.ts', 'utf8');

  assert.match(pipeline, /prioritizeSourcesForScriptGeneration/);
  assert.match(pipeline, /const SCRIPT_GENERATION_CONCURRENCY = 2/);
  assert.doesNotMatch(pipeline, /pLimit\(5\)/);
});

test('script generation keeps preset RSS provenance through the wizard handoff', async () => {
  const step3 = await readFile('src/components/wizard/Step3ScriptGen.tsx', 'utf8');

  for (const field of ['catalogSourceId', 'discoveryOrigin', 'collectionStrategy']) {
    assert.match(step3, new RegExp(`${field}: source\\.${field}`));
  }
});

test('script generation tells administrators which sources are queued and avoids rendering a huge idle list', async () => {
  const step3 = await readFile('src/components/wizard/Step3ScriptGen.tsx', 'utf8');

  assert.match(step3, /排队中/);
  assert.match(step3, /默认仅展示/);
  assert.match(step3, /content-visibility-auto/);
  assert.match(step3, /等待后台 Worker 领取本批任务/);
  assert.doesNotMatch(step3, /等待前面的任务完成/);
});

test('catalog collection reads every item returned by a preset RSS source', async () => {
  const discovery = await readFile('src/lib/discovery-sources/discovery.ts', 'utf8');
  const rssFetch = await readFile('src/lib/ai/tools/rssFetch.ts', 'utf8');

  assert.match(discovery, /rssFetch\(match\.source\.feedUrl,\s*\{\s*maxItems:\s*'all'\s*\}\)/);
  assert.match(rssFetch, /maxItems\?:\s*number \| 'all'/);
  assert.match(rssFetch, /options\.maxItems === 'all'/);
});

test('scheduled preset RSS collection reuses the v2 profile classifier before persisting cards', async () => {
  const collector = await readFile('src/lib/scheduler/collector.ts', 'utf8');

  assert.match(collector, /source\.collectionStrategy === 'generic_rss'/);
  assert.match(collector, /rssFetch\(source\.url, \{ maxItems: 'all' \}\)/);
  assert.match(collector, /classifyPresetRssItems\(source, subscription, rawItems\)/);
  assert.match(collector, /source\.collectionStrategy !== 'generic_rss'/);
  assert.match(collector, /snapshot\.termProfile\?\.version === 2/);
  assert.match(collector, /classifyProfileItems\(profile, candidates, subscription\?\.userId\)/);
  assert.match(collector, /relevanceLabel: relevance\.label/);
  assert.doesNotMatch(collector, /const items = runResult\.items \?\? \[\];/);
});

test('leaving script generation closes its progress stream instead of retaining database connections', async () => {
  const step3 = await readFile('src/components/wizard/Step3ScriptGen.tsx', 'utf8');
  const stream = await readFile('src/app/api/subscriptions/[id]/stream-progress/route.ts', 'utf8');

  assert.match(step3, /const handleNext = \(\) => \{\s*\/\/[^\n]*\n\s*\/\/[^\n]*\n\s*abortRef\.current\?\.abort\(\);/);
  assert.match(stream, /gte\(managedBuildLogs\.createdAt, lastSeenAt\)/);
  assert.match(stream, /controller\.desiredSize/);
  assert.match(stream, /const STREAM_MAX_AGE_MS = 5 \* 60 \* 1000/);
});

test('publishing displays its current server-side handoff stage and gives up on a stuck request', async () => {
  const step4 = await readFile('src/components/wizard/Step4Confirm.tsx', 'utf8');

  assert.match(step4, /type PublishStage = 'idle' \| 'submitting' \| 'activating' \| 'redirecting'/);
  assert.match(step4, /requestJsonWithTimeout/);
  assert.match(step4, /setPublishStage\('submitting'\)/);
  assert.match(step4, /setPublishStage\('activating'\)/);
  assert.match(step4, /setPublishStage\('redirecting'\)/);
  assert.match(step4, /发布请求超过 20 秒/);
});
