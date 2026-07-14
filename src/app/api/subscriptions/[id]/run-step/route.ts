import { and, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { subscriptions, managedBuildLogs } from '@/lib/db/schema';
import { requireAuth } from '@/lib/auth';
import { clearLLMCalls } from '@/lib/managed/llmCallStore';
import { enqueueManagedStepJob } from '@/lib/background-jobs/queue';
import type { FoundSource } from '@/types/wizard';

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
    const { step, sources } = body as { step?: string; sources?: FoundSource[] };

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

      const queued = await enqueueManagedStepJob(id, 'find_sources');
      return Response.json({ started: queued, running: !queued }, { status: 202 });
    } else {
      // generate_scripts: clear old LLM calls, do NOT clear existing build logs —
      // runGenerateScriptsStep skips already-completed sources
      clearLLMCalls(id);
      const queued = await enqueueManagedStepJob(id, 'generate_scripts', (sources ?? []) as FoundSource[]);
      return Response.json({ started: queued, running: !queued }, { status: 202 });
    }
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('[run-step POST]', err);
    return Response.json({ error: 'Failed to start step' }, { status: 500 });
  }
}
