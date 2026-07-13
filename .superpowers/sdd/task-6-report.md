# Task 6 Report: Runtime Collector Dispatch

## Scope

- Added a runtime collector interface and exact dispatcher for `search`, `rss`, `json`, and `feed_script` sources.
- Added search-plan, in-process RSS/Atom, mapped JSON, and legacy sandbox-script adapters.
- Rewired the scheduler to consume only `ArticleCandidate[]` from the dispatcher before the shared Task 5 ingestion boundary.
- Preserved the Task 5 retry/result behavior for collector and ingestion failures.

## RED / GREEN Record

Initial RED command:

```text
node --import tsx --test tests/collectorDispatch.test.ts
```

It exited 1 with `Cannot find module '../src/lib/collection/collectors'`, confirming the test failed because the runtime collector layer was absent.

After implementing the four adapters and dispatcher, the first ten adapter tests passed while the two scheduler tests failed because the scheduler still called the old `dependencies.runScript` seam. After the minimal scheduler wiring change, the dispatch plus Task 5 boundary suites passed 15/15.

## Collector Semantics

- `search` accepts the bare version-1 `SearchPlan` currently persisted by `subscriptionCreator`, executes it with the Task 2 resilient search executor, and never calls the script adapter. A partial query failure keeps successful results; an entirely failed plan fails the run; a successful zero-result plan returns an empty candidate list.
- Search candidates retain ordered query evidence and choose explicit dated provider evidence without inventing dates or publisher names.
- Search configuration is revalidated at runtime against the 16-query, 80-character, and unique-query-ID boundaries before any paid provider call. When duplicate URL evidence contains relative and absolute dates, only a date accepted by the shared strict publication-date parser can become `publishedAt`; all evidence remains attached.
- `rss` fetches and parses RSS 2.0 or Atom in-process with no LLM, active-RSS-instance database lookup, or sandbox dependency. It handles CDATA, common XML entities (including Atom link attributes), RSS and Atom link/date forms, feed publisher names, and structurally valid empty feeds. Atom `updated` is never substituted for a missing `published` value.
- `json` supports a deliberately small configuration: `endpoint?`, `itemsPath?`, and simple point-path mappings under `fields`. `title`, `url`, and `publishedAt` mappings are required. Invalid JSON, unsafe paths, non-array items, and HTTP failures fail explicitly; an empty array is healthy.
- `feed_script` is the only adapter that dynamically loads and invokes the sandbox runner. Thrown errors, `success: false`, and empty output all fail so the existing retry behavior remains active.
- Unknown collector types fail explicitly and never fall back to JavaScript.
- RSS and JSON share a guarded HTTP boundary: one 15-second deadline across DNS/connect/body, manual revalidation of every redirect, DNS and literal-address rejection for credentials/private/loopback/link-local targets, and streaming response reads that cancel immediately above 5 MB. The Node HTTP/HTTPS connection lookup is pinned to the exact validated address set while retaining the original Host and TLS SNI, closing the DNS-check/connection rebinding gap.

## Scheduler Wiring

- The scheduler dependency seam now accepts one `collectCandidates` function rather than `runScript`.
- Collector errors and ingestion errors both enter the existing retry/failure result boundary.
- Empty search/RSS/JSON candidates still pass through shared ingestion, clear retry state, and increment successful run statistics with zero new cards.
- Legacy script empty output is rejected inside the script adapter before ingestion.

## Verification

Focused regression command:

```text
node --import tsx --test tests/collectorDispatch.test.ts tests/searchCollector.test.ts tests/searchQueryPlan.test.ts tests/articleValidator.test.ts tests/articleIngest.test.ts tests/articleIngestBoundaries.test.ts tests/searchCollectorSchema.test.ts tests/validateScriptContract.test.ts tests/scriptGenerationGuard.test.ts tests/rssRadar.test.ts tests/sourceSampleQuality.test.ts
```

Initial result: 103 tests passed, 0 failed.

Independent specification and quality review then identified strict-date evidence selection, runtime query-budget validation, Atom `updated` misuse, Atom href entity decoding, bounded streaming, URL safety, missing-date regression coverage, endpoint override coverage, and explicit optional-config typing. Review RED added eight subtests: the focused suite returned 13 passing and 7 failing. After those fixes, the collector suite passed 20/20 and the complete focused regression passed 111/111.

Targeted quality re-review found that validation and the global `fetch` connection still performed separate DNS lookups, and that DNS waiting was outside the request deadline. Two additional RED tests failed as expected. The final connection uses a pinned Node lookup with Host/SNI preservation, and DNS resolution is raced against the same abort deadline with late rejection handlers attached. The collector suite then passed 22/22 and the complete focused regression passed 113/113. A direct pinned HTTPS probe also completed successfully.

- `npm run build` passed, including the Next.js production build and server TypeScript/alias build.
- `npx tsc --noEmit --pretty false --incremental false` reports only the two known pre-existing `tests/dbConfig.test.ts` missing-`NODE_ENV` errors at lines 6 and 20; it reports no Task 6 diagnostics.
- `git diff --check` passed.
- Static scans confirmed the scheduler no longer imports or calls `runScript`, RSS/JSON collectors do not import LLM or RSS-instance database code, and no collector creates a publication date from `now`.

## Deliberate Limits

- Runtime JSON authentication, pagination, transformations, and JSONPath expressions are outside Task 6.
- Discovery and creation of validated RSS/JSON configs remain Task 7/8 work.
- The RSS/Atom parser is intentionally bounded to common feed forms and does not attempt general XML processing.
- The URL guard is collector-local defense in depth; unifying every historical network tool behind one process-wide egress policy remains separate hardening work.
- The unrelated untracked local-development plan was not edited or staged.
