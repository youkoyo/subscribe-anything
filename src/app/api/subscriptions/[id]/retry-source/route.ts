import { and, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { subscriptions } from '@/lib/db/schema';
import { requireAuth } from '@/lib/auth';
import { deleteSourceLogs } from '@/lib/managed/pipeline';
import { clearSourceLLMCalls } from '@/lib/managed/llmCallStore';
import { enqueueGenerateSourceJob } from '@/lib/background-jobs/queue';
import type { FoundSource } from '@/types/wizard';

// POST /api/subscriptions/[id]/retry-source
// Body: { sourceUrl: string, sourceTitle: string, sourceDescription?: string, userPrompt?: string }
// Clears old logs for this source and starts a new generation.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth();
    const { id } = await params;
    const body = await req.json();
    const { sourceUrl, sourceTitle, sourceDescription, userPrompt } = body as {
      sourceUrl?: string;
      sourceTitle?: string;
      sourceDescription?: string;
      userPrompt?: string;
    };

    if (!sourceUrl || !sourceTitle) {
      return Response.json({ error: 'sourceUrl and sourceTitle are required' }, { status: 400 });
    }

    const db = getDb();
    const sub = (await db
      .select()
      .from(subscriptions)
      .where(and(eq(subscriptions.id, id), eq(subscriptions.userId, session.userId))))[0];

    if (!sub) {
      return Response.json({ error: 'Not found' }, { status: 404 });
    }

    // Clear old logs and LLM calls for this source
    await deleteSourceLogs(id, sourceUrl);
    clearSourceLLMCalls(id, sourceUrl);

    const source: FoundSource = {
      title: sourceTitle,
      url: sourceUrl,
      description: sourceDescription ?? '',
    };

    const queued = await enqueueGenerateSourceJob(id, source, userPrompt);

    return Response.json({ started: queued, running: !queued }, { status: 202 });
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('[retry-source POST]', err);
    return Response.json({ error: 'Failed to start retry' }, { status: 500 });
  }
}
