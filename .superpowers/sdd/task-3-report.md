# Task 3 SDD Report

## Status

DONE_WITH_CONCERNS

Task 3 article evidence extraction and strict validation are implemented. All focused and related regression tests pass. The only concern is the pre-existing project-wide TypeScript error in `tests/dbConfig.test.ts`, documented below.

## RED evidence

Only `tests/articleValidator.test.ts` and `tests/sourceSampleQuality.test.ts` were changed before the first production edit. Then ran:

`node --import tsx --test tests/articleValidator.test.ts tests/sourceSampleQuality.test.ts`

Result: exit 1. The new validator suite failed because `../src/lib/collection/articleMetadata` did not exist, and the explicit 30-day source-sample test failed because the implementation still filtered with a fixed 14-day window.

A second focused TDD cycle added the invalid calendar date `2026-02-30T08:00:00Z`. The targeted test initially failed with `stale` instead of `invalid_date`, proving JavaScript date normalization was leaking through. Strict calendar validation then made the test pass.

## Implementation decisions

- Added JSON-friendly `ArticleCandidate`, query evidence, validated article, evidence-level, and discriminated rejection contracts. Query evidence is structurally compatible with Task 2 `SearchEvidence` without modifying Task 2.
- Added dependency-free HTML metadata extraction for JSON-LD, canonical links, article/Open Graph meta tags, and title fallback. Relative canonical links resolve against the page URL; malformed JSON-LD is skipped; `dateModified` is never read as a publication date.
- Added strict candidate validation for HTTP(S) article URLs, tracking/fragment cleanup, clear non-article page paths, absolute publication dates, invalid calendar dates, configured freshness, 24-hour future tolerance, and criteria relevance.
- Original HTML metadata wins over search/feed metadata. A candidate date remains usable when original HTML has no publication date. Missing dates are always rejected.
- Criteria scoring uses `sourceName: null` and the real publication date for both `publishedAt` and `createdAt`; publisher text cannot create relevance and collection time is never a fallback.
- Updated source sample quality to use `parseDeliveryCriteria(...).timeWindowDays` with the existing default fallback, include that window in reasons, preserve 24-hour future tolerance, and remove its `createdAt: now` fallback.

## GREEN evidence

- `node --import tsx --test tests/articleValidator.test.ts tests/sourceSampleQuality.test.ts`
  - exit 0; 27 passed, 0 failed.
- `node --import tsx --test tests/articleValidator.test.ts tests/sourceSampleQuality.test.ts tests/searchCollector.test.ts tests/searchQueryPlan.test.ts`
  - exit 0; 48 passed, 0 failed.
- `node --import tsx --test tests/enterpriseCriteriaMatcher.test.ts tests/enterpriseDeliveryScoring.test.ts`
  - exit 0; 9 passed, 0 failed.
- `git diff --check`
  - exit 0.

## Type-check observation

`npx tsc --noEmit` exits 1 only for the two pre-existing `tests/dbConfig.test.ts` fixtures that omit the required `ProcessEnv.NODE_ENV`. No Task 3 file appears in the final type-check output.

## No-fallback evidence

The production-only scan for `publishedAt`/`createdAt` assignments from `now`, `?? now`, and `dateModified` returned `NO_PRODUCTION_FALLBACK_MATCHES` across the new collection modules and `sourceSampleQuality.ts`.

## Scope and files

- `src/lib/collection/articleTypes.ts`
- `src/lib/collection/articleMetadata.ts`
- `src/lib/collection/articleValidator.ts`
- `src/lib/ai/agents/sourceSampleQuality.ts`
- `tests/articleValidator.test.ts`
- `tests/sourceSampleQuality.test.ts`
- `.superpowers/sdd/task-3-report.md`

No database, scheduler, Task 2, criteria matcher, or later-task implementation was changed. The unrelated untracked `docs/superpowers/plans/2026-07-13-local-development-setup.md` was not touched or staged.
