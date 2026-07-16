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
  assert.match(pipeline, /const unique = new Map<string, FoundSource>\(\)/);
  assert.match(discovery, /pLimit\(4\)/);
  assert.match(discovery, /classifyProfileItems/);
  assert.doesNotMatch(discovery, /classifyCandidatesWithAI/);
  assert.doesNotMatch(pipeline, /curated\.validFeedCount\s*[<>=]/);
});

test('legacy discovery requests a sufficiently broad, source-quality-first candidate set without a five-source truncation', async () => {
  const [agent, pipeline] = await Promise.all([
    readFile('src/lib/ai/agents/findSourcesAgent.ts', 'utf8'),
    readFile('src/lib/managed/pipeline.ts', 'utf8'),
  ]);

  assert.match(agent, /const MIN_DISCOVERY_SOURCE_COUNT = 20/);
  assert.match(agent, /MIN_MAINSTREAM_SOURCE_COUNT = 5/);
  assert.match(agent, /MIN_NON_FINANCE_MAINSTREAM_SOURCE_COUNT = 3/);
  assert.match(agent, /MAX_FINANCE_MAINSTREAM_SOURCE_COUNT = 2/);
  assert.match(agent, /sourceChannel/);
  assert.match(agent, /MIN_LOCAL_OFFICIAL_SOURCE_COUNT = 4/);
  assert.match(agent, /sourceTier/);
  assert.match(agent, /hasRequiredSourceTierCoverage/);
  assert.match(agent, /SOURCE_DISCOVERY_GUARDRAILS/);
  assert.match(agent, /isEligibleDiscoverySource/);
  assert.match(agent, /静态文章页/);
  assert.doesNotMatch(agent, /find 5-10 high-quality data sources/i);
  assert.match(pipeline, /全国与地方主流新闻/);
  assert.doesNotMatch(pipeline, /主流财经与持续更新/);
  assert.doesNotMatch(pipeline, /recommended\.slice\(0, 5\)/);
  assert.doesNotMatch(pipeline, /notRecommended\.slice\(0, 5 - recommended\.length\)/);
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

test('scheduled RSS and Firecrawl collection reuse the v2 profile classifier before persisting cards', async () => {
  const collector = await readFile('src/lib/scheduler/collector.ts', 'utf8');

  assert.match(collector, /source\.collectionStrategy === 'generic_rss'/);
  assert.match(collector, /rssFetch\(source\.url, \{ maxItems: 'all' \}\)/);
  assert.match(collector, /classifyIndustryProfileItems\(source, subscription, rawItems\)/);
  assert.match(collector, /source\.collectionStrategy === 'firecrawl_scrape'/);
  assert.match(collector, /source\.collectionStrategy !== 'generic_rss'/);
  assert.match(collector, /snapshot\.termProfile\?\.version === 2/);
  assert.match(collector, /classifyProfileItems\(profile, candidates, subscription\?\.userId\)/);
  assert.match(collector, /relevanceLabel: relevance\.label/);
  assert.doesNotMatch(collector, /const items = runResult\.items \?\? \[\];/);
});

test('leaving script generation closes its progress stream instead of retaining database connections', async () => {
  const [step2, step3, stream] = await Promise.all([
    readFile('src/components/wizard/Step2FindSources.tsx', 'utf8'),
    readFile('src/components/wizard/Step3ScriptGen.tsx', 'utf8'),
    readFile('src/app/api/subscriptions/[id]/stream-progress/route.ts', 'utf8'),
  ]);

  assert.match(step3, /const handleNext = \(\) => \{\s*\/\/[^\n]*\n\s*\/\/[^\n]*\n\s*abortRef\.current\?\.abort\(\);/);
  assert.match(stream, /gte\(managedBuildLogs\.createdAt, lastSeenAt\)/);
  assert.match(stream, /controller\.desiredSize/);
  assert.match(stream, /const STREAM_MAX_AGE_MS = 12 \* 60 \* 1000/);
  assert.match(step2, /window\.setTimeout\(\(\) => \{\s*if \(!controller\.signal\.aborted\) connectSSE\(\);/);
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

test('new industry creation can explicitly bypass the preset RSS path for legacy-flow testing', async () => {
  const [createForm, newPage, wizard, step2, runStep, takeover, pipeline] = await Promise.all([
    readFile('src/components/industry-configs/IndustryConfigCreateForm.tsx', 'utf8'),
    readFile('src/app/subscriptions/new/page.tsx', 'utf8'),
    readFile('src/components/wizard/WizardShell.tsx', 'utf8'),
    readFile('src/components/wizard/Step2FindSources.tsx', 'utf8'),
    readFile('src/app/api/subscriptions/[id]/run-step/route.ts', 'utf8'),
    readFile('src/app/api/subscriptions/[id]/managed-takeover/route.ts', 'utf8'),
    readFile('src/lib/managed/pipeline.ts', 'utf8'),
  ]);

  assert.match(createForm, /skipPresetRss/);
  assert.match(createForm, /skipPresetRss=1/);
  assert.match(newPage, /searchParams\.get\('skipPresetRss'\)/);
  assert.match(wizard, /skipPresetRss: state\.skipPresetRss/);
  assert.match(step2, /skipPresetRss: state\.skipPresetRss/);
  assert.match(runStep, /skipPresetRss\?: boolean/);
  assert.match(takeover, /skipPresetRss: wizardState\?\.skipPresetRss === true/);
  assert.match(pipeline, /if \(input\.skipPresetRss\)/);
  assert.match(pipeline, /跳过预置 RSS/);
  assert.match(pipeline, /const snapshot = await persistSubscriptionProfile\(subscriptionId, input, profile\);\s*if \(input\.skipPresetRss\)/);
  assert.match(pipeline, /buildLegacyDiscoveryCriteria/);
});

test('manual discovery durably saves its completed source list so reconnecting the wizard cannot stay stuck', async () => {
  const pipeline = await readFile('src/lib/managed/pipeline.ts', 'utf8');

  assert.match(pipeline, /export async function runFindSourcesStep/);
  assert.match(pipeline, /await updateWizardState\(subscriptionId, \{[\s\S]*?step: 2,[\s\S]*?foundSources: discovered,[\s\S]*?selectedIndices/);
  assert.match(pipeline, /managedError: null/);
});
