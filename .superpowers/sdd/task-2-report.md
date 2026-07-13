# Task 2 SDD Report

## Status

DONE_WITH_CONCERNS

The Task 2 implementation and required focused regression suite are complete. The only concern is an unrelated pre-existing project-wide TypeScript test error documented below.

## RED evidence

1. After creating only `tests/searchCollector.test.ts`, ran:

   `node --import tsx --test tests/searchCollector.test.ts`

   Result: exit 1. The expected failure was `Cannot find module '../src/lib/search/searchCollector'`; no production implementation existed yet.

2. Added direct coverage for the fixed concurrency limit and temporarily regressed the implementation constant from 3 to 7.

   Result: exit 1, 3 tests passed and the concurrency test failed with the expected assertion `7 !== 3`. Restoring the limit to 3 made all 4 focused tests pass.

## Implementation decisions

- Extended `SearchResult` with optional `publishedAt` and `publisherName`, preserving all existing callers.
- Added small pure Tavily and Serper mappers. Serper `date`, Tavily `published_date`, and tolerated Tavily `publishedDate` values are copied exactly without parsing, normalization, or relative-date conversion.
- `publisherName` is copied only from explicit provider `publisher` or `source` string fields; it is never inferred from a hostname, title, snippet, or date.
- Added `executeSearchPlan(plan, searchFn)` with a fixed concurrency of 3. It records per-query success/error executions, treats zero results as a successful execution, and keeps successful results when another query fails.
- Stored outcomes by SearchPlan query index before aggregation, so executions, candidates, query IDs, and evidence remain deterministic even when promises resolve out of order.
- Canonicalized URLs by removing fragments, `utm_*`, `gclid`, and `fbclid`, sorting remaining parameters, and merging duplicate canonical URLs.
- Kept collector types focused and JSON-serializable. Candidate evidence retains the query ID/text and the original result URL, title, snippet, date, and publisher fields.

## GREEN evidence

- `node --import tsx --test tests/searchCollector.test.ts`
  - exit 0; 4 passed, 0 failed.
- `node --import tsx --test tests/searchCollector.test.ts tests/sourcePreferences.test.ts`
  - exit 0; 6 passed, 0 failed.
- `node --import tsx --test tests/searchQueryPlan.test.ts`
  - exit 0; 17 passed, 0 failed.
- `git diff --check`
  - exit 0.

Additional type-check observation:

- `npx tsc --noEmit`
  - exit 1 only for two existing `tests/dbConfig.test.ts` errors where test fixtures omit the required `ProcessEnv.NODE_ENV`; neither error references a Task 2 file.

## Self-review

- Completeness: all requested provider mappings, partial-failure behavior, bounded concurrency, deterministic ordering, URL deduplication, query IDs, and evidence retention are implemented and tested.
- No overbuilding: no Task 3 article/validator types, database coupling, provider mode changes, retries, or date parsing were introduced.
- Types: collector inputs/outputs contain strings, arrays, and plain objects only; existing `webSearch(query)` remains backward-compatible.
- Error handling: thrown provider/search errors become an execution error and do not reject the complete plan; empty result arrays remain healthy successes.
- URL edge cases: standard absolute provider URLs are normalized by the platform URL parser; invalid URL strings are retained with their fragment removed instead of crashing collection.
- Scope: the unrelated untracked `docs/superpowers/plans/2026-07-13-local-development-setup.md` file was not edited or staged.

## Task files

- `src/lib/ai/tools/webSearch.ts`
- `src/lib/search/searchCollector.ts`
- `tests/searchCollector.test.ts`
- `.superpowers/sdd/task-2-report.md`

The commit SHA is reported in the task handoff because the commit contains this report.
