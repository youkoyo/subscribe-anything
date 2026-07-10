/**
 * validateScriptAgent — LLM-based script quality review (Step 4 layer 2 & 3)
 *
 * Called from generateScriptAgent after the sandbox run succeeds with ≥1 items.
 * The agent:
 *   1. Reviews the script code for quality issues (fallback patterns, fake data, criteria fields)
 *   2. Fetches 1-2 of the collected URLs via webFetch to verify they are real
 *   3. Returns { valid, reason, fixedScript? }
 *
 * Uses the 'validate-script' prompt template from the database.
 * Output format expected from LLM:
 *   ```json
 *   {"valid": true/false, "reason": "..."}
 *   ```
 *   followed optionally (when valid=false) by:
 *   ```javascript
 *   // fixed script
 *   ```
 */

import { getTemplate, getProviderForTemplate, buildOpenAIClient, llmStream } from '@/lib/ai/client';
import type { LLMCallInfo } from '@/lib/ai/client';
import { webFetch, webFetchToolDef } from '@/lib/ai/tools/webFetch';
import type { CollectedItem } from '@/lib/sandbox/contract';
import type { SourceInput } from './generateScriptAgent';
import type OpenAI from 'openai';

export interface LLMValidateResult {
  valid: boolean;
  reason: string;
  fixedScript?: string;
}

type Message = OpenAI.Chat.ChatCompletionMessageParam;

export async function validateScriptAgent(
  source: SourceInput,
  script: string,
  items: CollectedItem[],
  callIndexOffset = 0,
  onLLMCall?: (info: LLMCallInfo) => void,
  userId?: string | null
): Promise<LLMValidateResult> {
  const [provider, tpl] = await Promise.all([
    getProviderForTemplate('validate-script', userId),
    getTemplate('validate-script', userId),
  ]);

  // Fail open if template missing — don't block script generation entirely
  if (!tpl) {
    return { valid: true, reason: 'validate-script 模板未找到，跳过 LLM 审查' };
  }

  // Pre-compute deterministic freshness/relevance stats so the LLM doesn't have to eyeball
  // raw timestamps. These objective numbers are far more reliable than the LLM judging
  // "is 2024-03-15 recent?" from a string.
  const stats = computeQualityStats(items, source.topicKeywords);

  const itemsPreview = JSON.stringify(items.slice(0, 5), null, 2);
  const systemContent = tpl.content
    .replace('{{url}}', source.url)
    .replace('{{description}}', source.description || '无描述')
    .replace('{{criteria}}', source.criteria?.trim() || '无')
    .replace('{{topicKeywords}}', source.topicKeywords?.trim() || '无')
    .replace('{{qualityStats}}', JSON.stringify(stats, null, 2))
    .replace('{{script}}', script)
    .replace('{{items}}', itemsPreview);

  const messages: Message[] = [
    { role: 'user', content: systemContent },
  ];

  const openai = buildOpenAIClient(provider);
  let lastTextBuffer = '';

  // Agentic loop — max 6 iterations (LLM may call webFetch to verify collected URLs)
  for (let iteration = 0; iteration < 6; iteration++) {
    let textBuffer = '';
    const toolCallMap = new Map<number, { id: string; name: string; args: string }>();

    const stream = llmStream(
      openai,
      {
        model: provider.modelId,
        messages,
        tools: [webFetchToolDef],
        tool_choice: 'auto',
        stream: true,
        stream_options: { include_usage: true },
      },
      { callIndex: iteration + 1 + callIndexOffset, onCall: onLLMCall }
    );

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (delta?.content) textBuffer += delta.content;
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          if (!toolCallMap.has(idx)) toolCallMap.set(idx, { id: '', name: '', args: '' });
          const entry = toolCallMap.get(idx)!;
          if (tc.id) entry.id = tc.id;
          if (tc.function?.name) entry.name += tc.function.name;
          if (tc.function?.arguments) entry.args += tc.function.arguments;
        }
      }
    }

    if (textBuffer) lastTextBuffer = textBuffer;

    const toolCalls = Array.from(toolCallMap.values());
    if (toolCalls.length === 0) break;

    messages.push({
      role: 'assistant',
      content: textBuffer || null,
      tool_calls: toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function' as const,
        function: { name: tc.name, arguments: tc.args },
      })),
    } as Message);

    for (const tc of toolCalls) {
      let resultContent = '';
      try {
        const args = JSON.parse(tc.args || '{}');
        if (tc.name === 'webFetch') {
          const result = await webFetch(args.url ?? '');
          const truncNote = result.truncated ? '\n[内容已截断]' : '';
          resultContent = JSON.stringify({
            ok: result.ok,
            status: result.status,
            body: result.body + truncNote,
          });
        } else {
          resultContent = JSON.stringify({ error: `Unknown tool: ${tc.name}` });
        }
      } catch (err) {
        resultContent = JSON.stringify({
          error: err instanceof Error ? err.message : String(err),
        });
      }
      messages.push({ role: 'tool', tool_call_id: tc.id, content: resultContent } as Message);
    }
  }

  return parseValidateResult(lastTextBuffer);
}

/** Parse the LLM's final text output into a structured LLMValidateResult. */
function parseValidateResult(text: string): LLMValidateResult {
  if (!text) return { valid: false, reason: 'LLM 未返回审查结果' };

  // 1. Look for ```json { "valid": ... } ``` block (preferred format)
  const jsonBlockMatch = text.match(/```json\s*(\{[\s\S]*?\})\s*```/);
  let valid: boolean | undefined;
  let reason = '';

  if (jsonBlockMatch) {
    try {
      const parsed = JSON.parse(jsonBlockMatch[1]);
      if (typeof parsed.valid === 'boolean') {
        valid = parsed.valid;
        reason = String(parsed.reason ?? '');
      }
    } catch { /* continue to next strategy */ }
  }

  // 2. Bare JSON object containing "valid" field
  if (valid === undefined) {
    const inlineMatch = text.match(/\{"valid"\s*:\s*(true|false)[^}]*\}/);
    if (inlineMatch) {
      try {
        const parsed = JSON.parse(inlineMatch[0]);
        valid = parsed.valid;
        reason = String(parsed.reason ?? '');
      } catch { /* continue */ }
    }
  }

  // 3. Text heuristic fallback
  if (valid === undefined) {
    const lower = text.toLowerCase();
    valid =
      lower.includes('"valid":true') ||
      lower.includes('"valid": true') ||
      lower.includes('审查通过') ||
      lower.includes('验证通过');
    reason = text.slice(0, 300);
  }

  // 4. Extract fixed script from ```javascript code block (only when invalid)
  let fixedScript: string | undefined;
  if (!valid) {
    const jsBlockMatch = text.match(/```(?:javascript|js)\n([\s\S]*?)```/);
    if (jsBlockMatch) {
      fixedScript = jsBlockMatch[1].trim();
    }
  }

  return { valid: valid ?? false, reason, fixedScript };
}

interface QualityStats {
  totalItems: number;
  itemsWithDate: number;
  itemsWithin30Days: number;
  itemsWithin90Days: number;
  itemsWithin7Days: number;
  oldestDate: string | null;
  newestDate: string | null;
  daysSinceNewest: number | null;
  itemsOnTopic: number;
  onTopicRatio: number;
  freshRatio30: number;
  freshRatio90: number;
  appearsStale: boolean;
}

/**
 * Pre-compute objective freshness + topic-relevance statistics for the LLM to weigh
 * alongside its own quality review. The LLM is bad at judging dates and topic
 * relevance by eye — give it hard numbers.
 */
function computeQualityStats(items: CollectedItem[], topicKeywordsRaw?: string): QualityStats {
  const topicKeywords = (topicKeywordsRaw ?? '')
    .split(/[\s,，、;；\n]+/)
    .map((kw) => kw.trim().toLowerCase())
    .filter((kw) => kw.length >= 2);

  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  let withDate = 0;
  let within30 = 0;
  let within90 = 0;
  let within7 = 0;
  let oldest = Number.POSITIVE_INFINITY;
  let newest = Number.NEGATIVE_INFINITY;

  for (const item of items) {
    if (!item.publishedAt) continue;
    const t = new Date(item.publishedAt).getTime();
    if (Number.isNaN(t)) continue;
    withDate++;
    const age = now - t;
    if (age <= 30 * day) within30++;
    if (age <= 90 * day) within90++;
    if (age <= 7 * day) within7++;
    if (t < oldest) oldest = t;
    if (t > newest) newest = t;
  }

  let onTopic = 0;
  if (topicKeywords.length > 0) {
    for (const item of items) {
      const text = `${item.title ?? ''} ${item.summary ?? ''}`.toLowerCase();
      if (topicKeywords.some((kw) => text.includes(kw))) onTopic++;
    }
  } else {
    // No topic keywords provided — count all items as on-topic (no filter to evaluate against)
    onTopic = items.length;
  }

  const newestTs = newest !== Number.NEGATIVE_INFINITY ? newest : null;
  const daysSinceNewest = newestTs != null ? Math.floor((now - newestTs) / day) : null;
  // Stale if the newest item is > 180 days old AND we actually saw dated items
  const appearsStale = newestTs != null && now - newestTs > 180 * day;

  return {
    totalItems: items.length,
    itemsWithDate: withDate,
    itemsWithin30Days: within30,
    itemsWithin90Days: within90,
    itemsWithin7Days: within7,
    oldestDate: oldest !== Number.POSITIVE_INFINITY ? new Date(oldest).toISOString() : null,
    newestDate: newestTs != null ? new Date(newestTs).toISOString() : null,
    daysSinceNewest,
    itemsOnTopic: onTopic,
    onTopicRatio: items.length > 0 ? onTopic / items.length : 0,
    freshRatio30: items.length > 0 ? within30 / items.length : 0,
    freshRatio90: items.length > 0 ? within90 / items.length : 0,
    appearsStale,
  };
}
