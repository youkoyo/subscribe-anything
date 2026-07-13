# Local Development Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Configure this checkout to run the application against a local PostgreSQL database and verify that it is ready for `npm run dev`.

**Architecture:** Keep the application on the Windows host and run only the repository's PostgreSQL service in Docker Compose. Use the repository's existing `DATABASE_TARGET=local` selector in an ignored `.env` file; the custom server will run committed Drizzle migrations and seed defaults at startup.

**Tech Stack:** Node.js 22 LTS, npm, Next.js custom server, PostgreSQL 16, Docker Compose, Drizzle ORM

---

### Task 1: Confirm the local runtime

**Files:**
- Inspect: `package.json`
- Inspect: `docker-compose.yml`

- [x] **Step 1: Check the required executables**

Run:

```powershell
node --version
npm --version
docker version
docker compose version
```

Expected: Node reports major version 22, npm reports a version, and Docker plus Docker Compose can contact Docker Desktop.

- [x] **Step 2: Verify the installed native dependency**

Run:

```powershell
node -e "require('isolated-vm'); console.log('isolated-vm OK')"
```

Expected: `isolated-vm OK`. If the module was built for another Node version, run `npm rebuild isolated-vm` and repeat the check.

### Task 2: Select the local PostgreSQL database

**Files:**
- Create locally (Git-ignored): `.env`
- Reference: `.env.example`

- [x] **Step 1: Create the local environment file**

Create `.env` with exactly:

```dotenv
DATABASE_TARGET=local
DATABASE_URL_LOCAL=postgresql://subscribe:subscribe@localhost:5432/subscribe_anything
PORT=3000
NODE_ENV=development
NEXT_PUBLIC_BASE_URL=http://localhost:3000
```

- [x] **Step 2: Confirm secrets and machine settings remain untracked**

Run:

```powershell
git check-ignore .env
git status --short
```

Expected: `.env` is reported as ignored and does not appear in `git status`.

### Task 3: Start and verify PostgreSQL

**Files:**
- Use: `docker-compose.yml`
- Use: `drizzle-pg/0000_swift_silver_fox.sql`
- Use: `drizzle-pg/0001_source_preferences.sql`

- [x] **Step 1: Select the healthy local database service**

Run:

Run `docker compose up -d postgres` when host port `5432` is free. If another Compose checkout of this repository already publishes a healthy `subscribe/subscribe_anything` PostgreSQL instance on `localhost:5432`, verify and reuse that instance instead of stopping it or creating a competing database.

- [x] **Step 2: Wait for PostgreSQL readiness**

Run:

```powershell
docker exec subscribe-anything-main-postgres-1 pg_isready -U subscribe -d subscribe_anything
```

Expected: `/var/run/postgresql:5432 - accepting connections`. If this checkout owns the Compose service instead, use `docker compose exec postgres pg_isready -U subscribe -d subscribe_anything`.

- [x] **Step 3: Apply committed migrations**

Run:

```powershell
npm run db:migrate
```

Expected: Drizzle connects through `.env` and reports successful migration completion.

### Task 4: Verify project configuration and startup

**Files:**
- Test: `tests/envExample.test.ts`
- Test: `tests/dbConfig.test.ts`
- Test: `tests/packageScripts.test.ts`
- Use: `server.ts`

- [x] **Step 1: Run focused configuration tests**

Run:

```powershell
node --import tsx --test tests/envExample.test.ts tests/dbConfig.test.ts tests/packageScripts.test.ts
```

Expected: all focused tests pass.

- [x] **Step 2: Start the development server for a smoke test**

Run `npm run dev`, wait for `[Server] Ready on http://localhost:3000 (dev)`, then request:

```powershell
Invoke-WebRequest http://localhost:3000 -UseBasicParsing
```

Expected: the server runs migrations and seeders without errors and the request returns an HTTP success response. Stop the development server after the check; leave PostgreSQL running so the user can later run `npm run dev` directly.

### Task 5: Self-review the setup

**Files:**
- Inspect: `.env`
- Inspect: `docs/superpowers/plans/2026-07-13-local-development-setup.md`

- [x] **Step 1: Confirm the active target and final repository state**

Run:

```powershell
node --import tsx -e "const { loadEnvConfig } = require('@next/env'); const { resolveDatabaseUrl, describeDatabaseUrl } = require('./src/lib/db/config.ts'); loadEnvConfig(process.cwd(), true); console.log(describeDatabaseUrl(resolveDatabaseUrl()));"
git status --short
```

Expected: the URL description is `postgresql://subscribe@localhost:5432/subscribe_anything`; `.env` remains absent from Git status, and only this untracked plan document appears in the workspace changes.
