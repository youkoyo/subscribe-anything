/**
 * isolated-vm execution engine.
 *
 * Security model (layered):
 *  1. checkSafety() — static pattern analysis before entering the isolate
 *  2. isolated-vm Isolate — V8 native sandbox (same tech as Cloudflare Workers)
 *  3. Memory cap: 64 MB per Isolate
 *  4. Timeout: 30 s total
 *  5. Fetch proxy: max 5 HTTP requests, 5 MB response size limit
 *
 * Available inside the sandbox (documented in contract.ts):
 *   fetch(url, opts) — HTTP client (supports method, headers, body)
 *   URL, URLSearchParams — standard Web APIs
 *   TextDecoder, TextEncoder — standard encoding APIs
 *   atob, btoa — base64 encode/decode
 *   console.log — debug output
 *   HTML helpers — __htmlGetText, __htmlGetByTag, __htmlGetAttr, __htmlGetLinks, __htmlGetElements
 */

import type { CollectedItem, RunResult } from './contract';
import { checkSafety } from './safety';
import { assembleHelpers } from './helpers';

const MEMORY_LIMIT_MB = 64;
const TIMEOUT_MS = 30_000;
const MAX_FETCH_REQUESTS = 5;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

/**
 * Fix JSON-transport regex escaping damage.
 *
 * When scripts travel through JSON, JSON.parse converts \/ to /.
 * Inside regex literals this breaks the closing delimiter.
 * This repairs by replacing bare / inside regex bodies with [/].
 */
function repairRegexSlashes(src: string): string {
  const out: string[] = [];
  let i = 0;
  const len = src.length;
  const VALUE_ENDINGS = new Set([')', ']', '}', '++', '--']);
  let lastToken = '';

  while (i < len) {
    const ch = src[i];
    if (ch === '/' && src[i + 1] === '/') {
      const end = src.indexOf('\n', i);
      out.push(end < 0 ? src.slice(i) : src.slice(i, end));
      i += end < 0 ? src.length - i : end - i;
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      out.push(end < 0 ? src.slice(i) : src.slice(i, end + 2));
      i += end < 0 ? src.length - i : end + 2 - i;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let j = i + 1;
      while (j < len) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === quote) { j++; break; }
        j++;
      }
      out.push(src.slice(i, j));
      lastToken = ')'; i = j;
      continue;
    }
    if (ch === '`') {
      let j = i + 1, depth = 0;
      while (j < len) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '$' && src[j + 1] === '{') { depth++; j += 2; continue; }
        if (src[j] === '}' && depth > 0) { depth--; j++; continue; }
        if (src[j] === '`' && depth === 0) { j++; break; }
        j++;
      }
      out.push(src.slice(i, j));
      lastToken = ')'; i = j;
      continue;
    }
    if (ch === '/') {
      const isRegex = !VALUE_ENDINGS.has(lastToken) && !/^[\w$\d]$/.test(lastToken.slice(-1));
      if (isRegex) {
        let j = i + 1, inClass = false;
        const rx: string[] = ['/'];
        while (j < len) {
          const c = src[j];
          if (c === '\\') { rx.push(src[j], src[j + 1] ?? ''); j += 2; continue; }
          if (c === '[') { inClass = true; rx.push(c); j++; continue; }
          if (c === ']') { inClass = false; rx.push(c); j++; continue; }
          if (c === '/' && !inClass) { j++; rx.push('/'); while (j < len && /[a-zA-Z]/.test(src[j])) rx.push(src[j++]); break; }
          if (c === '/') { rx.push('[/]'); j++; continue; }
          rx.push(c); j++;
        }
        out.push(rx.join(''));
        lastToken = ')'; i = j;
        continue;
      }
      out.push(ch); lastToken = ch; i++;
      continue;
    }
    if (/\S/.test(ch)) lastToken = ch;
    out.push(ch); i++;
  }
  return out.join('');
}

function isRegexError(msg: string): boolean {
  const lower = msg.toLowerCase();
  return lower.includes('invalid regular expression') || lower.includes('flags');
}

/** Core pipeline: compile, inject helpers, run user script, collect result. */
async function _runInIsolate(scriptBody: string): Promise<RunResult> {
  let ivm: typeof import('isolated-vm');
  try {
    ivm = require('isolated-vm');
  } catch {
    return { success: false, error: 'isolated-vm native module is not available.' };
  }

  const isolate = new ivm.Isolate({ memoryLimit: MEMORY_LIMIT_MB });
  const context = await isolate.createContext();
  const jail = context.global;

  try {
    let fetchCount = 0;
    const hostFetch = new ivm.Reference(
      async (url: string, optsJson: string): Promise<string> => {
        if (fetchCount >= MAX_FETCH_REQUESTS) throw new Error(`Fetch limit exceeded (max ${MAX_FETCH_REQUESTS})`);
        fetchCount++;
        const opts: RequestInit = optsJson ? JSON.parse(optsJson) : {};
        const fetchInit: RequestInit = { method: opts.method ?? 'GET' };
        if (opts.headers) fetchInit.headers = opts.headers as HeadersInit;
        if (opts.body && (opts.method === 'POST' || opts.method === 'PUT' || opts.method === 'PATCH')) {
          fetchInit.body = opts.body;
        }
        const res = await fetch(url, fetchInit);
        const buffer = await res.arrayBuffer();
        if (buffer.byteLength > MAX_RESPONSE_BYTES) throw new Error('Response body exceeds 5 MB limit');
        const body = new TextDecoder().decode(buffer);
        const respHeaders: Record<string, string> = {};
        res.headers.forEach((v, k) => { respHeaders[k] = v; });
        return JSON.stringify({ ok: res.ok, status: res.status, statusText: res.statusText, headers: respHeaders, body });
      }
    );
    await jail.set('__hostFetch', hostFetch, { copy: true });

    const hostResolveURL = new ivm.Reference((urlStr: string, base: string | undefined): string => {
      const u = base != null ? new URL(urlStr, base) : new URL(urlStr);
      return JSON.stringify({ href: u.href, origin: u.origin, protocol: u.protocol, host: u.host, hostname: u.hostname, port: u.port, pathname: u.pathname, search: u.search, hash: u.hash, username: u.username, password: u.password });
    });
    await jail.set('__hostResolveURL', hostResolveURL, { copy: true });

    // Inject all helpers from the pre-compiled helpers module
    await context.eval(assembleHelpers());

    // Compile and run user script
    const compiledScript = await isolate.compileScript(`
      ${scriptBody}
      if (typeof module !== 'undefined' && module.exports && typeof module.exports.default === 'function') {
        globalThis.__collect = module.exports.default;
      } else if (typeof collect === 'function') {
        globalThis.__collect = collect;
      } else {
        throw new Error('Script must define an async function named collect()');
      }
    `);
    await compiledScript.run(context, { timeout: TIMEOUT_MS });

    const resultJson = await context.eval(
      '(async function() { return JSON.stringify(await __collect()); })()',
      { timeout: TIMEOUT_MS, promise: true }
    );

    const raw = typeof resultJson === 'string'
      ? resultJson
      : await (resultJson as unknown as { copy(): Promise<string> }).copy();
    const items = JSON.parse(raw) as CollectedItem[];

    if (!Array.isArray(items)) {
      return { success: false, error: 'collect() must return an array' };
    }

    // When script returns empty, surface console output to help AI debug
    if (items.length === 0) {
      let logs: string[] = [];
      try {
        const logsRaw = await context.eval('JSON.stringify(__consoleLogs)', { timeout: 3000 });
        const logsResult = typeof logsRaw === 'string' ? logsRaw : await (logsRaw as unknown as { copy(): Promise<string> }).copy();
        logs = JSON.parse(logsResult);
      } catch {
        // ignore — console capture is best-effort
      }
      const debugInfo = logs.length > 0
        ? '\\nSandbox console output:\\n' + logs.slice(0, 20).join('\\n').slice(0, 2000)
        : '\\n(Hint: add console.log(r) to inspect fetch response)';
      return { success: false, error: '脚本执行成功但未采集到任何数据，请检查页面选择器或目标 URL 结构' + debugInfo };
    }

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (typeof item.title !== 'string' || !item.title.trim()) {
        return { success: false, error: 'Item[' + i + '] missing required field: title' };
      }
      if (typeof item.url !== 'string' || !item.url.trim()) {
        return { success: false, error: 'Item[' + i + '] missing required field: url' };
      }
    }

    return { success: true, items };
  } finally {
    context.release();
    isolate.dispose();
  }
}

export async function runScript(script: string): Promise<RunResult> {
  const safetyResult = checkSafety(script);
  if (!safetyResult.safe) {
    return { success: false, error: '[Safety] ' + safetyResult.violation };
  }

  const normalizedScript = script
    .replace(/^\s*export\s+default\s+(async\s+function|function)\s+/gm, '$1 ')
    .replace(/^\s*export\s+default\s+(async\s+function|function)\s*\(/gm, '$1 collect(')
    .replace(/^\s*export\s+(async\s+function|function|class)\s+/gm, '$1 ')
    .replace(/^\s*export\s+(const|let|var)\s+/gm, '$1 ')
    .replace(/^\s*export\s*\{[^}]*\}\s*;?\s*$/gm, '');

  // Try the original script first
  const result = await _runInIsolate(normalizedScript);
  if (result.success) return result;
  if (!result.error || !isRegexError(result.error)) return result;

  // Regex error — likely JSON transport damage. Try repair.
  const repaired = repairRegexSlashes(normalizedScript);
  if (repaired === normalizedScript) return result;

  const repairedResult = await _runInIsolate(repaired);
  return repairedResult.success ? repairedResult : result;
}
