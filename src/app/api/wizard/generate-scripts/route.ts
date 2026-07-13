import { requireAuth } from '@/lib/auth';
import { runHybridGeneration } from '@/lib/collection/hybridGeneration';
import { sseStream } from '@/lib/utils/streamResponse';
import type { FoundSource } from '@/types/wizard';

export interface SourceToGenerate extends FoundSource {
  userPrompt?: string;
}

// POST /api/wizard/generate-scripts — SSE stream
// Body: { sources: SourceToGenerate[], criteria?: string }
// Built-in collectors finish from validated discovery data; only feed_script calls the LLM.
export async function POST(req: Request) {
  try {
    const session = await requireAuth();
    const body = await req.json().catch(() => ({}));
    const { sources, criteria } = body as { sources?: SourceToGenerate[]; criteria?: string };

    if (!Array.isArray(sources) || sources.length === 0) {
      return Response.json({ error: 'sources array is required' }, { status: 400 });
    }

    return sseStream(async (emit) => {
      await runHybridGeneration(
        sources,
        criteria?.trim() || undefined,
        async (source, sourceIndex) => {
          const { generateScriptAgent } = await import('@/lib/ai/agents/generateScriptAgent');
          emit({
            type: 'source_progress',
            sourceIndex,
            status: 'generating',
            message: 'AI 正在分析数据源...',
          });
          return generateScriptAgent(
            {
              ...source,
              criteria: criteria?.trim() || undefined,
              userPrompt: sources[sourceIndex].userPrompt?.trim() || undefined,
            },
            (message) => {
              emit({ type: 'source_progress', sourceIndex, status: 'generating', message });
            },
            (info) => {
              emit({ type: 'source_progress', sourceIndex, status: 'llm_call', llmCall: info });
            },
            session.userId,
          );
        },
        {
          onOutcome: (outcome) => {
            const generated = outcome.generatedSource;
            emit({
              type: 'source_progress',
              sourceIndex: outcome.sourceIndex,
              status: outcome.status,
              ...(generated.script ? { script: generated.script } : {}),
              cronExpression: generated.cronExpression,
              items: generated.initialItems,
              collectionMode: generated.collectionMode,
              searchPlan: generated.searchPlan,
              collectorConfigJson: generated.collectorConfigJson,
              discoveryVersion: generated.discoveryVersion,
              ...(outcome.error ? { error: outcome.error } : {}),
            });
          },
        },
      );

      emit({ type: 'done' });
    });
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('[wizard/generate-scripts POST]', err);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
