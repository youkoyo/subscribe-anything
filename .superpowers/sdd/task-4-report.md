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
- Migration ordering is: set transaction-local timeouts, add columns, backfill every existing null key with `'legacy:' || id`, then create the unique index. The index therefore sees stable legacy values, while PostgreSQL's nullable unique-index semantics still permit old runtime inserts with null keys until Task 5.
- The migration explicitly requires a maintenance window. `lock_timeout = '5s'` makes it fail quickly when a required lock cannot be acquired, while `statement_timeout = '10min'` bounds each individual migration statement.
- Appended journal entry `idx: 2`, version `7`, tag `0002_search_collectors`, with breakpoints enabled. Added a generated `0002_snapshot.json` for the full current schema; its `prevId` points to the existing `0000_snapshot.json` ID. No extra repository migration or journal entry was generated.

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

## Review-fix RED/GREEN and generation safety

Snapshot coherence was fixed in its own TDD cycle:

- RED: 6 passed, 1 failed with `missing snapshot for 0002_search_collectors`.
- GREEN after generated snapshot installation: 7 passed, 0 failed.

Online lock safety was fixed in a second TDD cycle:

- RED: 7 passed, 1 failed because the first `ALTER TABLE` had no protected prelude.
- GREEN after the maintenance-window comment and both `SET LOCAL` statements: 8 passed, 0 failed.

The snapshot was generated from the current schema with installed Drizzle Kit `0.31.9` in a repository-external temporary directory. It contains 24 tables, including `source_preferences`, both collector columns, all eight transitional card fields, and the named two-column unique index. Only its `prevId` was adjusted with `apply_patch` to `0860ca90-f7b9-4adc-83a8-e35644b6128d`, the ID of `0000_snapshot.json`.

A dry-run copied the complete current `drizzle-pg` directory to a repository-external temporary directory and ran `drizzle-kit generate` there. Drizzle reported `No schema changes, nothing to migrate`, exited 0, and the temporary directory remained at six files before and after with zero additions. No duplicate `0001` or `0002` schema migration was produced.

Current Task 1–4 focused verification:

```text
node --import tsx --test tests/searchCollectorSchema.test.ts tests/articleValidator.test.ts tests/searchCollector.test.ts tests/searchQueryPlan.test.ts
```

Result: 66 passed, 0 failed. `git diff --check` exited 0. The typecheck result remained limited to the same two known `tests/dbConfig.test.ts` baseline errors.

## Database migration

The configured database was inspected without printing a connection URL, host, user, password, or secret. Target: `local`; database name: `subscribe_anything`.

```text
npm run db:migrate
```

Result: exited 0 with `migrations applied successfully!`.

A read-only catalog check after migration confirmed both source columns are non-null with the required defaults, all eight message-card fields exist and are nullable, and `message_cards_subscription_dedupe_key_unique` exists.

The current `message_cards` table was measured read-only at 217 rows and 425,984 total bytes (`416 kB`). This is not a large-table blocker in the configured local database. The migration must nevertheless run in a maintenance window on every target: installed Drizzle ORM executes its migrations in one transaction, so the ALTER/backfill/index locks can be held until commit. The 5-second lock timeout prevents indefinite lock acquisition waits; the 10-minute statement timeout bounds each individual statement. This is not claimed as a zero-downtime migration.

Because migration `0002` had already been applied locally before its SQL prelude was tightened, a second `npm run db:migrate` was expected to be a no-op. It exited 0; the read-only Drizzle migration-table measurement stayed at 3 rows with latest timestamp `1783913785464` before and after. No migration row or hash was manually changed.

## Self-review

- Runtime compatibility: old sources read as `feed_script`; old source config reads as `{}`; existing and new pre-Task-5 card insertion paths are not forced to provide `dedupe_key`.
- Data safety: existing cards are backfilled before unique-index creation with deterministic per-row keys, so no cross-subscription or same-subscription legacy collision is introduced.
- Index scope: the schema and SQL both use only `subscription_id` and `dedupe_key` in the required order.
- Migration execution: the SQL intentionally has no `IF NOT EXISTS`; Drizzle records and runs migration `0002` once through its journal. Raw SQL re-execution is not expected to be idempotent.
- Snapshot chain: `0002_snapshot.json` has version 7/PostgreSQL metadata, a distinct generated ID, and `prevId` equal to the existing 0000 snapshot ID. The dry-run proves it represents the current schema without follow-up migration drift.
- Lock syntax: both timeouts use PostgreSQL `SET LOCAL` inside Drizzle's migration transaction and precede every `ALTER TABLE`; no unsupported concurrent index operation was introduced.
- Secret hygiene: database evidence reports only target label, database name, row count, and relation size; no URL, host, username, password, or secret was printed or recorded.
- Review-fix scope: only `tests/searchCollectorSchema.test.ts`, `drizzle-pg/0002_search_collectors.sql`, new `drizzle-pg/meta/0002_snapshot.json`, and this report changed. The existing untracked local-development plan was neither edited nor staged.
