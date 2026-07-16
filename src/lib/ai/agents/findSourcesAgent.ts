/**
 * findSourcesAgent — Wizard Step 2
 *
 * Agentic loop that searches the web for a broad, quality-first set of sources
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
import { checkFeed, checkFeedToolDef } from '@/lib/ai/tools/checkFeed';
import type OpenAI from 'openai';
import type { DiscoverySourceTier, FoundSource, MainstreamSourceChannel } from '@/types/wizard';

type Message = OpenAI.Chat.ChatCompletionMessageParam;

const MIN_DISCOVERY_SOURCE_COUNT = 20;
const MAX_DISCOVERY_SOURCE_COUNT = 28;
const MIN_PRIMARY_SOURCE_COUNT = 4;
const MIN_MAINSTREAM_SOURCE_COUNT = 5;
const MIN_NON_FINANCE_MAINSTREAM_SOURCE_COUNT = 3;
const MAX_FINANCE_MAINSTREAM_SOURCE_COUNT = 2;
const MIN_LOCAL_OFFICIAL_SOURCE_COUNT = 4;
const MAX_VERTICAL_SOURCE_COUNT = 6;
const MAX_COMPANY_DISCLOSURE_SOURCE_COUNT = 4;
const MAX_WEB_SEARCH_CALLS = 20;

// These invariants are appended even when an administrator has customized the
// editable prompt template. They prevent a generic web search from quietly
// degrading into article links and low-quality aggregation sites.
const SOURCE_DISCOVERY_GUARDRAILS = `
**强制来源质量、覆盖与数量要求**
- 目标是 ${MIN_DISCOVERY_SOURCE_COUNT}-${MAX_DISCOVERY_SOURCE_COUNT} 个可执行候选源；只有在完成分层检索后确实找不到时才少于 ${MIN_DISCOVERY_SOURCE_COUNT} 个，并说明缺口原因。
- 必须按以下顺序分批检索和输出，不允许先用行业站凑满数量：①政府/监管/国际组织/官方机构和权威行业协会（primary，至少 ${MIN_PRIMARY_SOURCE_COUNT} 个）；②全国性通讯社、综合新闻、时政社会、消费产业等主流媒体的资讯频道/RSS（mainstream，至少 ${MIN_MAINSTREAM_SOURCE_COUNT} 个，其中非财经栏目至少 ${MIN_NON_FINANCE_MAINSTREAM_SOURCE_COUNT} 个，财经栏目最多 ${MAX_FINANCE_MAINSTREAM_SOURCE_COUNT} 个）；③根据产业集群、生产地、消费地或经营地找到的地方政府官网、地方党媒/官媒资讯频道（local_official，至少 ${MIN_LOCAL_OFFICIAL_SOURCE_COUNT} 个）；④上市公司法定披露和研究机构（company_disclosure）；⑤垂直行业媒体（vertical，仅作为补充，最多 ${MAX_VERTICAL_SOURCE_COUNT} 个）。公司公告最多 ${MAX_COMPANY_DISCLOSURE_SOURCE_COUNT} 个，不能替代主流媒体或地方官媒。
- 财经只是主流媒体的一个补充栏目；除非管理员明确只关注金融市场，否则不得把财经频道当作主流媒体层的默认答案。综合新闻、社会、地方新闻与产业/消费栏目优先覆盖突发事件、生产经营与区域动态。
- 先做全国主流媒体检索，再做产业关联地区的地方官媒/政府检索，最后才补充行业媒体；每个层级都要实际搜索和核验，不能凭常识虚构来源。
- 严禁把搜索结果页、聚合转载站、营销软文站、展会单篇宣传页、静态文章页、单条新闻详情页、失效链接作为数据源。
- URL 必须是 RSS/Atom、官网资讯列表、栏目首页、公告/新闻中心或可持续采集的 API；每一项先核验其归属和更新能力。
- 每项 JSON 必须带 sourceTier，值只能是 primary、mainstream、local_official、company_disclosure、vertical；mainstream 还必须带 sourceChannel，值只能是 general_news、finance、consumer_industry、politics_society、other。一级、主流媒体和地方官媒优先 recommended。vertical 的 description 必须写明为什么可信。
`;

const DISCOVERY_SOURCE_TIERS = new Set<DiscoverySourceTier>([
  'primary', 'mainstream', 'local_official', 'company_disclosure', 'vertical',
]);
const MAINSTREAM_SOURCE_CHANNELS = new Set<MainstreamSourceChannel>([
  'general_news', 'finance', 'consumer_industry', 'politics_society', 'other',
]);

function sourceTierCounts(sources: FoundSource[]): Record<DiscoverySourceTier, number> {
  const counts: Record<DiscoverySourceTier, number> = {
    primary: 0,
    mainstream: 0,
    local_official: 0,
    company_disclosure: 0,
    vertical: 0,
  };
  for (const source of sources) {
    if (source.sourceTier) counts[source.sourceTier]++;
  }
  return counts;
}

function hasRequiredSourceTierCoverage(sources: FoundSource[]): boolean {
  const counts = sourceTierCounts(sources);
  const mainstreamSources = sources.filter((source) => source.sourceTier === 'mainstream');
  const nonFinanceMainstreamCount = mainstreamSources.filter((source) =>
    source.sourceChannel && source.sourceChannel !== 'finance'
  ).length;
  const financeMainstreamCount = mainstreamSources.filter((source) => source.sourceChannel === 'finance').length;
  return counts.primary >= MIN_PRIMARY_SOURCE_COUNT
    && counts.mainstream >= MIN_MAINSTREAM_SOURCE_COUNT
    && nonFinanceMainstreamCount >= MIN_NON_FINANCE_MAINSTREAM_SOURCE_COUNT
    && financeMainstreamCount <= MAX_FINANCE_MAINSTREAM_SOURCE_COUNT
    && counts.local_official >= MIN_LOCAL_OFFICIAL_SOURCE_COUNT
    && counts.vertical <= MAX_VERTICAL_SOURCE_COUNT
    && counts.company_disclosure <= MAX_COMPANY_DISCLOSURE_SOURCE_COUNT;
}

function sourceTierCoverageSummary(sources: FoundSource[]): string {
  const counts = sourceTierCounts(sources);
  const mainstreamSources = sources.filter((source) => source.sourceTier === 'mainstream');
  const nonFinanceMainstreamCount = mainstreamSources.filter((source) =>
    source.sourceChannel && source.sourceChannel !== 'finance'
  ).length;
  const financeMainstreamCount = mainstreamSources.filter((source) => source.sourceChannel === 'finance').length;
  return `primary ${counts.primary}/${MIN_PRIMARY_SOURCE_COUNT}、mainstream ${counts.mainstream}/${MIN_MAINSTREAM_SOURCE_COUNT}（非财经 ${nonFinanceMainstreamCount}/${MIN_NON_FINANCE_MAINSTREAM_SOURCE_COUNT}、财经 ${financeMainstreamCount}/${MAX_FINANCE_MAINSTREAM_SOURCE_COUNT} 上限）、local_official ${counts.local_official}/${MIN_LOCAL_OFFICIAL_SOURCE_COUNT}、vertical ${counts.vertical}/${MAX_VERTICAL_SOURCE_COUNT}（上限）、company_disclosure ${counts.company_disclosure}/${MAX_COMPANY_DISCLOSURE_SOURCE_COUNT}（上限）`;
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
  const systemContent = `${tpl.content
    .replace('{{topic}}', topic)
    .replace('{{criteria}}', criteria ?? '无')}\n${SOURCE_DISCOVERY_GUARDRAILS}`;

  const messages: Message[] = [
    { role: 'user', content: systemContent },
  ];

  const openai = buildOpenAIClient(provider);
  let lastTextBuffer = '';
  let allTextBuffer = '';

  // A broad candidate set needs separate searches for primary, mainstream and
  // vertical sources, while still keeping a hard upper bound.
  let webSearchCount = 0;

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

    // The model occasionally stops after giving only a few examples. Ask it to
    // continue its own research instead of silently treating that as a complete
    // discovery result. The web-search ceiling remains the hard safety bound.
    if (toolCalls.length === 0) {
      const candidates = parseSourcesFromText(textBuffer);
      const candidateCount = candidates.length;
      const hasCoverage = hasRequiredSourceTierCoverage(candidates);
      if ((candidateCount < MIN_DISCOVERY_SOURCE_COUNT || !hasCoverage)
        && webSearchCount < MAX_WEB_SEARCH_CALLS
        && iteration < 31) {
        messages.push({
          role: 'user',
          content: `当前得到 ${candidateCount} 个合格来源，分层覆盖为：${sourceTierCoverageSummary(candidates)}。请继续按“全国主流媒体 → 产业关联地区地方官媒/政府 → 权威机构 → 行业补充”检索，补足到 ${MIN_DISCOVERY_SOURCE_COUNT}-${MAX_DISCOVERY_SOURCE_COUNT} 个并满足各层数量；不得重复、不得用静态文章页或低质量聚合站凑数。最后输出完整 JSON 数组，逐项填写 sourceTier。`,
        });
        continue;
      }
      break;
    }

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
  const sources = parseSourcesFromText(lastTextBuffer) || parseSourcesFromText(allTextBuffer);
  emit({ type: 'sources', sources });

  return sources;
}

/** Normalize a raw parsed item into a FoundSource. */
function normalizeSource(item: Record<string, unknown>): FoundSource {
  const recommended = item.recommended === true || item.recommended === 'true';
  const canProvideCriteria = item.canProvideCriteria === false || item.canProvideCriteria === 'false'
    ? false
    : item.canProvideCriteria === true || item.canProvideCriteria === 'true'
      ? true
      : undefined;
  return {
    title: String(item.title ?? item.name ?? item.url),
    url: String(item.url),
    description: String(item.description ?? item.summary ?? ''),
    ...(recommended ? { recommended: true } : {}),
    ...(typeof item.sourceTier === 'string' && DISCOVERY_SOURCE_TIERS.has(item.sourceTier as DiscoverySourceTier)
      ? { sourceTier: item.sourceTier as DiscoverySourceTier }
      : {}),
    ...(typeof item.sourceChannel === 'string' && MAINSTREAM_SOURCE_CHANNELS.has(item.sourceChannel as MainstreamSourceChannel)
      ? { sourceChannel: item.sourceChannel as MainstreamSourceChannel }
      : {}),
    ...(canProvideCriteria !== undefined ? { canProvideCriteria } : {}),
  };
}

function isEligibleDiscoverySource(source: FoundSource): boolean {
  try {
    const url = new URL(source.url);
    const host = url.hostname.toLowerCase();
    const path = url.pathname.toLowerCase();
    if (['example.com', 'localhost'].includes(host) || host.endsWith('.example.com')) return false;
    // Numeric detail slugs and dated paths are overwhelmingly individual news
    // pages. A list/category URL remains valid, including a normal /news root.
    if (/\/(?:article|detail|content|show|view)\/?\d+(?:[/.]|$)/i.test(path)) return false;
    if (/\/\d{5,}\.s?html?$/i.test(path)) return false;
    if (/\/20\d{2}[/-]\d{1,2}[/-]\d{1,2}(?:[/.]|$)/.test(path)) return false;
    return Boolean(source.title.trim());
  } catch {
    return false;
  }
}

function uniqueEligibleSources(sources: FoundSource[]): FoundSource[] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    if (!isEligibleDiscoverySource(source)) return false;
    const key = source.url.replace(/\/$/, '').toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Try JSON.parse on a string and return a valid FoundSource array or []. */
function tryParseJsonArray(raw: string): FoundSource[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return uniqueEligibleSources(parsed
      .filter((item) => item && typeof item.url === 'string' && item.url.startsWith('http'))
      .map(normalizeSource));
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
  if (objects.length > 0) return uniqueEligibleSources(objects);

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
  if (markdownSources.length > 0) return uniqueEligibleSources(markdownSources);

  return [];
}
