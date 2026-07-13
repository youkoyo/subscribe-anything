import { and, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { subscriptions } from '@/lib/db/schema';
import { requireAuth } from '@/lib/auth';
import { deleteSourceLogs, retryGenerateSourceStep } from '@/lib/managed/pipeline';
import { clearSourceLLMCalls } from '@/lib/managed/llmCallStore';
import { canRetrySourceGeneration } from '@/lib/collection/hybridGeneration';
import type { FoundSource } from '@/types/wizard';

// In-memory set to prevent duplicate concurrent retries per source
const retryingSource = new Set<string>();

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

    let canonicalSource: FoundSource | undefined;
    if (sub.wizardStateJson) {
      try {
        const wizardState = JSON.parse(sub.wizardStateJson) as { foundSources?: FoundSource[] };
        canonicalSource = wizardState.foundSources?.find((source) => source.url === sourceUrl);
      } catch {
        // A malformed historical wizard state cannot authorize a built-in retry bypass.
      }
    }

    if (!canRetrySourceGeneration(sourceUrl, canonicalSource, !!sub.wizardStateJson)) {
      return Response.json(
        { error: 'Only a validated feed_script source can retry JavaScript generation' },
        { status: 409 },
      );
    }

    const key = `${id}:${sourceUrl}`;
    if (retryingSource.has(key)) {
      return Response.json({ running: true });
    }
    retryingSource.add(key);

    try {
      // Clear old logs and LLM calls only after this request owns the retry lock.
      await deleteSourceLogs(id, sourceUrl);
      clearSourceLLMCalls(id, sourceUrl);

      const source: FoundSource = canonicalSource ?? {
        title: sourceTitle,
        url: sourceUrl,
        description: sourceDescription ?? '',
      };

      retryGenerateSourceStep(id, source, sub.criteria ?? undefined, session.userId, userPrompt)
        .finally(() => retryingSource.delete(key))
        .catch(() => {});
    } catch (error) {
      retryingSource.delete(key);
      throw error;
    }

    return Response.json({ started: true }, { status: 202 });
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('[retry-source POST]', err);
    return Response.json({ error: 'Failed to start retry' }, { status: 500 });
  }
}
