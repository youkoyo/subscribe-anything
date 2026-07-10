import { and, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { subscriptions, managedBuildLogs } from '@/lib/db/schema';
import { requireAuth } from '@/lib/auth';
import { runFindSourcesStep, runGenerateScriptsStep } from '@/lib/managed/pipeline';
import { clearLLMCalls } from '@/lib/managed/llmCallStore';
import { parseIndustryConfigSnapshot } from '@/lib/industry-configs/subscriptionSelection';
import type { FoundSource } from '@/types/wizard';

/** Extract a comma-separated keyword string from an industry config snapshot JSON. */
function extractTopicKeywords(snapshotJson: string | null): string | undefined {
  if (!snapshotJson) return undefined;
  const snapshot = parseIndustryConfigSnapshot(snapshotJson);
  if (!snapshot) return undefined;
  const parts = [
    snapshot.name,
    snapshot.category,
    snapshot.subCategory,
    ...(snapshot.keywords ?? []),
    ...(snapshot.entities ?? []),
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : undefined;
}

// In-memory set to prevent duplicate concurrent runs per subscription+step.
// Works because everything runs in a single Node.js process.
const runningSteps = new Set<string>();

// POST /api/subscriptions/[id]/run-step
// Body: { step: 'find_sources' | 'generate_scripts', sources?: FoundSource[] }
// Starts the background step fire-and-forget.
// Returns: { started: true } | { running: true }
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth();
    const { id } = await params;
    const body = await req.json();
    const { step, sources, userPrompt } = body as { step?: string; sources?: FoundSource[]; userPrompt?: string };

    if (step !== 'find_sources' && step !== 'generate_scripts') {
      return Response.json({ error: 'Invalid step. Must be find_sources or generate_scripts' }, { status: 400 });
    }

    const db = getDb();
    const sub = (await db
      .select()
      .from(subscriptions)
      .where(and(eq(subscriptions.id, id), eq(subscriptions.userId, session.userId))))[0];

    if (!sub) {
      return Response.json({ error: 'Not found' }, { status: 404 });
    }

    const key = `${id}:${step}`;
    if (runningSteps.has(key)) {
      return Response.json({ running: true });
    }

    if (step === 'find_sources') {
      // Clear old find_sources logs and LLM calls to start fresh
      clearLLMCalls(id);
      await db.delete(managedBuildLogs)
        .where(
          and(
            eq(managedBuildLogs.subscriptionId, id),
            eq(managedBuildLogs.step, 'find_sources')
          )
        );

      runningSteps.add(key);
      const topicKeywords = extractTopicKeywords(sub.industryConfigSnapshot);
      runFindSourcesStep(id, sub.topic, sub.criteria ?? undefined, session.userId, topicKeywords, userPrompt)
        .finally(() => runningSteps.delete(key))
        .catch(() => {});
    } else {
      // generate_scripts: clear old LLM calls, do NOT clear existing build logs —
      // runGenerateScriptsStep skips already-completed sources
      clearLLMCalls(id);
      const srcList = (sources ?? []) as FoundSource[];

      runningSteps.add(key);
      const topicKeywords = extractTopicKeywords(sub.industryConfigSnapshot);
      runGenerateScriptsStep(id, srcList, sub.criteria ?? undefined, session.userId, topicKeywords)
        .finally(() => runningSteps.delete(key))
        .catch(() => {});
    }

    return Response.json({ started: true }, { status: 202 });
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('[run-step POST]', err);
    return Response.json({ error: 'Failed to start step' }, { status: 500 });
  }
}
