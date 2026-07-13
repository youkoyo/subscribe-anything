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
import { webSearch, webSearchToolDef, type SearchResult } from '@/lib/ai/tools/webSearch';
import { rssRadar, rssRadarToolDef } from '@/lib/ai/tools/rssRadar';
import { checkFeed, checkFeedToolDef } from '@/lib/ai/tools/checkFeed';
import { applySourceIntentPolicy, type SourceType } from './sourceIntentPolicy';
import {
  buildSourceDecisionRecords,
  collectSourceEvidence,
  evaluateSourcePortfolio,
  getRecommendedSourcesMissingEvidence,
  type SourceEvidence,
} from './sourcePortfolioPolicy';
import { buildPreferredSourceQueries, describeSourcePreferences, getActiveSourcePreferences, type SourcePreference } from './sourcePreferences';
import type OpenAI from 'openai';

export interface FoundSource {
  title: string;
  url: string;
  description: string;
  recommended?: boolean;
  canProvideCriteria?: boolean;
  sourceType?: SourceType;
}

type Message = OpenAI.Chat.ChatCompletionMessageParam;

// Appended at runtime so older or customized prompt-template rows still use
// the same source-discovery policy.
const REALTIME_NEWS_SOURCE_POLICY = `
**实时资讯源优先规则（必须遵守）**
当前任务的目标是发现能持续采集“最新相关资讯”的数据源，不是罗列行业机构官网。

1. 先用 webSearch 搜索“{{query}} 最新新闻/动态”，再搜索至少 3 个主流媒体或财经媒体站点内的 {{query}} 报道；优先考察新华社、人民网、中新网、央视财经、澎湃、财新、第一财经、界面、证券时报等具备持续更新栏目、RSS 或搜索结果页的来源。
2. 返回的 5-10 个源中，至少 3 个必须是实时新闻源或财经新闻源；协会、展会、统计年报、商品数据库等低频/静态来源最多保留 2 个，且默认不得标为 recommended。
3. 不要把一篇具体新闻当作数据源。应选择可持续更新的新闻频道、主题页、RSS/Atom Feed 或站内搜索结果页。
4. 只有当该来源确实能覆盖 {{query}} 的近期事件、企业动态、事故、政策或市场新闻时才能标记 recommended。通用首页、行业介绍页、月度统计页不能因“权威”就标记 recommended。
5. 每条 description 必须明确写出“实时新闻 / 财经新闻 / 行业垂直 / 数据统计”之一，以及它为什么适合持续发现 {{query}} 相关事件。
`;

const SOURCE_INTENT_OUTPUT_POLICY = `
**来源类别与组合约束（必须遵守）**
每个来源必须输出 sourceType：general_news（实时综合/社会新闻）、local_news（地方政府或当地媒体）、industry_vertical（行业垂直媒体/协会）、finance（财经补充）、other（其他）。
只要候选中存在，recommended 来源必须至少含一个 general_news 或 local_news，以及一个 industry_vertical；finance 最多一个，不能因为权威性直接成为默认主来源。
`;

function normalizeNewsSearchSubject(value: string) {
  return value
    .replace(/中国国内|国内|中国/g, '')
    .replace(/产业信息|行业动态|动态监测|相关信息|相关/g, '')
    .trim() || value.trim();
}

function buildRealtimeNewsQueries(topic: string, criteria?: string, preferences: SourcePreference[] = []) {
  const subject = normalizeNewsSearchSubject(criteria?.trim() || topic);
  return Array.from(new Set([
    `${subject} 最新新闻`,
    `${subject} 突发事件 事故 火灾 政策 企业动态`,
    `${subject} site:news.cn OR site:people.com.cn OR site:chinanews.com.cn`,
    ...buildPreferredSourceQueries(subject, preferences),
  ]));
}

async function collectRealtimeNewsEvidence(
  topic: string,
  criteria: string | undefined,
  preferences: SourcePreference[],
  emit: (event: unknown) => void
) {
  const evidence: Array<{ query: string; results: SearchResult[] }> = [];
  for (const query of buildRealtimeNewsQueries(topic, criteria, preferences)) {
    emit({ type: 'tool_call', name: 'webSearch', args: { query } });
    try {
      const results = await webSearch(query);
      evidence.push({ query, results });
      emit({
        type: 'tool_result',
        name: 'webSearch',
        resultSummary: `预检索“${query}”找到 ${results.length} 条结果`,
        success: true,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      emit({ type: 'tool_result', name: 'webSearch', resultSummary: `预检索失败：${message.slice(0, 80)}`, success: false });
    }
  }
  return evidence;
}

/** Run the find-sources agentic loop and emit SSE events via `emit`. */
export async function findSourcesAgent(
  { topic, criteria }: { topic: string; criteria?: string },
  emit: (event: unknown) => void,
  onLLMCall?: (info: LLMCallInfo) => void,
  userId?: string | null
): Promise<FoundSource[]> {
  const [provider, tpl] = await Promise.all([
    getProviderForTemplate('find-sources', userId),
    getTemplate('find-sources', userId),
  ]);
  const query = criteria?.trim() && criteria.trim() !== '全部' ? criteria.trim() : topic;
  const sourcePreferences = await getActiveSourcePreferences();
  const templateContent = tpl.content
    .replace('{{topic}}', topic)
    .replace('{{criteria}}', criteria ?? '无');

  const adminSourcePolicy = `\n管理员来源偏好（必须优先检索 required，命中后优先作为候选；preferred 用于补充，仍可扩展发现其他来源）：\n${JSON.stringify(describeSourcePreferences(sourcePreferences))}`;
  const systemContent = `${templateContent}\n${REALTIME_NEWS_SOURCE_POLICY.replaceAll('{{query}}', query)}\n${SOURCE_INTENT_OUTPUT_POLICY}${adminSourcePolicy}`;

  const realtimeNewsEvidence = await collectRealtimeNewsEvidence(topic, criteria, sourcePreferences, emit);
  const realtimeNewsContext = realtimeNewsEvidence.length > 0
    ? `\n\n以下是系统刚完成的实时新闻预检索结果。请从中识别持续更新的媒体频道、RSS 或站内搜索页，不能直接把单篇新闻作为数据源：\n${JSON.stringify(realtimeNewsEvidence)}`
    : '';

  const messages: Message[] = [
    { role: 'user', content: systemContent + realtimeNewsContext },
  ];

  const openai = buildOpenAIClient(provider);
  let lastTextBuffer = '';
  let allTextBuffer = '';

  // Track webSearch call count — max 10 calls as per prompt template
  let webSearchCount = realtimeNewsEvidence.length;
  const agentSearchEvidence: SourceEvidence[] = [];
  const MAX_WEB_SEARCH_CALLS = 10;

  // Agentic loop — max 32 iterations to prevent runaway
  for (let iteration = 0; iteration < 32; iteration++) {
    let textBuffer = '';
    const toolCallMap = new Map<number, { id: string; name: string; args: string }>();

    const stream = llmStream(openai, {
      model: provider.modelId,
      messages,
      tools: [webSearchToolDef, rssRadarToolDef, checkFeedToolDef],
      tool_choice: 'auto',
      stream: true,
      stream_options: { include_usage: true },
    }, { callIndex: iteration + 1, onCall: onLLMCall });

    for await (const chunk of stream) {
      const choice = chunk.choices[0];
      const delta = choice?.delta;

      // Accumulate text
      if (delta?.content) {
        textBuffer += delta.content;
        emit({ type: 'text', content: delta.content });
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
      emit({ type: 'tool_call', name: tc.name, args: JSON.parse(tc.args || '{}') });

      let resultContent = '';
      try {
        if (tc.name === 'rssRadar') {
          const queries: string[] = JSON.parse(tc.args).queries ?? [];
          const results = await Promise.all(queries.map((q) => rssRadar(q)));
          const combined = results.map((routes, i) => ({ query: queries[i], routes }));
          resultContent = JSON.stringify(combined);
          const total = results.reduce((s, r) => s + r.length, 0);
          emit({
            type: 'tool_result',
            name: 'rssRadar',
            resultSummary: `${queries.length} 个查询，共找到 ${total} 条 RSS 路由`,
            success: true,
          });
        } else if (tc.name === 'webSearch') {
          const { query } = JSON.parse(tc.args);
          webSearchCount++;

          // Check for no-provider error before hitting the API — throw so sseStream
          // catches it and emits { type: 'error' } for the client to display
          let results;
          try {
            results = await webSearch(query);
            agentSearchEvidence.push(...results.map(({ url, title, snippet }) => ({ url, title, snippet })));
          } catch (searchErr) {
            const msg = searchErr instanceof Error ? searchErr.message : String(searchErr);
            // "No search provider" is a fatal config error — stop the agent entirely
            if (msg.toLowerCase().includes('search provider') || msg.toLowerCase().includes('no search')) {
              throw searchErr;
            }
            // Transient error — report to LLM and continue
            resultContent = JSON.stringify({ error: msg });
            emit({ type: 'tool_result', name: 'webSearch', resultSummary: `搜索出错: ${msg.slice(0, 60)}`, success: false });
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
          emit({
            type: 'tool_result',
            name: 'webSearch',
            resultSummary,
            success: true,
          });
        } else if (tc.name === 'checkFeed') {
          const args = JSON.parse(tc.args);
          const urls: string[] = args.urls ?? [];
          const keywords: string[] | undefined = args.keywords?.length ? args.keywords : undefined;
          const results = await checkFeed(urls, keywords);
          resultContent = JSON.stringify(results.map((r, i) => ({ url: urls[i], ...r })));
          const validCount = results.filter((r) => r.valid).length;
          const summary = results.map((r, i) => {
            if (r.valid) return `✓ ${urls[i]}`;
            if (r.templateMismatch) return `✗ ${urls[i]} (结构有误)`;
            if (r.keywordFound === false) return `✗ ${urls[i]} (实体 ID 有误)`;
            return `✗ ${urls[i]} (HTTP ${r.status})`;
          }).join('\n');
          emit({
            type: 'tool_result',
            name: 'checkFeed',
            resultSummary: `${urls.length} 个 feed，${validCount} 个有效\n${summary}`,
            success: validCount > 0,
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

  // A plausible-looking source list is not sufficient.  In particular, an
  // industry-only list (or a list of foreign/Taiwan trade sites) cannot be
  // expected to catch a domestic breaking incident.  Bind every recommended
  // source to an actual pre-search result, then give the model one explicit
  // correction pass instead of silently accepting its first, weak portfolio.
  const preflightEvidence = collectSourceEvidence(
    realtimeNewsEvidence.flatMap(({ results }) =>
      results.map(({ url, title, snippet }) => ({ url, title, snippet }))
    ),
    agentSearchEvidence,
  );
  const confirmationEvidence = await confirmCandidateEvidence(sources, preflightEvidence, query, emit);
  let evidence = collectSourceEvidence(preflightEvidence, confirmationEvidence);
  let acceptedSources = sources;
  let portfolio = evaluateSourcePortfolio({
    criteria: criteria?.trim() || topic,
    sources: acceptedSources,
    evidence,
  });
  const initialPortfolioReasons = portfolio.reasons;
  let auditCandidates: FoundSource[] = [...acceptedSources];

  if (!portfolio.valid) {
    emit({
      type: 'tool_result',
      name: 'sourcePortfolioReview',
      resultSummary: `候选组合未通过准入，正在按检索证据补全：${portfolio.reasons.join('；')}`,
      success: false,
    });

    const correction = await correctSourcePortfolio({
      openai,
      provider,
      messages,
      proposedSources: acceptedSources,
      evidence,
      onLLMCall,
      emit,
    });
    if (correction.length > 0) {
      acceptedSources = applySourceIntentPolicy(correction);
      auditCandidates = [...auditCandidates, ...acceptedSources];
      // The corrective LLM response can introduce new domains. Confirm those
      // candidates too; otherwise valid-looking RSS/homepage URLs are checked
      // against evidence gathered only for the previous candidate list.
      const correctionEvidence = await confirmCandidateEvidence(acceptedSources, evidence, query, emit);
      evidence = collectSourceEvidence(evidence, correctionEvidence);
      portfolio = evaluateSourcePortfolio({
        criteria: criteria?.trim() || topic,
        sources: acceptedSources,
        evidence,
      });
    }
  }

  if (!portfolio.valid) {
    const message = `发现的数据源未通过实时新闻准入：${portfolio.reasons.join('；')}。请重试以重新检索，不会保存这批不合格来源。`;
    emit({
      type: 'source_audit',
      records: buildSourceDecisionRecords({
        acceptedSources: [],
        candidateSources: auditCandidates,
        evidence,
        rejectedReasons: portfolio.reasons,
      }),
    });
    emit({ type: 'tool_result', name: 'sourcePortfolioReview', resultSummary: message, success: false });
    throw new Error(message);
  }

  emit({
    type: 'source_audit',
    records: buildSourceDecisionRecords({
      acceptedSources,
      candidateSources: auditCandidates,
      evidence,
      rejectedReasons: initialPortfolioReasons,
    }),
  });
  emit({ type: 'sources', sources: acceptedSources });

  return acceptedSources;
}

async function confirmCandidateEvidence(
  sources: FoundSource[],
  evidence: SourceEvidence[],
  query: string,
  emit: (event: unknown) => void,
) {
  const missing = getRecommendedSourcesMissingEvidence(sources, evidence).slice(0, 6);
  const confirmed: SourceEvidence[] = [];
  for (const source of missing) {
    let host = '';
    try { host = new URL(source.url).hostname.replace(/^www\./, ''); } catch { continue; }
    const siteQuery = `${query} site:${host}`;
    emit({ type: 'tool_call', name: 'webSearch', args: { query: siteQuery, purpose: 'candidate_evidence_confirmation' } });
    try {
      const results = await webSearch(siteQuery);
      confirmed.push(...results.map(({ url, title, snippet }) => ({ url, title, snippet })));
      emit({ type: 'tool_result', name: 'webSearch', resultSummary: `候选来源证据确认：${source.title}，${results.length} 条结果`, success: results.length > 0 });
    } catch (error) {
      emit({ type: 'tool_result', name: 'webSearch', resultSummary: `候选来源证据确认失败：${source.title}，${error instanceof Error ? error.message.slice(0, 80) : String(error)}`, success: false });
    }
  }
  return confirmed;
}

async function correctSourcePortfolio({
  openai,
  provider,
  messages,
  proposedSources,
  evidence,
  onLLMCall,
  emit,
}: {
  openai: OpenAI;
  provider: { modelId: string };
  messages: Message[];
  proposedSources: FoundSource[];
  evidence: SourceEvidence[];
  onLLMCall?: (info: LLMCallInfo) => void;
  emit: (event: unknown) => void;
}): Promise<FoundSource[]> {
  const correctionPrompt = [
    '上一版候选源未通过准入。请只根据下方预检索证据重新输出一个 JSON 数组，不要解释、不要调用工具。',
    '必须返回 5–10 个可持续采集的频道、RSS 或站内列表页；国内需求必须包含至少一个国内综合/地方新闻源和一个国内行业垂直源；财经最多一个；每个 recommended=true 的来源必须与证据中的同一域名对应。不得把单篇文章当作来源，不得编造 URL。',
    `上一版：${JSON.stringify(proposedSources)}`,
    `预检索证据：${JSON.stringify(evidence)}`,
  ].join('\n\n');
  const correctionMessages: Message[] = [
    ...messages,
    { role: 'user', content: correctionPrompt },
  ];
  let text = '';
  const stream = llmStream(openai, {
    model: provider.modelId,
    messages: correctionMessages,
    stream: true,
    stream_options: { include_usage: true },
  }, { callIndex: 33, onCall: onLLMCall });

  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content;
    if (content) {
      text += content;
      emit({ type: 'text', content });
    }
  }
  return parseSourcesFromText(text);
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
  return {
    title: String(item.title ?? item.name ?? item.url),
    url: String(item.url),
    description: String(item.description ?? item.summary ?? ''),
    ...(recommended ? { recommended: true } : {}),
    ...(canProvideCriteria !== undefined ? { canProvideCriteria } : {}),
    ...(sourceType ? { sourceType } : {}),
  };
}

/** Try JSON.parse on a string and return a valid FoundSource array or []. */
function tryParseJsonArray(raw: string): FoundSource[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item.url === 'string' && item.url.startsWith('http'))
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
    }
  }
  if (markdownSources.length > 0) return markdownSources;

  return [];
}
