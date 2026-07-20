# HTTP Session Cookie Override Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the session-cookie secure attribute explicitly configurable for HTTP staging access while preserving the HTTPS-safe default.

**Architecture:** Keep cookie policy resolution in `src/lib/auth/session.ts`. A small exported resolver converts the optional environment flag into a boolean, enabling direct unit tests without constructing a Next.js request.

**Tech Stack:** TypeScript, Node test runner, iron-session, Docker Compose environment file.

---

### Task 1: Add a tested cookie-security resolver

**Files:**
- Create: `tests/sessionCookieSecurity.test.ts`
- Modify: `src/lib/auth/session.ts`

- [ ] **Step 1: Write the failing test**

```ts
test('uses an explicit HTTP cookie override', () => {
  assert.equal(resolveSessionCookieSecure({ NODE_ENV: 'production', SESSION_COOKIE_SECURE: 'false' }), false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import tsx --test tests/sessionCookieSecurity.test.ts`

Expected: FAIL because `resolveSessionCookieSecure` is not exported.

- [ ] **Step 3: Write the minimal implementation**

```ts
export function resolveSessionCookieSecure(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.SESSION_COOKIE_SECURE === 'true') return true;
  if (env.SESSION_COOKIE_SECURE === 'false') return false;
  return env.NODE_ENV === 'production';
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --import tsx --test tests/sessionCookieSecurity.test.ts`

Expected: PASS for explicit overrides and fallback behavior.

### Task 2: Document the deployment setting

**Files:**
- Modify: `.env.production.example`

- [ ] **Step 1: Add the explicit staging-only flag**

```dotenv
# Set to false only for temporary HTTP/IP staging access. Use true for HTTPS.
SESSION_COOKIE_SECURE=false
```

- [ ] **Step 2: Verify static checks**

Run: `npx tsc --noEmit --pretty false && npx tsc -p tsconfig.server.json --noEmit --pretty false && git diff --check`

Expected: all commands exit successfully.
