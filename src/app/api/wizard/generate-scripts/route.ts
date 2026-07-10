import { sseStream } from '@/lib/utils/streamResponse';
import { generateScriptAgent } from '@/lib/ai/agents/generateScriptAgent';
import { requireAuth } from '@/lib/auth';

export interface SourceToGenerate {
  title: string;
  url: string;
  description: string;
  userPrompt?: string;
}

// POST /api/wizard/generate-scripts — SSE stream
// Body: { sources: SourceToGenerate[], criteria?: string, topicKeywords?: string }
// Emits: { type: 'source_progress', sourceIndex, status, script?, items?, error? }
export async function POST(req: Request) {
  try {
    const session = await requireAuth();
    const body = await req.json().catch(() => ({}));
    const { sources, criteria, topicKeywords } = body as {
      sources?: SourceToGenerate[];
      criteria?: string;
      topicKeywords?: string;
    };

    if (!Array.isArray(sources) || sources.length === 0) {
      return Response.json({ error: 'sources array is required' }, { status: 400 });
    }

    // Derive topic keywords from criteria if the frontend didn't pass them explicitly.
    // The LLM needs a positive list of what "on-topic" means so it can hard-filter items
    // in the generated script. Without this, scripts collect loosely related (or unrelated)
    // items, and admin has to clean them out at the source level.
    const effectiveTopicKeywords =
      topicKeywords?.trim() ||
      (criteria ?? '').split(/[\s,，、;；。\n]+/).filter((kw) => kw.length >= 2).join('、') ||
      undefined;

    return sseStream(async (emit) => {
      // Kick off all sources in parallel; each one streams progress events independently
      await Promise.all(
        sources.map(async (source, i) => {
          emit({ type: 'source_progress', sourceIndex: i, status: 'generating', message: 'AI 正在分析数据源...' });

          try {
            const result = await generateScriptAgent(
              {
                ...source,
                criteria: criteria?.trim() || undefined,
                topicKeywords: effectiveTopicKeywords,
                userPrompt: source.userPrompt?.trim() || undefined,
              },
              (message) => {
                emit({ type: 'source_progress', sourceIndex: i, status: 'generating', message });
              },
              (info) => {
                emit({ type: 'source_progress', sourceIndex: i, status: 'llm_call', llmCall: info });
              },
              session.userId
            );

            if (result.success) {
              emit({
                type: 'source_progress',
                sourceIndex: i,
                status: 'success',
                script: result.script,
                cronExpression: result.cronExpression,
                items: result.initialItems,
              });
            } else if (result.sandboxUnavailable) {
              emit({
                type: 'source_progress',
                sourceIndex: i,
                status: 'unverified',
                script: result.script,
                cronExpression: result.cronExpression,
                items: [],
              });
            } else {
              emit({
                type: 'source_progress',
                sourceIndex: i,
                status: 'failed',
                script: result.script,
                error: result.error,
              });
            }
          } catch (err) {
            emit({
              type: 'source_progress',
              sourceIndex: i,
              status: 'failed',
              error: err instanceof Error ? err.message : String(err),
            });
          }
        })
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
