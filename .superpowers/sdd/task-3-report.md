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

## Spec review follow-up

### RED evidence

Before changing production code, only `tests/articleValidator.test.ts` was modified and the following command was run:

`node --import tsx --test tests/articleValidator.test.ts tests/sourceSampleQuality.test.ts`

Result: exit 1; 27 passed and 7 failed. The failures independently reproduced:

- non-ISO `Feb 30, 2026` being normalized and reported as `stale` instead of `invalid_date`;
- `/search.html` and `/list.html` being accepted;
- fields after the first partial JSON-LD article node being lost, including an original stale date;
- a search-page candidate and a non-HTTP candidate bypassing validation through a valid HTML canonical URL.

The positive RFC 2822 feed-date case already passed during RED, protecting that supported format while date parsing was tightened.

### Follow-up decisions

- JSON-LD extraction now accumulates the first usable value for each metadata field across every valid article node. It still reads only `datePublished`, never `dateModified`.
- The candidate URL must independently pass HTTP(S) and article-page checks before HTML metadata is considered. A supplied metadata canonical URL is then independently canonicalized and checked again.
- Page classification removes only the known `.htm`, `.html`, `.aspx`, and `.php` suffixes before exact token matching, preserving legitimate substrings such as `research` and `contactless`.
- Publication parsing now accepts only calendar-valid ISO dates/date-times with explicit time-zone offsets and common RFC 2822 feed dates. Other year-containing strings are rejected rather than delegated to permissive JavaScript parsing.

### Follow-up GREEN evidence

- `node --import tsx --test tests/articleValidator.test.ts tests/sourceSampleQuality.test.ts`
  - exit 0; 34 passed, 0 failed.
- `node --import tsx --test tests/articleValidator.test.ts tests/sourceSampleQuality.test.ts tests/searchCollector.test.ts tests/searchQueryPlan.test.ts`
  - exit 0; 55 passed, 0 failed.
- `node --import tsx --test tests/enterpriseCriteriaMatcher.test.ts tests/enterpriseDeliveryScoring.test.ts`
  - exit 0; 9 passed, 0 failed.
- `git diff --check`
  - exit 0.
- Production no-fallback scan
  - `NO_PRODUCTION_FALLBACK_MATCHES`.

`npx tsc --noEmit` continues to report only the two pre-existing `tests/dbConfig.test.ts` fixtures that omit `ProcessEnv.NODE_ENV`; no follow-up file appears in its output.

Follow-up scope is limited to `tests/articleValidator.test.ts`, `src/lib/collection/articleMetadata.ts`, `src/lib/collection/articleValidator.ts`, and this report.

## RFC weekday follow-up

### RED evidence

Only `tests/articleValidator.test.ts` was changed before running:

`node --import tsx --test tests/articleValidator.test.ts tests/sourceSampleQuality.test.ts`

Result: exit 1; 34 passed and 1 failed. The new test proved that `Mon, 11 Mar 2025 17:00:00 GMT` was accepted even though 11 March 2025 was Tuesday. The existing valid `Tue, 11 Mar 2025 17:00:00 GMT` case continued to pass.

### Decision

The optional RFC 2822 weekday is now captured. When present, it is compared against the `Sun` through `Sat` weekday calculated from `Date.UTC(year, month - 1, day)`, avoiding host-time-zone effects. RFC dates without a weekday remain allowed.

### GREEN evidence

- `node --import tsx --test tests/articleValidator.test.ts tests/sourceSampleQuality.test.ts`
  - exit 0; 35 passed, 0 failed.
- `node --import tsx --test tests/articleValidator.test.ts tests/sourceSampleQuality.test.ts tests/searchCollector.test.ts tests/searchQueryPlan.test.ts`
  - exit 0; 56 passed, 0 failed.
- `node --import tsx --test tests/enterpriseCriteriaMatcher.test.ts tests/enterpriseDeliveryScoring.test.ts`
  - exit 0; 9 passed, 0 failed.
- `git diff --check`
  - exit 0.

`npx tsc --noEmit` still reports only the two pre-existing `tests/dbConfig.test.ts` fixtures that omit `ProcessEnv.NODE_ENV`; neither RFC weekday follow-up file appears in its output.

This follow-up changes only `src/lib/collection/articleValidator.ts`, `tests/articleValidator.test.ts`, and this report.

## Quality review follow-up

### RED evidence

Before changing production code, only `tests/articleValidator.test.ts` and `tests/sourceSampleQuality.test.ts` were modified. Then ran:

`node --import tsx --test tests/articleValidator.test.ts tests/sourceSampleQuality.test.ts`

Result: exit 1; 38 passed and 6 failed. The failures reproduced:

- source sample quality accepting an invalid calendar date and a timezone-free datetime;
- a current article permalink under `/archives/12345` being rejected as a listing;
- a relevant shoe-factory accident being rejected when the industry was present in the topic but not repeated in criteria;
- a related JSON-LD article's 2020 date being merged into the main page article and overriding current search evidence.

The valid ISO source-sample case, bare `/archives` rejection, unrelated chemical-accident rejection, and same-entity split JSON-LD aggregation all passed during RED.

### Follow-up decisions

- Exported the strict publication-date parser from `articleValidator.ts` and reused it from `sourceSampleQuality.ts`; arbitrary strings are no longer delegated directly to `new Date` in sample-quality filtering.
- JSON-LD selection identifies articles from `url`, `@id`, and `mainEntityOfPage`, normalizes fragment identities, prioritizes the page/canonical identity, and only fills fields from matching identities or identity-free nodes without a headline conflict.
- `archive` and `archives` are treated as listing tokens only when they are the final path segment; article identifiers below them remain eligible. Other page-type tokens retain their existing strict behavior.
- Relevance parsing now receives topic, criteria, and structured monitoring-intent terms together while retaining `sourceName: null`, the real publication date, and the existing scorer.

### Follow-up GREEN evidence

- `node --import tsx --test tests/articleValidator.test.ts tests/sourceSampleQuality.test.ts`
  - exit 0; 44 passed, 0 failed.
- `node --import tsx --test tests/articleValidator.test.ts tests/sourceSampleQuality.test.ts tests/searchCollector.test.ts tests/searchQueryPlan.test.ts`
  - exit 0; 65 passed, 0 failed.
- `node --import tsx --test tests/enterpriseCriteriaMatcher.test.ts tests/enterpriseDeliveryScoring.test.ts`
  - exit 0; 9 passed, 0 failed.
- `git diff --check`
  - exit 0.
- Production no-fallback scan
  - `NO_PRODUCTION_FALLBACK_MATCHES`.

`npx tsc --noEmit` still reports only the two pre-existing `tests/dbConfig.test.ts` fixtures that omit `ProcessEnv.NODE_ENV`; no quality follow-up file appears in its output.

This follow-up changes only `src/lib/collection/articleMetadata.ts`, `src/lib/collection/articleValidator.ts`, `src/lib/ai/agents/sourceSampleQuality.ts`, both Task 3 test files, and this report.

## Anonymous JSON-LD evidence follow-up

### RED evidence

Only `tests/articleValidator.test.ts` was modified before running:

`node --import tsx --test tests/articleValidator.test.ts tests/sourceSampleQuality.test.ts`

Result: exit 1; 44 passed and 2 failed. A stable-identity `NewsArticle` containing an anonymous nested `ImageObject` with a 2020 `datePublished` incorrectly exposed that date as article metadata and caused validation to reject current search evidence as stale.

### Decision

- When JSON-LD has an explicit `@type`, only configured article types are collected as article nodes. The legacy fallback for an untyped object carrying `datePublished` remains supported.
- When the selected primary article has a stable identity, only nodes with that same identity may supplement its fields. Anonymous fragments remain mergeable only when the primary itself is anonymous and their headlines do not conflict.

This keeps same-identity split metadata working while isolating explicit `ImageObject`, `CreativeWork`, related-entity, and anonymous nested evidence from identified main articles.

### GREEN evidence

- `node --import tsx --test tests/articleValidator.test.ts tests/sourceSampleQuality.test.ts`
  - exit 0; 46 passed, 0 failed.
- `node --import tsx --test tests/articleValidator.test.ts tests/sourceSampleQuality.test.ts tests/searchCollector.test.ts tests/searchQueryPlan.test.ts`
  - exit 0; 67 passed, 0 failed.
- `node --import tsx --test tests/enterpriseCriteriaMatcher.test.ts tests/enterpriseDeliveryScoring.test.ts`
  - exit 0; 9 passed, 0 failed.
- `git diff --check`
  - exit 0.

`npx tsc --noEmit` still reports only the two pre-existing `tests/dbConfig.test.ts` fixtures that omit `ProcessEnv.NODE_ENV`; neither anonymous-evidence follow-up file appears in its output.

This follow-up changes only `src/lib/collection/articleMetadata.ts`, `tests/articleValidator.test.ts`, and this report.
