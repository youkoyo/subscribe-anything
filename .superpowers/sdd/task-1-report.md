# Task 1 Report

## Root cause

- `explicitFreshnessDays()` parsed numeric day windows and single-week/single-month phrases, but had no numeric multiplier handling for weeks or months. Consequently, `最近3周` and `过去2个月` fell through to the 14-day default.
- `buildSearchQueryPlan()` called `getRequiredSourceDomains(preferences)` without a limit. The helper's default limit of four silently discarded the fifth and later required administrator domains before the 16-query plan budget was applied.

## RED

Command:

```text
node --import tsx --test tests/searchQueryPlan.test.ts tests/sourcePreferences.test.ts
```

The initial RED run observed four new regression assertions fail for the expected reasons: `最近3周` produced 14 instead of 21 days, `过去2个月` produced 14 instead of 60 days, the fifth required domain was absent, and the over-budget plan contained 6 instead of 16 queries. Result: 12 passed, 4 failed.

Fresh review then identified two uncovered budget edges. After adding tests without changing production code, a second RED run observed 15 passed and 2 failed: a plan without explicit event terms allocated all 16 slots to required sources, and an unusably long required domain left the plan at 15 queries instead of backfilling the slot.

## Implementation

- Parse explicit numeric week windows as `weeks * 7` and numeric month windows as `months * 30`, while retaining the existing 14-day behavior for ordinary `月报`/`月度` wording.
- Reserve one open event query first, using a generic event query when no explicit event term exists, then use the remaining query budget for required source domains in administrator order. Business, entity, region, and remaining open queries use any budget left afterward.
- Count only successfully added required-source queries against the 16-query budget, so an unusably long `site:` suffix does not prevent a later valid required domain from filling the slot.
- Added regression coverage for 3-week and 2-month windows, retention of the fifth required domain, deterministic over-budget truncation to the first 15 required domains, the 16-query cap, retention of a non-`site:` event query without explicit event terms, and backfilling after an unusable required domain.

## GREEN

Command:

```text
node --import tsx --test tests/searchQueryPlan.test.ts tests/sourcePreferences.test.ts
```

Result: 17 passed, 0 failed.

## Self-review

- Confirmed `月报` and `月度` remain non-window phrases through the existing regression test.
- Confirmed required source order is asserted exactly and the fifth domain is covered when budget permits.
- Confirmed the overflow case without explicit event terms contains exactly 16 enabled queries: one open event query and the first 15 required administrator domains.
- Confirmed an unusable required-domain query does not consume an enabled-query slot and later valid domains backfill the budget.
- Confirmed the existing stability, deduplication, 80-character cap, JSON serialization, dimension coverage, and no-regional-default tests remain green.
- Confirmed `src/lib/ai/agents/sourcePreferences.ts` required no change and the unrelated untracked plan file was not edited or staged.
- `git diff --check` completed successfully; only line-ending conversion warnings were emitted by later read-only diff commands.

## Quality review follow-up: quantified week windows

Quality review found that the numeric week patterns did not accept the common `个` quantifier, so `最近3个星期` and `3个星期内` fell through to the 14-day default.

The regression tests were added before production changes. Running the focused command produced the expected RED result: 17 passed and 2 failed, with both new cases returning 14 instead of 21 days.

The minimal production change added an optional `个` before `周|星期` in both numeric week patterns. The same focused command then produced GREEN: 19 passed and 0 failed. No Chinese-number parsing, performance changes, or source-preference changes were included.
