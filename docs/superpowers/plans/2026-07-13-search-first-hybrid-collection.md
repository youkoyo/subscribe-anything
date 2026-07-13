# Search-First Hybrid Collection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace website-first script guessing with a search-first collection plan that finds recent articles directly, while retaining verified feeds and legacy scripts as supplemental collectors.

**Architecture:** A deterministic query planner produces a versioned search plan from the subscription topic, criteria, and administrator source preferences. Search and feed collectors both emit `ArticleCandidate` objects, which pass through one strict article validator and one persistence service before becoming message cards. Existing cron scheduling remains; `sources.collectorType` dispatches the runtime collector.

**Tech Stack:** TypeScript, Next.js 15, PostgreSQL/Drizzle, Serper/Tavily, Node test runner, existing isolated-vm legacy script runner.

## Global Constraints

- Default freshness is 14 days; explicit user windows override it.
- Missing `publishedAt` is a rejection, never replaced with collection time.
- Regional sources are not global defaults.
- Search failures and feed failures are isolated; one failed collector cannot block other collectors.
- Old sources remain `feed_script` and continue to run.
- Search collectors do not generate or execute JavaScript.

---

### Task 1: Deterministic monitoring intent and query plan

**Files:**
- Create: `src/lib/search/queryPlan.ts`
- Modify: `src/lib/ai/agents/sourcePreferences.ts`
- Test: `tests/searchQueryPlan.test.ts`

**Interfaces:**
- Produces `MonitoringIntent`, `SearchPlan`, `SearchPlanQuery`, `buildMonitoringIntent(topic, criteria)`, and `buildSearchQueryPlan(intent, preferences)`.
- `SearchPlan` is JSON-serializable and versioned as `version: 1`.

- [ ] Write failing tests proving that shoe-industry criteria produce short accident/business queries, required `site:news.cn`/`site:people.com.cn` queries, no hard-coded Fujian queries, stable deduplication, and an explicit 7-day window.
- [ ] Run `node --import tsx --test tests/searchQueryPlan.test.ts` and confirm missing exports fail.
- [ ] Implement the pure planner. Query text must be capped at 80 characters and the plan at 16 enabled queries. Use industry terms, event terms, business terms, entities, regions, and required administrator domains; never use the full criteria string as one query.
- [ ] Run the test and confirm all query-plan cases pass.

### Task 2: Search result dates and resilient search execution

**Files:**
- Modify: `src/lib/ai/tools/webSearch.ts`
- Create: `src/lib/search/searchCollector.ts`
- Test: `tests/searchCollector.test.ts`

**Interfaces:**
- Extend `SearchResult` with `publishedAt?: string` and `publisherName?: string` without inventing either value.
- Produce `executeSearchPlan(plan, searchFn)` returning `{ executions, candidates }` where each candidate retains query IDs and evidence.

- [ ] Write failing tests for partial query failure, duplicate URL merging, evidence accumulation, and exact preservation of search-provider dates.
- [ ] Run the test and verify the collector module is missing.
- [ ] Map Serper `date` and Tavily date fields when present. Implement limited-concurrency query execution; a failed query records an execution error and does not discard successful results.
- [ ] Canonicalize search URLs by removing fragments and tracking parameters before deduplication.
- [ ] Run `tests/searchCollector.test.ts` and existing source preference tests.

### Task 3: Strict article evidence and validation

**Files:**
- Create: `src/lib/collection/articleTypes.ts`
- Create: `src/lib/collection/articleMetadata.ts`
- Create: `src/lib/collection/articleValidator.ts`
- Modify: `src/lib/ai/agents/sourceSampleQuality.ts`
- Test: `tests/articleValidator.test.ts`
- Test: `tests/sourceSampleQuality.test.ts`

**Interfaces:**
- `ArticleCandidate` carries search/feed origin, URL, title, summary, optional real date, publisher, query evidence, and raw data.
- `validateArticleCandidate(candidate, intent, now)` returns an accepted `ValidatedArticle` or a typed rejection.
- `extractArticleMetadata(html, url)` extracts canonical URL, headline, description, publisher, and dates from JSON-LD and article meta tags.

- [ ] Write failing tests: current shoe-factory fire passes; 2023 content fails; missing date fails; ingestion time cannot rescue missing date; future dates fail beyond 24 hours; homepage/search/product/about URLs fail; explicit 30-day criteria accepts a 20-day article; search evidence with a clear date can pass when original HTML is unavailable.
- [ ] Run the tests and confirm missing modules fail.
- [ ] Implement URL/page-type rejection, date trust selection (`original` before `search`), freshness, canonicalization, and criteria scoring using `scoreCardAgainstCriteria` with `sourceName: null`.
- [ ] Change sample-quality validation to use the parsed user window instead of hard-coded 14 days.
- [ ] Run both validator suites and confirm no fallback to `createdAt` exists in new admission code.

### Task 4: Collector data model and migration

**Files:**
- Modify: `src/lib/db/schema.ts`
- Create: `drizzle-pg/0002_search_collectors.sql`
- Modify: `drizzle-pg/meta/_journal.json`
- Modify: `src/types/wizard.ts`
- Test: `tests/searchCollectorSchema.test.ts`

**Interfaces:**
- Add `sources.collectorType` with values `search | rss | json | feed_script`, default `feed_script`.
- Add `sources.collectorConfigJson`, default `{}`.
- Add `messageCards.canonicalUrl`, `publisherName`, `collectionMethod`, `evidenceLevel`, `relevanceScore`, `authorityScore`, and `matchReason`.
- Add `messageCards.dedupeKey` with a unique subscription-scoped index.
- Add `collectionMode` and `searchPlan` to wizard source types.

- [ ] Write a failing source test that scans all migration SQL and schema source for the new columns, legacy default, and unique dedupe index.
- [ ] Run it and confirm failure.
- [ ] Add the Drizzle fields and migration. Backfill existing cards with a stable ID-based dedupe key before creating the unique index; old sources default to `feed_script`.
- [ ] Run schema tests and `npm run db:migrate` against the configured local database.

### Task 5: Unified article ingestion

**Files:**
- Create: `src/lib/collection/articleStore.ts`
- Create: `src/lib/collection/ingestArticles.ts`
- Modify: `src/lib/scheduler/collector.ts`
- Modify: `src/lib/subscriptionCreator.ts`
- Test: `tests/articleIngest.test.ts`

**Interfaces:**
- `ingestArticles({ db, source, subscription, candidates, now })` validates and stores candidates, returning exact `inserted`, `rejected`, and `duplicates` counts.
- Both build-time initial samples and scheduled collection use this function.

- [ ] Write failing tests for missing-date rejection, subscription-wide canonical URL deduplication across search/feed sources, accurate conflict counts, publisher/evidence persistence, and no `publishedAt = now` fallback.
- [ ] Run the test and confirm missing ingestion service failure.
- [ ] Implement strict admission and storage. Derive `dedupeKey` from subscription ID plus canonical URL. Increment subscription/source counts only by rows actually inserted.
- [ ] Replace duplicated message-card insertion in scheduler and subscription creator with the shared ingestion service.
- [ ] Run article-ingestion and existing scheduler/subscription tests.

### Task 6: Runtime collector dispatch

**Files:**
- Create: `src/lib/collection/collectors/types.ts`
- Create: `src/lib/collection/collectors/searchSourceCollector.ts`
- Create: `src/lib/collection/collectors/rssSourceCollector.ts`
- Create: `src/lib/collection/collectors/scriptSourceCollector.ts`
- Modify: `src/lib/scheduler/collector.ts`
- Test: `tests/collectorDispatch.test.ts`

**Interfaces:**
- Each collector implements `collectCandidates(source): Promise<ArticleCandidate[]>`.
- `search` executes persisted `SearchPlan`; `rss` uses an in-process RSS/Atom parser; `feed_script` wraps `runScript`; `json` reads configured endpoint/field mappings.

- [ ] Write failing tests proving search never invokes `runScript`, legacy sources do, one failed search query does not fail a run, zero matching search results is a successful zero-item run, and RSS is parsed without an LLM.
- [ ] Run the dispatch test and confirm failure.
- [ ] Implement collector dispatch before shared ingestion. Treat zero raw results as healthy for search, but preserve retry/failure behavior for broken feed scripts.
- [ ] Run dispatch, RSS, sandbox contract, and scheduler tests.

### Task 7: Rebuild discovery around a validated collection plan

**Files:**
- Create: `src/lib/collection/discoveryPlan.ts`
- Modify: `src/lib/ai/agents/findSourcesAgent.ts`
- Modify: `src/lib/ai/agents/sourcePortfolioPolicy.ts`
- Modify: `src/lib/managed/pipeline.ts`
- Test: `tests/discoveryPlan.test.ts`

**Interfaces:**
- Discovery always returns one validated `search` collector containing the deterministic plan and current article samples when at least one recent match exists.
- Additional `rss/json/feed_script` candidates are admitted only after live sample validation.

- [ ] Write failing tests proving search result articles become samples directly; a 2023 same-domain article does not prove a source; product/about pages are rejected; dynamic search pages are classified `search`, never `feed_script`; a feed with no recent match is excluded without failing the search plan.
- [ ] Run the test and confirm failure.
- [ ] Execute the query plan during discovery and validate candidate articles. Stop using same-domain existence as the primary source admission signal.
- [ ] Keep the LLM only for optional stable-feed discovery; require live sample quality before returning those candidates.
- [ ] Emit audit records containing query, article evidence, collector mode, validation outcome, and exclusion reason.
- [ ] Run discovery, source policy, and query-plan tests.

### Task 8: Skip scripts for search collectors in manual and managed flows

**Files:**
- Modify: `src/lib/managed/pipeline.ts`
- Modify: `src/app/api/wizard/generate-scripts/route.ts`
- Modify: `src/app/api/subscriptions/[id]/retry-source/route.ts`
- Modify: `src/lib/subscriptionCreator.ts`
- Test: `tests/hybridGenerationPipeline.test.ts`

**Interfaces:**
- Search collectors produce a successful `GeneratedSource` with collector config and validated samples, no JavaScript.
- Only `feed_script` candidates call `generateScriptAgent`.

- [ ] Write failing tests for a mixed two-search/two-feed build: only feed sources invoke script generation, search sources write success logs, resume recognizes search success without requiring `payload.script`, and one feed failure cannot erase search success.
- [ ] Run the test and confirm current all-script behavior fails.
- [ ] Partition sources in both manual `runGenerateScriptsStep` and managed Phase 2. Persist search collector type/config through completion and disable script retry for search sources.
- [ ] Update historical result reuse to validate search samples without requiring a script.
- [ ] Run pipeline and managed-progress tests.

### Task 9: Wizard presentation and selection

**Files:**
- Modify: `src/components/wizard/Step2FindSources.tsx`
- Modify: `src/components/wizard/SourceDiscoveryAuditDialog.tsx`
- Modify: `src/components/wizard/Step3ScriptGen.tsx`
- Modify: `src/components/wizard/Step4Confirm.tsx`
- Test: `tests/hybridWizardSource.test.ts`

**Interfaces:**
- Step 2 displays structured intent, short queries, authority domains, recent sample articles, collector mode, and exclusions.
- Step 3 renders search collectors as terminal “检索方案验证通过” entries with no script retry/log controls.

- [ ] Write failing source tests for collector-mode labels, query/sample rendering, search terminal state, and absence of “重试生成脚本” for search collectors.
- [ ] Run the test and confirm missing UI markers.
- [ ] Implement the Step 2 plan view and audit evidence. Preserve existing source checkboxes and return-to-discovery behavior.
- [ ] Implement Step 3/4 search states while retaining feed generation UI.
- [ ] Run UI source tests and production build.

### Task 10: Delivery correctness and end-to-end acceptance

**Files:**
- Modify: `src/lib/enterprise/deliveryService.ts`
- Modify: `src/lib/enterprise/subscriptionService.ts`
- Test: `tests/searchFirstEndToEnd.test.ts`
- Test: `tests/enterpriseDeliverySource.test.ts`

**Interfaces:**
- Delivery uses `messageCards.publisherName` before collector title and selects only strict validated cards matching each user criterion.

- [ ] Write an end-to-end fixture: a current “晋江鞋厂火灾” search result with explicit date is discovered, validated, persisted through a search collector, and selected for a shoe-industry subscriber; a 2023 article, product page, missing-date result, and unrelated current article are excluded.
- [ ] Add a delivery test showing the real publisher rather than “搜索采集器”.
- [ ] Implement publisher fallback and ensure empty daily digests retain the required no-match message.
- [ ] Run all focused tests, `npm run build`, and `git diff --check`.
- [ ] Start the production server, create a fresh shoe-industry build, and verify the database contains at least one current matching search-collected article with its original publication date and evidence level.
