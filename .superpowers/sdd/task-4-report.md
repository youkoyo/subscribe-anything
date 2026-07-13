# Task 4 Report

## RED

Created only `tests/searchCollectorSchema.test.ts` before production changes, then ran:

```text
node --import tsx --test tests/searchCollectorSchema.test.ts
```

Result: 0 passed, 6 failed. The failures were the expected missing source/card schema fields, missing `0002_search_collectors.sql` and journal entry, and missing wizard collection types. Test diagnostics were tightened while still RED so a missing migration produced an assertion failure rather than an `ENOENT`; no production file had been changed at that point.

## Implementation and SQL ordering

- Added `sources.collector_type` as the typed `search | rss | json | feed_script` mode with `NOT NULL DEFAULT 'feed_script'`, preserving legacy script sources.
- Added `sources.collector_config_json` as `text NOT NULL DEFAULT '{}'`.
- Added the eight nullable transitional message-card evidence/deduplication fields. `dedupe_key` intentionally remains nullable so pre-Task-5 insertion paths continue to work.
- Added the explicitly named unique index on exactly `(subscription_id, dedupe_key)`.
- Added optional `collectionMode` and typed `SearchPlan` fields to both wizard source interfaces, so existing callers remain compatible.
- Migration ordering is: add columns, backfill every existing null key with `'legacy:' || id`, then create the unique index. The index therefore sees stable legacy values, while PostgreSQL's nullable unique-index semantics still permit old runtime inserts with null keys until Task 5.
- Appended journal entry `idx: 2`, version `7`, tag `0002_search_collectors`, with breakpoints enabled. No snapshot or extra migration was created or modified.

## GREEN

Task-specific command:

```text
node --import tsx --test tests/searchCollectorSchema.test.ts
```

Result: 6 passed, 0 failed.

Focused regression command:

```text
node --import tsx --test tests/searchCollectorSchema.test.ts tests/articleValidator.test.ts tests/searchCollector.test.ts tests/searchQueryPlan.test.ts
```

Result: 64 passed, 0 failed.

`git diff --check` exited 0. Git emitted only working-tree LF/CRLF conversion warnings.

Typecheck command:

```text
npx tsc --noEmit --pretty false --incremental false
```

Result: exited 1 only for the known baseline errors at `tests/dbConfig.test.ts:6` and `tests/dbConfig.test.ts:20`, where `ProcessEnv.NODE_ENV` is missing from test fixtures. No Task 4 type error was reported.

## Database migration

The configured database was inspected without printing a connection URL, host, user, password, or secret. Target: `local`; database name: `subscribe_anything`.

```text
npm run db:migrate
```

Result: exited 0 with `migrations applied successfully!`.

A read-only catalog check after migration confirmed both source columns are non-null with the required defaults, all eight message-card fields exist and are nullable, and `message_cards_subscription_dedupe_key_unique` exists.

## Self-review

- Runtime compatibility: old sources read as `feed_script`; old source config reads as `{}`; existing and new pre-Task-5 card insertion paths are not forced to provide `dedupe_key`.
- Data safety: existing cards are backfilled before unique-index creation with deterministic per-row keys, so no cross-subscription or same-subscription legacy collision is introduced.
- Index scope: the schema and SQL both use only `subscription_id` and `dedupe_key` in the required order.
- Migration execution: the SQL intentionally has no `IF NOT EXISTS`; Drizzle records and runs migration `0002` once through its journal. Raw SQL re-execution is not expected to be idempotent.
- Scope: only the five planned implementation/test files and this report were changed. The existing untracked local-development plan was neither edited nor staged.
