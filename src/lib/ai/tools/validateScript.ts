/**
 * validateScript tool — runs a collection script in the isolated-vm sandbox
 * and returns success/items/error with structured failure diagnostics.
 */

import { runScript } from '@/lib/sandbox/runner';
import type { CollectedItem } from '@/lib/sandbox/contract';

export interface ValidateResult {
  success: boolean;
  items?: CollectedItem[];
  itemCount?: number;
  error?: string;
  /** Structured failure hint so the agent can switch strategy instead of retrying blindly. */
  failureHint?: string;
  /** When true, this source is fundamentally unreachable (CAPTCHA/WAF/dead domain). Abandon it. */
  fatal?: boolean;
  /** When the script logged STALE_SOURCE_DETECTED — the source itself appears to have gone quiet. */
  stale?: { latestDate: string };
}

function classifyFailure(error: string | undefined, itemCount: number): { hint: string; fatal: boolean } | undefined {
  if (!error && itemCount > 0) return undefined;
  const msg = (error ?? '').toLowerCase();

  // Source is fundamentally unreachable — no recovery, stop immediately
  if (msg.includes('source_blocked_by_captcha') || msg.includes('captcha') ||
      msg.includes('waf_blocked') || msg.includes('waf拦截') ||
      msg.includes('domain_parked_for_sale') || msg.includes('domain pending') ||
      msg.includes('domain_expired')) {
    return {
      hint: 'DEAD_SOURCE: 目标站点不可访问（验证码/WAF/域名停售）。无法通过任何方式采集，请立即放弃该源。',
      fatal: true,
    };
  }

  // Fetch itself failed — network error, DNS, connection refused, etc.
  if (msg.includes('fetch_failed') || msg.includes('fetch failed') ||
      msg.includes('econnrefused') || msg.includes('enotfound') || msg.includes('econnreset') ||
      msg.includes('network error') || msg.includes('dns')) {
    return {
      hint: 'FETCH_FAILED: 沙箱无法访问目标 URL。请立即改用 webFetchBrowser 重抓页面，并分析 capturedRequests 中的 API 端点来编写脚本。不要在 fetch 调用上反复调整参数。',
      fatal: false,
    };
  }

  // Anti-crawl / blocked
  if (msg.includes('403') || msg.includes('429') || msg.includes('406') ||
      msg.includes('forbidden') || msg.includes('blocked') || msg.includes('rate limit')) {
    return {
      hint: 'ANTI_CRAWL: 目标站返回 403/429 反爬状态码。请立即改用 webFetchBrowser 渲染页面，分析 capturedRequests 找到底层 API 端点。',
      fatal: false,
    };
  }

  // Empty page / script matched nothing
  if (itemCount === 0) {
    return {
      hint: 'EMPTY_RESULT: 脚本运行成功但未采集到数据。请立即用 webFetchBrowser 确认页面实际结构，优先分析 capturedRequests 中的 JSON API。',
      fatal: false,
    };
  }

  return undefined;
}

export async function validateScript(script: string): Promise<ValidateResult> {
  const result = await runScript(script);
  if (!result.success) {
    const classification = classifyFailure(result.error, 0);
    return {
      success: false,
      error: result.error,
      ...(classification ? { failureHint: classification.hint, fatal: classification.fatal } : {}),
      ...extractStale(result.error),
    };
  }
  const itemCount = result.items?.length ?? 0;
  if (itemCount === 0) {
    const classification = classifyFailure(
      result.error ?? '脚本执行成功但未采集到任何数据，请检查页面选择器或目标 URL 结构',
      0
    );
    return {
      success: false,
      itemCount: 0,
      error: '脚本执行成功但未采集到任何数据，请检查页面选择器或目标 URL 结构',
      ...(classification ? { failureHint: classification.hint, fatal: classification.fatal } : {}),
    };
  }
  return {
    success: true,
    items: result.items,
    itemCount,
  };
}

function extractStale(text?: string | null): { stale?: { latestDate: string } } {
  if (!text) return {};
  const match = text.match(/STALE_SOURCE_DETECTED\s+latest=([0-9TZ:.\-]+)/);
  if (match) {
    return { stale: { latestDate: match[1] } };
  }
  return {};
}

/** OpenAI tool definition for validateScript */
export const validateScriptToolDef = {
  type: 'function' as const,
  function: {
    name: 'validateScript',
    description: 'Run a collection script in the sandbox and check if it works correctly. Returns success/error and the collected items.',
    parameters: {
      type: 'object',
      properties: {
        script: {
          type: 'string',
          description: 'The JavaScript collection script to validate. Must export an async function collect().',
        },
      },
      required: ['script'],
    },
  },
};
