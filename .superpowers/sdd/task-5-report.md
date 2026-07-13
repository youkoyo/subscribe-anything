# Task 5 Report: Unified Strict Article Ingestion

## Scope

- Added `src/lib/collection/articleStore.ts` as the persistence and counter-update boundary.
- Added `src/lib/collection/ingestArticles.ts` as the shared intent, validation, mapping, and result-counting pipeline.
- Routed scheduled collection and subscription-creation initial items through `ingestArticles`.
- Added stateful in-memory store tests plus wiring and transaction-source assertions in `tests/articleIngest.test.ts`.

## RED / GREEN Record

Initial RED command:

```text
node --import tsx --test tests/articleIngest.test.ts
```

It exited 1 with `Cannot find module '../src/lib/collection/ingestArticles'`, confirming the test failed because the feature was absent before production code was added.

A later focused RED tightened the retained `contentHash` contract to the existing `hash(title + sourceUrl)` behavior. That run had 8 passing tests and one expected hash mismatch. After the minimal mapping correction, the focused suite returned to 9/9 passing.

Final requested GREEN command:

```text
node --import tsx --test tests/articleIngest.test.ts tests/articleValidator.test.ts tests/searchCollectorSchema.test.ts tests/searchCollector.test.ts tests/searchQueryPlan.test.ts tests/enterpriseCriteriaMatcher.test.ts
```

Result: 79 tests passed, 0 failed.

## Validation and Mapping

- `ingestArticles` builds `MonitoringIntent` from the subscription topic and effective criteria and runs every candidate through `validateArticleCandidate`.
- Rejections are counted from the validator's typed rejection path. Missing publication dates remain rejected even when raw data contains `createdAt`, `collectedAt`, or `ingestedAt` values.
- Accepted records persist the validator's exact publication instant and canonical URL, along with publisher, collection method, evidence level, relevance score, match reason, original source URL, title, summary, query evidence, and JSON-safe raw evidence.
- Validated records set `authorityScore` to null, `meetsCriteriaFlag` to true, and `criteriaResult` to `matched`.
- `contentHash` retains the existing title-plus-source-URL mapping. `dedupeKey` deterministically hashes both subscription ID and canonical URL.

## Transaction, Conflicts, and Counts

- The production `ArticleStore` performs the message-card insert and both counter updates in one Drizzle transaction.
- The insert targets the unique `(subscription_id, dedupe_key)` conflict key, uses `onConflictDoNothing`, and calls `returning`.
- Only `insertedRows.length` drives `sources.itemsCollected`, subscription unread/total counts, `lastUpdatedAt`, and the returned `inserted` count.
- Within-batch and prior canonical conflicts are reported as `duplicates`; unexpected persistence errors are not swallowed.
- When zero rows are inserted, neither source/subscription counters nor `lastUpdatedAt` are changed.

## Wiring

- Scheduler collection maps every raw item to an `ArticleCandidate`; search sources use search origin and every other collector type uses feed origin. The existing zero-raw-items failure remains unchanged.
- Scheduler run totals, success totals, retry state, and status updates remain in place. It no longer inserts cards directly or increments article counters a second time. Notifications use the actual inserted count.
- Subscription creation loads the subscription once and only overrides its criteria when the optional argument is supplied.
- `SourceInput` now carries type-only optional `collectionMode` and `searchPlan`; source inserts persist `collectorType` and JSON search-plan config (or `{}`).
- Initial items use unified ingestion. Initial source run totals remain, failed-source handling remains unchanged, and no second item/subscription count update remains.

## Static Verification

- Source scan found no direct legacy card insert, `publishedAt`-to-`now` fallback, or duplicate `itemsCollected` update in scheduler/creator.
- Source scan confirmed exactly one subscription load in subscription creation and the production transaction/conflict/returning patterns.
- `git diff --check` passed.
- `npx tsc --noEmit --pretty false` reports only the known pre-existing `tests/dbConfig.test.ts` `ProcessEnv.NODE_ENV` errors at lines 6 and 20; it reports no Task 5 errors.
- The unrelated untracked `docs/superpowers/plans/2026-07-13-local-development-setup.md` was not edited or staged.
