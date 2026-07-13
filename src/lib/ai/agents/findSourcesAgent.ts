/**
 * findSourcesAgent — Wizard Step 2
 *
 * Agentic loop that searches the web to find 5-10 high-quality data sources
 * for a given subscription topic.
 *
 * SSE events emitted:
 *   { type: 'text', content: string }            — LLM text delta
 *   { type: 'tool_call', name: string, args: any } — tool invocation started
 *   { type: 'tool_result', name: string, resultSummary: string } — result summary
 *   { type: 'sources', sources: FoundSource[] }  — final parsed source list
 *   { type: 'error', message: string }           — (emitted by sseStream on throw)
 */

import { getTemplate, getProviderForTemplate, buildOpenAIClient, llmStream } from '@/lib/ai/client';
import type { LLMCallInfo } from '@/lib/ai/client';
import { webSearch, webSearchToolDef } from '@/lib/ai/tools/webSearch';
import { rssRadar, rssRadarToolDef } from '@/lib/ai/tools/rssRadar';
import { applySourceIntentPolicy, type SourceType } from './sourceIntentPolicy';
import { describeSourcePreferences, getActiveSourcePreferences, type SourcePreference } from './sourcePreferences';
import { discoverCollectionPlan } from '@/lib/collection/discoveryPlan';
import { createRssSourceCollector } from '@/lib/collection/collectors/rssSourceCollector';
import { createJsonSourceCollector } from '@/lib/collection/collectors/jsonSourceCollector';
import type { CollectorSource } from '@/lib/collection/collectors/types';
import { fetchCollectorText } from '@/lib/collection/collectors/httpCollectorFetch';
import { sampleStaticArticleList } from '@/lib/collection/staticListSampler';
import type { ArticleCandidate } from '@/lib/collection/articleTypes';
import type { CollectionMode, FoundSource } from '@/types/wizard';
import type OpenAI from 'openai';

type Message = OpenAI.Chat.ChatCompletionMessageParam;
const MAX_LLM_STABLE_CANDIDATES = 10;
const MAX_DISCOVERY_HTML_BYTES = 1024 * 1024;

// Appended at runtime so customized prompt rows cannot reintroduce dynamic
// search pages or same-domain guesses as script sources.
const STABLE_SOURCE_DISCOVERY_POLICY = `
**可选稳定源发现规则（必须遵守）**
系统已经独立执行确定性搜索计划并直接验证文章。你的职责只是在此基础上补充可现场采样的稳定来源。

1. 只返回明确的 RSS/Atom、带完整字段映射的 JSON API，或确实是静态文章列表的页面。
2. 动态站内搜索页、网站首页、商品目录、关于我们、历史专题和单篇文章都不能作为稳定源。
3. 每项必须输出 collectionMode：rss、json 或 feed_script。JSON 还必须输出 collectorConfigJson，包含 endpoint、itemsPath 和 fields 映射。
4. 不要根据“同域有相关文章”推断一个频道可采集；系统会对每个候选现场采样，至少一篇近期匹配文章通过后才准入。
5. 没有可靠稳定源时允许返回空数组。不要为了凑够数量而编造 URL。
`;

const SOURCE_INTENT_OUTPUT_POLICY = `
**来源类别与组合约束（必须遵守）**
每个来源必须输出 sourceType：general_news（实时综合/社会新闻）、local_news（地方政府或当地媒体）、industry_vertical（行业垂直媒体/协会）、finance（财经补充）、other（其他）。
这些类别只用于说明和排序，不是数量准入门槛。
`;

/** Optional LLM adapter: it proposes stable candidates but never admits them. */
async function discoverStableSourceCandidatesWithLlm(
  { topic, criteria }: { topic: string; criteria?: string },
  sourcePreferences: SourcePreference[],
  emit: (event: unknown) => void,
  onLLMCall?: (info: LLMCallInfo) => void,
  userId?: string | null,
  signal?: AbortSignal,
): Promise<FoundSource[]> {
  const emitWhileActive = (event: unknown) => {
    if (!signal?.aborted) emit(event);
  };
  const [provider, tpl] = await Promise.all([
    getProviderForTemplate('find-sources', userId),
    getTemplate('find-sources', userId),
  ]);
  const templateContent = tpl.content
    .replace('{{topic}}', topic)
    .replace('{{criteria}}', criteria ?? '无');

  const adminSourcePolicy = `\n管理员来源偏好（必须优先检索 required，命中后优先作为候选；preferred 用于补充，仍可扩展发现其他来源）：\n${JSON.stringify(describeSourcePreferences(sourcePreferences))}`;
  const systemContent = `${templateContent}\n${STABLE_SOURCE_DISCOVERY_POLICY}\n${SOURCE_INTENT_OUTPUT_POLICY}${adminSourcePolicy}`;

  const messages: Message[] = [
    { role: 'user', content: systemContent },
  ];

  const openai = buildOpenAIClient(provider);
  let lastTextBuffer = '';
  let allTextBuffer = '';

  // Track webSearch call count — max 10 calls as per prompt template
  let webSearchCount = 0;
  const MAX_WEB_SEARCH_CALLS = 10;

  // Agentic loop — max 32 iterations to prevent runaway
  for (let iteration = 0; iteration < 32; iteration++) {
    signal?.throwIfAborted();
    let textBuffer = '';
    const toolCallMap = new Map<number, { id: string; name: string; args: string }>();

    const stream = llmStream(openai, {
      model: provider.modelId,
      messages,
      tools: [webSearchToolDef, rssRadarToolDef],
      tool_choice: 'auto',
      stream: true,
      stream_options: { include_usage: true },
    }, { callIndex: iteration + 1, onCall: onLLMCall, signal });

    for await (const chunk of stream) {
      const choice = chunk.choices[0];
      const delta = choice?.delta;

      // Accumulate text
      if (delta?.content) {
        textBuffer += delta.content;
        emitWhileActive({ type: 'text', content: delta.content });
      }

      // Accumulate tool calls (streamed in pieces)
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          if (!toolCallMap.has(idx)) {
            toolCallMap.set(idx, { id: '', name: '', args: '' });
          }
          const entry = toolCallMap.get(idx)!;
          if (tc.id) entry.id = tc.id;
          if (tc.function?.name) entry.name += tc.function.name;
          if (tc.function?.arguments) entry.args += tc.function.arguments;
        }
      }

    }

    if (textBuffer) {
      lastTextBuffer = textBuffer;
      allTextBuffer += '\n' + textBuffer;
    }

    const toolCalls = Array.from(toolCallMap.values());

    // No tool calls → agent is done
    if (toolCalls.length === 0) break;

    // Append assistant turn to history
    messages.push({
      role: 'assistant',
      content: textBuffer || null,
      tool_calls: toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function' as const,
        function: { name: tc.name, arguments: tc.args },
      })),
    } as Message);

    // Execute each tool call
    for (const tc of toolCalls) {
      emitWhileActive({ type: 'tool_call', name: tc.name, args: JSON.parse(tc.args || '{}') });

      let resultContent = '';
      try {
        if (tc.name === 'rssRadar') {
          const queries: string[] = (JSON.parse(tc.args).queries ?? []).slice(0, 10);
          const results = await Promise.all(queries.map((q) => rssRadar(q)));
          const combined = results.map((routes, i) => ({ query: queries[i], routes }));
          resultContent = JSON.stringify(combined);
          const total = results.reduce((s, r) => s + r.length, 0);
          emitWhileActive({
            type: 'tool_result',
            name: 'rssRadar',
            resultSummary: `${queries.length} 个查询，共找到 ${total} 条 RSS 路由`,
            success: true,
          });
        } else if (tc.name === 'webSearch') {
          const { query } = JSON.parse(tc.args);
          if (webSearchCount >= MAX_WEB_SEARCH_CALLS) {
            resultContent = JSON.stringify({
              error: `webSearch 已达到最大调用次数限制（${MAX_WEB_SEARCH_CALLS}次）`,
            });
            emitWhileActive({
              type: 'tool_result',
              name: 'webSearch',
              resultSummary: `已阻止超出预算的搜索 (${webSearchCount}/${MAX_WEB_SEARCH_CALLS})`,
              success: false,
            });
            messages.push({ role: 'tool', tool_call_id: tc.id, content: resultContent } as Message);
            continue;
          }
          webSearchCount += 1;

          // Check for no-provider error before hitting the API — throw so sseStream
          // catches it and emits { type: 'error' } for the client to display
          let results;
          try {
            results = await webSearch(query, { signal });
          } catch (searchErr) {
            const msg = searchErr instanceof Error ? searchErr.message : String(searchErr);
            // "No search provider" is a fatal config error — stop the agent entirely
            if (msg.toLowerCase().includes('search provider') || msg.toLowerCase().includes('no search')) {
              throw searchErr;
            }
            // Transient error — report to LLM and continue
            resultContent = JSON.stringify({ error: msg });
            emitWhileActive({ type: 'tool_result', name: 'webSearch', resultSummary: `搜索出错: ${msg.slice(0, 60)}`, success: false });
            messages.push({ role: 'tool', tool_call_id: tc.id, content: resultContent } as Message);
            continue;
          }

          // Add limit warning to result content when approaching/at limit
          if (webSearchCount >= MAX_WEB_SEARCH_CALLS) {
            const limitWarning = `\n\n[警告] webSearch 已达到最大调用次数限制（${MAX_WEB_SEARCH_CALLS}次），请立即停止继续搜索，使用现有结果完成任务。`;
            resultContent = JSON.stringify(results) + limitWarning;
          } else {
            resultContent = JSON.stringify(results);
          }

          const resultSummary = `找到 ${results.length} 条结果 (webSearch: ${webSearchCount}/${MAX_WEB_SEARCH_CALLS})`;
          emitWhileActive({
            type: 'tool_result',
            name: 'webSearch',
            resultSummary,
            success: true,
          });
        } else {
        }
      } catch (err) {
        // Re-throw fatal errors (e.g. no search provider) — sseStream will emit error event
        throw err;
      }

      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: resultContent,
      } as Message);
    }
  }

  // Parse final sources — try accumulated text first, then last buffer
  const sources = applySourceIntentPolicy(
    parseSourcesFromText(lastTextBuffer) || parseSourcesFromText(allTextBuffer)
  );
  return sources;
}

function discoveryCollectorSource(
  source: FoundSource,
  mode: Exclude<CollectionMode, 'search'>,
): CollectorSource {
  return {
    id: `discovery:${mode}`,
    subscriptionId: 'discovery',
    title: source.title,
    collectorType: mode,
    collectorConfigJson: source.collectorConfigJson ?? '{}',
    url: source.url,
    script: '',
    cronExpression: '0 * * * *',
  };
}

async function sampleStableCandidate(
  source: FoundSource,
  mode: Exclude<CollectionMode, 'search'>,
) {
  const collectorSource = discoveryCollectorSource(source, mode);
  if (mode === 'rss') {
    return createRssSourceCollector().collectCandidates(collectorSource);
  }
  if (mode === 'json') {
    if (!source.collectorConfigJson) {
      throw new Error('JSON 候选缺少 endpoint/itemsPath/fields 采集配置');
    }
    return createJsonSourceCollector().collectCandidates(collectorSource);
  }
  return sampleStaticArticleList(source.url);
}

async function enrichSearchCandidate(candidate: ArticleCandidate): Promise<ArticleCandidate> {
  const article = await fetchCollectorText(candidate.url, {
    maxResponseBytes: MAX_DISCOVERY_HTML_BYTES,
  }, {
    label: 'Search article evidence',
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent': 'SubscribeAnything/1.0; discovery article evidence',
    },
  });
  return {
    ...candidate,
    url: article.finalUrl,
    rawHtml: article.text,
  };
}

/** Run deterministic discovery first; LLM failures can only remove optional stable sources. */
export async function findSourcesAgent(
  input: { topic: string; criteria?: string },
  emit: (event: unknown) => void,
  onLLMCall?: (info: LLMCallInfo) => void,
  userId?: string | null,
): Promise<FoundSource[]> {
  let sourcePreferences: SourcePreference[] = [];
  try {
    sourcePreferences = await getActiveSourcePreferences();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emit({
      type: 'tool_result',
      name: 'sourcePreferences',
      resultSummary: `来源偏好读取失败，继续开放检索：${message.slice(0, 100)}`,
      success: false,
    });
  }

  const result = await discoverCollectionPlan(
    { ...input, sourcePreferences },
    {
      searchFn: async (query) => {
        emit({ type: 'tool_call', name: 'webSearch', args: { query, purpose: 'deterministic_collection_plan' } });
        try {
          const results = await webSearch(query);
          emit({
            type: 'tool_result',
            name: 'webSearch',
            resultSummary: `检索“${query}”找到 ${results.length} 条候选文章`,
            success: true,
          });
          return results;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          emit({
            type: 'tool_result',
            name: 'webSearch',
            resultSummary: `检索“${query}”失败：${message.slice(0, 100)}`,
            success: false,
          });
          throw error;
        }
      },
      discoverStableCandidates: (signal) => discoverStableSourceCandidatesWithLlm(
        input,
        sourcePreferences,
        emit,
        onLLMCall,
        userId,
        signal,
      ),
      enrichSearchCandidate,
      sampleStableCandidate: async (source, mode) => {
        emit({ type: 'tool_call', name: 'liveSourceSample', args: { url: source.url, collectionMode: mode } });
        try {
          const candidates = await sampleStableCandidate(source, mode);
          emit({
            type: 'tool_result',
            name: 'liveSourceSample',
            resultSummary: `${source.title} 现场采集到 ${candidates.length} 条候选文章`,
            success: true,
          });
          return candidates;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          emit({
            type: 'tool_result',
            name: 'liveSourceSample',
            resultSummary: `${source.title} 现场采样失败：${message.slice(0, 100)}`,
            success: false,
          });
          throw error;
        }
      },
    },
  );

  emit({ type: 'source_audit', records: result.auditRecords });
  if (result.sources.length === 0) {
    throw new Error('没有搜索文章或稳定来源通过近期、相关性和页面类型验证');
  }
  emit({ type: 'sources', sources: result.sources });
  return result.sources;
}

/** Normalize a raw parsed item into a FoundSource. */
function normalizeSource(item: Record<string, unknown>): FoundSource {
  const recommended = item.recommended === true || item.recommended === 'true';
  const canProvideCriteria = item.canProvideCriteria === false || item.canProvideCriteria === 'false'
    ? false
    : item.canProvideCriteria === true || item.canProvideCriteria === 'true'
      ? true
      : undefined;
  const sourceType = typeof item.sourceType === 'string' && [
    'general_news',
    'local_news',
    'industry_vertical',
    'finance',
    'other',
  ].includes(item.sourceType)
    ? item.sourceType as SourceType
    : undefined;
  const collectionMode = typeof item.collectionMode === 'string' && [
    'search',
    'rss',
    'json',
    'feed_script',
  ].includes(item.collectionMode)
    ? item.collectionMode as CollectionMode
    : undefined;
  let collectorConfigJson: string | undefined;
  if (typeof item.collectorConfigJson === 'string' && item.collectorConfigJson.trim()) {
    collectorConfigJson = item.collectorConfigJson.trim();
  } else if (item.collectorConfigJson && typeof item.collectorConfigJson === 'object') {
    try {
      collectorConfigJson = JSON.stringify(item.collectorConfigJson);
    } catch {
      collectorConfigJson = undefined;
    }
  }
  return {
    title: String(item.title ?? item.name ?? item.url),
    url: String(item.url),
    description: String(item.description ?? item.summary ?? ''),
    ...(recommended ? { recommended: true } : {}),
    ...(canProvideCriteria !== undefined ? { canProvideCriteria } : {}),
    ...(sourceType ? { sourceType } : {}),
    ...(collectionMode ? { collectionMode } : {}),
    ...(collectorConfigJson ? { collectorConfigJson } : {}),
  };
}

/** Try JSON.parse on a string and return a valid FoundSource array or []. */
function tryParseJsonArray(raw: string): FoundSource[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item.url === 'string' && item.url.startsWith('http'))
      .slice(0, MAX_LLM_STABLE_CANDIDATES)
      .map(normalizeSource);
  } catch {
    return [];
  }
}

/** Extract JSON array of sources from agent's final text response. */
function parseSourcesFromText(text: string): FoundSource[] {
  if (!text) return [];

  // 1. JSON inside a code block: ```json [...] ``` or ``` [...] ```
  const codeBlockMatch = text.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/);
  if (codeBlockMatch) {
    const result = tryParseJsonArray(codeBlockMatch[1]);
    if (result.length > 0) return result;
  }

  // 2. Bare JSON array anywhere in the text (greedy from first [ to last ])
  const firstBracket = text.indexOf('[');
  const lastBracket = text.lastIndexOf(']');
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    const result = tryParseJsonArray(text.slice(firstBracket, lastBracket + 1));
    if (result.length > 0) return result;
  }

  // 3. Individual JSON objects containing a url field (LLM may output one object per line)
  const objectPattern = /\{[^{}]*"url"\s*:\s*"(https?:\/\/[^"]+)"[^{}]*\}/g;
  const objects: FoundSource[] = [];
  for (const match of text.matchAll(objectPattern)) {
    try {
      const obj = JSON.parse(match[0]) as Record<string, unknown>;
      if (typeof obj.url === 'string' && obj.url.startsWith('http')) {
        objects.push(normalizeSource(obj));
        if (objects.length >= MAX_LLM_STABLE_CANDIDATES) break;
      }
    } catch {
      // skip malformed
    }
  }
  if (objects.length > 0) return objects;

  // 4. Markdown list fallback — extract URLs from lines like "- **Title** — https://..."
  const urlLinePattern = /[-*]\s+(?:\*{1,2}([^*\n]+)\*{1,2}[^:\n]*)?.*?(https?:\/\/[^\s)\]"]+)/g;
  const markdownSources: FoundSource[] = [];
  for (const match of text.matchAll(urlLinePattern)) {
    const title = (match[1] ?? '').trim();
    const url = match[2].replace(/[,.)]+$/, ''); // strip trailing punctuation
    if (url.startsWith('http')) {
      markdownSources.push({ title: title || url, url, description: '' });
      if (markdownSources.length >= MAX_LLM_STABLE_CANDIDATES) break;
    }
  }
  if (markdownSources.length > 0) return markdownSources;

  return [];
}
