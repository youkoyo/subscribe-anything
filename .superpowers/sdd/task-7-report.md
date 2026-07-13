# Task 7 Report: Search-First Validated Discovery

## Scope

- Added a deterministic discovery-plan module that builds monitoring intent and bounded search queries, executes them, validates real current article evidence, and emits one versioned `search` collector with its persisted plan and initial samples.
- Kept LLM discovery optional and limited it to proposing stable RSS, JSON, or static-list candidates; every proposed stable source must produce a live, current, matching article before admission.
- Rewired managed discovery selection and audit persistence around canonical server-validated source objects. The search collector is selected first without the legacy same-domain or five-source gates.
- Added production sampling for RSS, JSON, and static HTML lists, plus explicit failure isolation, deadlines, fan-out limits, and evidence caps.

## RED / GREEN Record

The initial Task 7 tests failed because `src/lib/collection/discoveryPlan.ts` and the validated search-first orchestration did not exist. The first implementation established the deterministic search collector, stable-source validation, pipeline selection, and audit contracts.

Independent reviews then supplied additional RED cases for canonical client-object bypass, legacy discovery-log reuse, unrestricted model feed checks, optional-agent deadlines and budgets, stable-source fan-out, dynamic search URLs, product/about pages, incomplete provider evidence, query-evidence provenance, static single-article pages, and redirect-origin changes. Each case was reproduced in a focused test before the corresponding minimal fix.

The final static-list RED cases proved that a single article could masquerade as a list through bare related links or `section.related > ul`. Static HTML discovery now requires explicit `ItemList`/`CollectionPage` metadata, repeated article blocks, or positively named repeated list structures. Initial links and final redirects must stay on the exact URL origin.

## Discovery Semantics

- Search is deterministic and primary. It uses Task 1 monitoring intent/query plans and Task 2 resilient execution, then Task 3 validation to require a real publication date, current time-window match, topic/criteria match, and canonical article URL.
- Provider-only fallback evidence is accepted only when one actual query result supplies title, snippet, publisher, and an explicit parseable date. A later complete query record may win over an earlier incomplete record, while every raw query record remains unchanged in the audit trail.
- Original article metadata is fetched through the guarded collector HTTP boundary and takes precedence over provider metadata when available.
- Search pages such as `search.php`, `search.aspx`, `search.jsp`, `searchResult`, and `searchPage` are classified as search—not script feeds. Product, about, contact, homepage, and other non-article variants are rejected.
- RSS and JSON modes are honored explicitly. Generic stable pages are never inferred from same-domain search hits; they are admitted only after their own live sampler yields at least one currently valid matching article.
- Static-list sampling is conservative: it rejects article documents and related-link pseudo-lists, limits HTML size and article fan-out, fetches linked articles with bounded concurrency, and enforces exact-origin continuity across redirects.

## Pipeline and Audit Integration

- `findSourcesAgent` runs deterministic search first. Its optional LLM phase can only propose bounded stable candidates and cannot call the legacy unrestricted `checkFeed` tool.
- Optional LLM discovery has a total deadline, abort propagation into streaming/search calls, a hard web-search budget, and suppressed late emissions after cancellation.
- Discovery returns versioned collector config and validated initial samples through the wizard types. Managed auto-selection reserves the first slot for the validated search collector.
- Client selections are mapped back to canonical server objects. Legacy or malformed discovery logs cannot reintroduce unvalidated collector configs; reusable logs must have the expected version/shape and their samples must still pass current topic, criteria, and time validation.
- Audit records preserve each executed query and its own evidence provenance, plus a separate canonical validation outcome. Candidate/sample counts are retained even when stored evidence is capped.

## Verification

Final focused regression command:

```text
node --import tsx --test tests/discoveryPlan.test.ts tests/staticListSampler.test.ts tests/findSourcesAgentSafety.test.ts tests/managedDiscoverySelection.test.ts tests/sourcePortfolioPolicy.test.ts tests/sourceIntentPolicy.test.ts tests/sourcePreferences.test.ts tests/searchQueryPlan.test.ts tests/searchCollector.test.ts tests/searchCollectorSchema.test.ts tests/collectorDispatch.test.ts tests/articleValidator.test.ts tests/articleIngest.test.ts tests/articleIngestBoundaries.test.ts tests/rssRadar.test.ts tests/httpTextDecoder.test.ts
```

Result: 157 tests passed, 0 failed.

- `npm run build` passed after the final changes, including the Next.js production build and server TypeScript/alias build.
- `npx tsc --noEmit` reports only the two known pre-existing `tests/dbConfig.test.ts` missing-`NODE_ENV` errors at lines 6 and 20; it reports no Task 7 diagnostics.
- `git diff --check` passed.
- Final independent specification review and targeted quality review both returned clean. The quality reviewer reran the related-list and strict-origin counterexamples directly.

## Commits

- `0c88fae` — `feat: validate search-first discovery plans`
- `44a01cd` — `fix: harden validated source discovery`
- `3417f2d` — `fix: preserve discovery evidence provenance`
- `7128be1` — `fix: require validated static list structure`
- `3653423` — `fix: reject related-link pseudo lists`

## Deliberate Limits

- Static HTML sampling intentionally recognizes common explicit/repeated list structures rather than attempting a general browser DOM classifier.
- JSON discovery still requires an explicit safe field-mapping config; authentication, pagination, and JSONPath remain outside this task.
- Generation behavior for mixed collector types belongs to Task 8, and wizard/progress presentation belongs to Task 9.
- The unrelated untracked local-development plan was not edited or staged.
