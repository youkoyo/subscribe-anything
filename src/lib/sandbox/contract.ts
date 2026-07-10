/**
 * Contract between the sandbox runner and user-authored collection scripts.
 *
 * Scripts must export:
 *   export default async function collect(): Promise<CollectedItem[]>
 *   — OR —
 *   async function collect(): Promise<CollectedItem[]>
 *   (the runner wraps the script so that a top-level `collect` function is found)
 *
 * Available globals inside the sandbox:
 *   fetch(url, opts)         — HTTP client, supports method, headers, body (max 5 req, 5 MB resp)
 *   URL, URLSearchParams     — standard Web APIs
 *   TextDecoder, TextEncoder — standard encoding APIs (utf-8, gbk, etc.)
 *   atob, btoa               — base64 encode / decode
 *   console.log(...)         — debug output (visible during validation, discarded at runtime)
 *
 * HTML helpers (pre-defined utility functions for parsing HTML without DOM API):
 *   __htmlGetText(html)          — strip tags, decode entities, return plain text
 *   __htmlGetByTag(html, tag)    — return array of innerHTML strings for all <tag> elements
 *   __htmlGetAttr(tagStr, attr)  — extract attribute value from an opening tag string
 *   __htmlGetLinks(html)         — return [{href, text}] for all <a> links in the HTML
 *   __htmlGetElements(html, tag) — return [{text, html, attrs}] for all <tag> elements
 */
export interface CollectedItem {
  title: string;        // required
  url: string;          // required
  summary?: string;
  thumbnailUrl?: string;
  publishedAt?: string; // ISO 8601
  /**
   * Script-evaluated criteria check result.
   * 'matched'     — metric extracted and satisfies the condition
   * 'not_matched' — metric extracted but does not satisfy the condition
   * 'invalid'     — metric could not be extracted from this item
   * Omit when there is no monitoring criteria.
   */
  criteriaResult?: 'matched' | 'not_matched' | 'invalid';
  /** Raw extracted metric value for display, e.g. "¥299" or "1,234 stars". */
  metricValue?: string;
}

export interface RunResult {
  success: boolean;
  items?: CollectedItem[];
  error?: string;
}
