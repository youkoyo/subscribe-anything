/**
 * generateScriptAgent — Wizard Step 4 (per source)
 *
 * For a single data source, the agent:
 * 1. Fetches the page with webFetch to inspect its structure
 * 2. Writes a JS collection script
 * 3. Validates it with validateScript (up to MAX_RETRIES attempts)
 * 4. Returns { script, cronExpression, initialItems } on success
 *
 * SSE events are NOT emitted here — the caller (generate-scripts route) emits
 * source_progress events based on this function's return value.
 */

import { getTemplate, getProviderForTemplate, buildOpenAIClient, llmStream } from '@/lib/ai/client';
import type { LLMCallInfo } from '@/lib/ai/client';
import { webFetch, webFetchToolDef } from '@/lib/ai/tools/webFetch';
import { webFetchBrowser, webFetchBrowserToolDef } from '@/lib/ai/tools/webFetchBrowser';
import { webSearch, webSearchToolDef } from '@/lib/ai/tools/webSearch';
import { validateScript, validateScriptToolDef } from '@/lib/ai/tools/validateScript';
import { rssRadar, rssRadarToolDef } from '@/lib/ai/tools/rssRadar';
import { validateScriptAgent } from './validateScriptAgent';
import type { CollectedItem } from '@/lib/sandbox/contract';
import type OpenAI from 'openai';

const MAX_RETRIES = 3;

export interface GenerateResult {
  success: boolean;
  sandboxUnavailable?: boolean;
  script?: string;
  cronExpression?: string;
  initialItems?: CollectedItem[];
  error?: string;
}

export interface SourceInput {
  title: string;
  url: string;
  description: string;
  criteria?: string;
  /** Optional user-supplied hint appended to the LLM user message (used on retry). */
  userPrompt?: string;
  /** Comma-separated topic keywords from industry config, used for relevance filtering in the generated script. */
  topicKeywords?: string;
}

type Message = OpenAI.Chat.ChatCompletionMessageParam;

/** Generate a collection script for a single source. */
export async function generateScriptAgent(
  source: SourceInput,
  onProgress?: (message: string) => void,
  onLLMCall?: (info: LLMCallInfo) => void,
  userId?: string | null,
  signal?: AbortSignal
): Promise<GenerateResult> {
  const [provider, tpl] = await Promise.all([
    getProviderForTemplate('generate-script', userId),
    getTemplate('generate-script', userId),
  ]);

  let sourceDomain = '';
  try { sourceDomain = new URL(source.url).hostname; } catch { /* ignore */ }

  const systemContent = tpl.content
    .replace('{{title}}', source.title)
    .replace('{{url}}', source.url)
    .replace('{{domain}}', sourceDomain)
    .replace('{{description}}', source.description || '无描述')
    .replace('{{criteria}}', source.criteria?.trim() || '无')
    .replace('{{topicKeywords}}', source.topicKeywords?.trim() || '无');

  const userPromptSuffix = source.userPrompt?.trim()
    ? `\n\n用户补充说明：\n${source.userPrompt.trim()}`
    : '';

  const messages: Message[] = [
    { role: 'user', content: systemContent + userPromptSuffix },
  ];

  const openai = buildOpenAIClient(provider);

  // Track validation attempts and last successful items
  let validateAttempts = 0;
  let lastValidItems: CollectedItem[] | undefined;
  let lastScript: string | undefined;
  let lastCronExpression = '0 * * * *';
  let fatalError: string | undefined;
  let sandboxUnavailable = false;
  let lastScriptAttempted: string | undefined;

  // Agentic loop — max 32 iterations total (fetch + multiple validate retries)
  for (let iteration = 0; iteration < 32; iteration++) {
    // Check for abort at the start of each iteration
    if (signal?.aborted) {
      return { success: false, error: '已中断' };
    }

    let textBuffer = '';
    const toolCallMap = new Map<number, { id: string; name: string; args: string }>();

    const stream = llmStream(openai, {
      model: provider.modelId,
      messages,
      tools: [rssRadarToolDef, webSearchToolDef, webFetchToolDef, webFetchBrowserToolDef, validateScriptToolDef],
      tool_choice: 'auto',
      stream: true,
      stream_options: { include_usage: true },
    }, { callIndex: iteration + 1, onCall: onLLMCall, signal });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;

      if (delta?.content) textBuffer += delta.content;

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

    const toolCalls = Array.from(toolCallMap.values());

    // Extract cronExpression from text if agent mentions one
    const cronMatch = textBuffer.match(/\b(\d+|\*|[*/\d,-]+)\s+(\d+|\*|[*/\d,-]+)\s+(\*|[*/\d,-]+)\s+(\*|[*/\d,-]+)\s+(\*|[*/\d,-]+)\b/);
    if (cronMatch) lastCronExpression = cronMatch[0];

    // Also look for explicit cron mention
    const cronLabelMatch = textBuffer.match(/cron[^:]*:\s*[`"']?([0-9*,/\- ]{9,25})[`"']?/i);
    if (cronLabelMatch) lastCronExpression = cronLabelMatch[1].trim();

    // No more tool calls → agent finished
    // Push final text to messages so lastAssistantMsg captures it for script extraction
    if (toolCalls.length === 0) {
      if (textBuffer) {
        messages.push({ role: 'assistant', content: textBuffer } as Message);
      }
      break;
    }

    // Append assistant turn
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
      // Check for abort between tool calls
      if (signal?.aborted) {
        return { success: false, error: '已中断' };
      }

      let resultContent = '';

      try {
        const args = JSON.parse(tc.args || '{}');

        if (tc.name === 'rssRadar') {
          const queries: string[] = args.queries ?? (args.query ? [args.query] : [source.url]);
          const results = await Promise.all(queries.map((q) => rssRadar(q)));
          const combined = results.map((routes, i) => ({ query: queries[i], routes }));
          resultContent = JSON.stringify(combined);
          const total = results.reduce((s, r) => s + r.length, 0);
          onProgress?.(`RSS 路由查询：找到 ${total} 条`);
        } else if (tc.name === 'webSearch') {
          const query = args.query ?? '';
          onProgress?.(`网络搜索：${query}`);
          const results = await webSearch(query);
          resultContent = JSON.stringify(results);
        } else if (tc.name === 'webFetch') {
          const fetchUrl = args.url ?? source.url;
          onProgress?.(`正在抓取页面: ${fetchUrl}`);
          const result = await webFetch(fetchUrl);
          const truncNote = result.truncated ? '\n[内容已截断到前 500KB]' : '';
          resultContent = JSON.stringify({
            ok: result.ok,
            status: result.status,
            body: result.body + truncNote,
          });
        } else if (tc.name === 'webFetchBrowser') {
          const fetchUrl = args.url ?? source.url;
          onProgress?.(`正在用浏览器渲染页面: ${fetchUrl}`);
          const result = await webFetchBrowser(fetchUrl);
          resultContent = JSON.stringify({
            ok: result.ok,
            status: result.status,
            html: result.html,
            capturedRequests: result.capturedRequests,
            note: result.capturedRequests.length > 0
              ? `已捕获 ${result.capturedRequests.length} 个 JSON API 请求，建议优先分析 capturedRequests 中的端点和数据结构来编写采集脚本`
              : '未捕获到 JSON API 请求，请根据渲染后的 HTML 结构编写采集脚本',
          });
        } else if (tc.name === 'validateScript') {
          validateAttempts++;
          const scriptArg = args.script ?? '';
          lastScriptAttempted = scriptArg;
          onProgress?.(`验证脚本 (第 ${validateAttempts} 次)...`);
          const result = await validateScript(scriptArg);

          // Detect sandbox unavailable (e.g. isolated-vm not built on Node v23 Windows)
          if (result.error?.includes('isolated-vm native module')) {
            sandboxUnavailable = true;
            onProgress?.('沙箱在当前环境不可用（需要 Node v22 LTS），脚本将跳过验证');
            resultContent = JSON.stringify({
              success: false,
              error: '沙箱不可用，请直接输出最终完整脚本并结束，不要再调用 validateScript。',
            });
          } else if (!result.success) {
            // Layer 1 failure: sandbox execution error or no data collected
            onProgress?.(`验证失败: ${(result.error ?? '').slice(0, 80)}`);
            const resultPayload: Record<string, unknown> = {
              success: false,
              itemCount: result.itemCount ?? 0,
              items: result.items?.slice(0, 3),
              error: result.error,
            };
            // Source is fundamentally unreachable (CAPTCHA / WAF / parked domain)
            // → abort the agent loop immediately, do not waste more iterations.
            if (result.fatal) {
              fatalError = result.failureHint ?? '源不可达';
              onProgress?.(`源不可达，放弃: ${fatalError.slice(0, 80)}`);
              break; // exit the agent loop
            }
            // Surface source-staleness
            if (result.stale) {
              resultPayload.stale = result.stale;
              resultPayload.hint =
                '源已停更（最新数据 > 180 天）。脚本逻辑没问题，是站点本身没新数据了。' +
                '请直接返回当前最佳脚本并结束，不要再尝试修复。';
            }
            // Structured failure hint: tells the LLM exactly which strategy to switch to
            if (result.failureHint) {
              resultPayload.failureHint = result.failureHint;
              // Always prepend a note that prevents the LLM from retrying the same approach
              resultPayload.note =
                '不是脚本写法问题——请不要再用同样的 fetch/选择器方案重试。' +
                '必须按 failureHint 的指引改用 webFetchBrowser / rssRadar / webSearch 寻找替代入口。' +
                (validateAttempts >= MAX_RETRIES
                  ? ` 已重试 ${MAX_RETRIES} 轮，请返回当前最佳脚本并结束。`
                  : '');
            } else if (validateAttempts >= MAX_RETRIES) {
              resultPayload.note =
                `已重试 ${MAX_RETRIES} 轮验证，请返回当前最佳脚本并结束。` +
                '如果实在无法采集，请在最终回复中说明原因（如：目标站需 JS 渲染、页面结构无法解析、无 RSS/API）。';
            }
            resultContent = JSON.stringify(resultPayload);
          } else {
            // Layer 1 passed: ≥1 items collected — run layers 2 & 3 (LLM quality + data check)
            onProgress?.(`沙箱验证通过（${result.itemCount} 条），正在进行质量审查...`);
            const llmCheck = await validateScriptAgent(
              source,
              scriptArg,
              result.items ?? [],
              iteration + 1, // offset so LLM call indices don't overlap with current iteration
              onLLMCall,
              userId
            );

            if (llmCheck.valid) {
              lastScript = scriptArg;
              lastValidItems = result.items;
              onProgress?.(`审查通过，采集到 ${result.itemCount ?? 0} 条内容`);
              resultContent = JSON.stringify({
                success: true,
                itemCount: result.itemCount ?? 0,
                items: result.items?.slice(0, 3),
              });
            } else if (llmCheck.fixedScript) {
              // Quality review failed but provided a fixed script — validate it automatically
              // instead of relying on the LLM to call validateScript again.
              onProgress?.(`审查失败，正在自动验证修复脚本...`);
              const fixResult = await validateScript(llmCheck.fixedScript);
              if (fixResult.success) {
                // Re-run LLM quality check on the fixed script
                onProgress?.(`修复脚本沙箱通过（${fixResult.itemCount} 条），正在二次审查...`);
                const fixLlmCheck = await validateScriptAgent(
                  source,
                  llmCheck.fixedScript,
                  fixResult.items ?? [],
                  iteration + 50,
                  onLLMCall,
                  userId
                );
                if (fixLlmCheck.valid) {
                  lastScript = llmCheck.fixedScript;
                  lastValidItems = fixResult.items;
                  onProgress?.(`修复脚本审查通过，采集到 ${fixResult.itemCount ?? 0} 条内容`);
                  resultContent = JSON.stringify({
                    success: true,
                    itemCount: fixResult.itemCount ?? 0,
                    items: fixResult.items?.slice(0, 3),
                  });
                } else {
                  // Fixed script also failed quality review — feed back to LLM
                  onProgress?.(`修复脚本审查仍失败: ${fixLlmCheck.reason.slice(0, 80)}`);
                  resultContent = JSON.stringify({
                    success: false,
                    itemCount: fixResult.itemCount ?? 0,
                    sandboxPassed: true,
                    error: `修复脚本质量审查仍失败：${fixLlmCheck.reason}`,
                    ...(validateAttempts >= MAX_RETRIES
                      ? { note: `已尝试 ${MAX_RETRIES} 次，请返回当前最佳脚本并结束。` }
                      : {}),
                  });
                }
              } else {
                // Fixed script failed sandbox — feed back to LLM
                onProgress?.(`修复脚本沙箱验证失败: ${(fixResult.error ?? '').slice(0, 80)}`);
                resultContent = JSON.stringify({
                  success: false,
                  itemCount: fixResult.itemCount ?? 0,
                  error: `修复脚本沙箱验证失败：${fixResult.error ?? '未采集到数据'}`,
                  ...(validateAttempts >= MAX_RETRIES
                    ? { note: `已尝试 ${MAX_RETRIES} 次，请返回当前最佳脚本并结束。` }
                    : {}),
                });
              }
            } else {
              // Layers 2/3 failed, no fixed script provided
              onProgress?.(`审查失败: ${llmCheck.reason.slice(0, 80)}`);
              resultContent = JSON.stringify({
                success: false,
                itemCount: result.itemCount ?? 0,
                sandboxPassed: true,
                error: `质量审查失败：${llmCheck.reason}`,
                ...(validateAttempts >= MAX_RETRIES
                  ? { note: `已尝试 ${MAX_RETRIES} 次，请返回当前最佳脚本并结束。` }
                  : {}),
              });
            }
          }
        } else {
          resultContent = JSON.stringify({ error: `未知工具：${tc.name}` });
        }
      } catch (err) {
        resultContent = JSON.stringify({
          error: err instanceof Error ? err.message : String(err),
        });
      }

      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: resultContent,
      } as Message);
    }
  }

  if (lastScript && lastValidItems !== undefined) {
    return {
      success: true,
      script: lastScript,
      cronExpression: lastCronExpression,
      initialItems: lastValidItems,
    };
  }

  // If the source was marked as fatally unreachable, stop immediately.
  // Don't try to salvage a script — there is no recovery.
  if (fatalError) {
    return { success: false, error: `源不可达：${fatalError}` };
  }

  // If no successful validation, try to extract a script from the conversation.
  // The LLM often outputs its "best attempt" as a final code block after being
  // told to stop retrying — run one last validation instead of failing immediately.
  const lastAssistantMsg = messages
    .filter((m) => m.role === 'assistant')
    .map((m) => (typeof m.content === 'string' ? m.content : ''))
    .join('\n');

  // Extract all code blocks, newest first
  const scriptMatches = [...lastAssistantMsg.matchAll(/```[^\n]*\n([\s\S]*?)```/g)];
  const candidates = scriptMatches.map((m) => m[1]).reverse();

  // Pick the first candidate that looks "complete": has a function body and balanced braces.
  // This avoids truncated scripts caused by LLM output cut-off or malformed code blocks.
  let finalScript: string | undefined;
  for (const cand of candidates) {
    const trimmed = cand.trim();
    if (!trimmed) continue;
    // Must contain function declaration or at least 'collect'
    if (!/function\s+collect|async\s+function|export\s+(default\s+)?(async\s+)?function/.test(trimmed)) continue;
    // Quick brace balance check
    let depth = 0;
    for (const ch of trimmed) {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
    }
    if (depth === 0) { finalScript = trimmed; break; }
  }
  if (!finalScript) {
    // Fallback: take the longest code block (most likely the complete one)
    finalScript = candidates.reduce((best, cur) => cur.trim().length > best.length ? cur.trim() : best, '') || lastScriptAttempted;
  }

  // Sandbox unavailable — return the best script the LLM produced (from final text output
  // if available, otherwise the last validateScript attempt) unverified.
  if (sandboxUnavailable) {
    if (finalScript) {
      return {
        success: false,
        sandboxUnavailable: true,
        script: finalScript,
        cronExpression: lastCronExpression,
        initialItems: [],
      };
    }
    return { success: false, error: '沙箱不可用且未能提取有效脚本' };
  }

  if (finalScript) {
    onProgress?.('对最终脚本进行验证...');
    try {
      const result = await validateScript(finalScript);

      if (result.error?.includes('isolated-vm native module')) {
        return {
          success: false,
          sandboxUnavailable: true,
          script: finalScript,
          cronExpression: lastCronExpression,
          initialItems: [],
        };
      }

      if (result.fatal) {
        return {
          success: false,
          script: finalScript,
          error: `源不可达：${result.failureHint ?? result.error}`,
        };
      }

      if (result.success) {
        onProgress?.(`沙箱验证通过（${result.itemCount} 条），正在进行质量审查...`);
        const llmCheck = await validateScriptAgent(
          source,
          finalScript,
          result.items ?? [],
          100, // high offset — avoids callIndex conflicts with the main loop
          onLLMCall,
          userId
        );
        if (llmCheck.valid) {
          return {
            success: true,
            script: finalScript,
            cronExpression: lastCronExpression,
            initialItems: result.items,
          };
        }
        return {
          success: false,
          script: llmCheck.fixedScript ?? finalScript,
          error: `质量审查失败：${llmCheck.reason}`,
        };
      }

      // Real execution error (syntax / runtime or no data collected)
      // If the script itself detected the source is stale, surface a clean reason
      // so the admin knows the script worked correctly and the source is the problem.
      if (result.stale) {
        return {
          success: false,
          script: finalScript,
          error: `源已停更：最新数据时间 ${result.stale.latestDate}（超过 180 天），建议在管理后台废弃该源`,
        };
      }
      return {
        success: false,
        script: finalScript,
        error: result.error ?? '脚本已生成，但多次验证均未通过',
      };
    } catch {
      return {
        success: false,
        script: finalScript,
        error: '脚本已生成，但验证过程中发生意外错误',
      };
    }
  }

  return { success: false, error: '智能体未能生成有效脚本' };
}
