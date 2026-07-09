# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Commands

```bash
npm run dev          # Start custom Next.js server; runs migrations and schedulers first
npm run build        # Production build: next build + server TypeScript build
npm run start        # Start production server from dist/server.js
npm run db:push      # Push schema changes directly to PostgreSQL in development
npm run db:generate  # Generate PostgreSQL Drizzle migration SQL
npm run db:migrate   # Run pending Drizzle migrations
```

Use explicit test commands such as `node --import tsx --test tests/<file>.test.ts`.

## Architecture

Everything runs in one Node.js process. `server.ts` is the entrypoint:

1. `runMigrations()` applies PostgreSQL Drizzle migrations from `drizzle-pg/` and seeds defaults.
2. `initScheduler()` registers source collection cron jobs.
3. `initDeliveryScheduler()` registers enterprise industry email delivery jobs.
4. The custom Next.js HTTP server starts.

## Database

- Runtime database: PostgreSQL only.
- Required env var: `DATABASE_URL`, a PostgreSQL connection string.
- Drizzle schema: `src/lib/db/schema.ts` using `drizzle-orm/pg-core`.
- Connection: `src/lib/db/index.ts` uses `drizzle-orm/node-postgres` with `pg.Pool`.
- Queries are async. Do not use SQLite-style `.get()`, `.all()`, or `.run()`.
- Migration output directory: `drizzle-pg/`.

## Key Subsystems

- `src/lib/scheduler/`: source cron jobs and collection pipeline.
- `src/lib/managed/`: managed subscription creation pipeline.
- `src/lib/enterprise/`: industry subscriptions, pools, delivery scheduler, email digests.
- `src/lib/ai/`: OpenAI-compatible provider client, tools, and agents.
- `src/lib/email/`: SMTP, Zeabur, Resend, and Aliyun email senders.
- `src/lib/sandbox/`: `isolated-vm` script runner.

## Native Module Notes

`isolated-vm` is the main native Node.js addon.

- Windows: use Node.js 22 LTS and run `npm rebuild isolated-vm` after switching Node versions.
- Docker: uses `node:22-bookworm-slim` because Alpine/musl is incompatible with `isolated-vm` and Playwright Chromium.
- Linux: install `python3 make g++` build tools.
