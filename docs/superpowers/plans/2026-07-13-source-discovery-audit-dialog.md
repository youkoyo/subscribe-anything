# Source Discovery Audit Dialog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the AI's accepted and rejected source candidates beside the Step 2 LLM log, including reasons and search evidence.

**Architecture:** The source portfolio policy creates typed audit records from every candidate and the final accepted list. The managed pipeline stores those records as a find-source log; Step 2 restores them from progress logs and opens a read-only dialog.

**Tech Stack:** Next.js client components, TypeScript, managed build logs, Node test runner.

## Global Constraints

- Preserve the existing source-selection checkbox behavior.
- Do not infer decisions in the UI; show the server-produced audit record.
- Recommended sources must continue to be backed by real search evidence.

---

### Task 1: Produce source decision records

**Files:**
- Modify: `src/lib/ai/agents/sourcePortfolioPolicy.ts`
- Modify: `src/lib/ai/agents/findSourcesAgent.ts`
- Test: `tests/sourcePortfolioPolicy.test.ts`

- [ ] Add a failing test for one accepted and one rejected candidate, asserting each has a decision, reason, and matched-domain evidence.
- [ ] Add `SourceDecisionRecord` and `buildSourceDecisionRecords`, matching evidence by hostname and retaining at most three evidence rows.
- [ ] Emit `source_audit` before the final `sources` event.
- [ ] Run `node --import tsx --test tests/sourcePortfolioPolicy.test.ts` and expect all tests to pass.

### Task 2: Persist and restore the audit

**Files:**
- Modify: `src/lib/managed/pipeline.ts`
- Modify: `src/types/wizard.ts`
- Modify: `src/components/wizard/Step2FindSources.tsx`

- [ ] Record `source_audit` as the `AI_SOURCE_AUDIT` find-source log payload.
- [ ] Add optional `sourceAudit` state and restore the latest matching payload through the existing managed-progress endpoint.
- [ ] Clear the audit on retry and update it while the find-source SSE stream is active.

### Task 3: Render the review dialog

**Files:**
- Create: `src/components/wizard/SourceDiscoveryAuditDialog.tsx`
- Modify: `src/components/wizard/Step2FindSources.tsx`

- [ ] Add an adjacent “AI 找源记录” button.
- [ ] Render adopted and rejected sections with source URL, reason, evidence titles/links, AI decision, and current manual-selection status.
- [ ] Run `npm run build` and verify TypeScript compilation succeeds.
