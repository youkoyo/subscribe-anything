import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { decodeHttpText } from '@/lib/utils/httpTextDecoder';

const DEFAULT_MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export type CollectorFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export type ResolveHostname = (hostname: string) => Promise<string[]>;

export interface CollectorHttpDependencies {
  fetchFn?: CollectorFetch;
  resolveHostnameFn?: ResolveHostname;
  maxResponseBytes?: number;
}

export interface FetchCollectorTextOptions {
  label: string;
  headers: HeadersInit;
  timeoutMs?: number;
}

export interface CollectorTextResponse {
  text: string;
  finalUrl: string;
}

async function defaultResolveHostname(hostname: string) {
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  return addresses.map((entry) => entry.address);
}

function unsafeIpv4(address: string) {
  const octets = address.split('.').map(Number);
  if (
    octets.length !== 4
    || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return true;
  }
  const [a, b, c] = octets;
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0 && c === 0)
    || (a === 192 && b === 0 && c === 2)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113)
    || a >= 224;
}

function ipv6Groups(input: string) {
  let address = input.toLowerCase().split('%', 1)[0];
  if (address.startsWith('[') && address.endsWith(']')) {
    address = address.slice(1, -1);
  }

  const ipv4Match = address.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (ipv4Match) {
    const octets = ipv4Match[1].split('.').map(Number);
    if (octets.some((octet) => octet < 0 || octet > 255)) return undefined;
    address = `${address.slice(0, -ipv4Match[1].length)}${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
  }

  const halves = address.split('::');
  if (halves.length > 2) return undefined;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  const omitted = 8 - left.length - right.length;
  if ((halves.length === 1 && omitted !== 0) || omitted < 0) return undefined;
  const groups = [
    ...left,
    ...Array.from({ length: halves.length === 2 ? omitted : 0 }, () => '0'),
    ...right,
  ].map((part) => Number.parseInt(part || '0', 16));
  if (groups.length !== 8 || groups.some((part) => !Number.isFinite(part) || part < 0 || part > 0xffff)) {
    return undefined;
  }
  return groups;
}

function unsafeIpv6(address: string) {
  const groups = ipv6Groups(address);
  if (!groups) return true;
  const [first, second] = groups;
  const allZero = groups.every((group) => group === 0);
  const loopback = groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1;
  const ipv4Mapped = groups.slice(0, 5).every((group) => group === 0)
    && groups[5] === 0xffff;
  if (ipv4Mapped) {
    return unsafeIpv4([
      groups[6] >> 8,
      groups[6] & 0xff,
      groups[7] >> 8,
      groups[7] & 0xff,
    ].join('.'));
  }

  return allZero
    || loopback
    || (first & 0xfe00) === 0xfc00
    || (first & 0xffc0) === 0xfe80
    || (first & 0xffc0) === 0xfec0
    || (first & 0xff00) === 0xff00
    || (first === 0x2001 && second === 0x0db8)
    || first === 0x2002
    || (first === 0x0064 && second === 0xff9b)
    || (first & 0xe000) !== 0x2000;
}

function unsafeIpAddress(address: string) {
  const version = isIP(address.replace(/^\[|\]$/g, ''));
  if (version === 4) return unsafeIpv4(address);
  if (version === 6) return unsafeIpv6(address);
  return true;
}

async function assertSafeCollectorUrl(
  input: string,
  resolveHostnameFn: ResolveHostname,
) {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error('Collector URL must be a valid HTTP(S) URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Collector URL must use HTTP(S)');
  }
  if (url.username || url.password) {
    throw new Error('Unsafe collector URL: credentials are not allowed');
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (
    hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || hostname.endsWith('.local')
    || hostname.endsWith('.internal')
    || hostname.endsWith('.lan')
  ) {
    throw new Error('Unsafe collector URL: localhost or private targets are not allowed');
  }

  const version = isIP(hostname);
  const addresses = version ? [hostname] : await resolveHostnameFn(hostname);
  if (addresses.length === 0 || addresses.some(unsafeIpAddress)) {
    throw new Error('Unsafe collector URL: private, loopback, or link-local targets are not allowed');
  }
  return url;
}

async function readBoundedText(
  response: Response,
  label: string,
  maxResponseBytes: number,
) {
  const contentLength = Number(response.headers.get('content-length') ?? 0);
  if (Number.isFinite(contentLength) && contentLength > maxResponseBytes) {
    await response.body?.cancel();
    throw new Error(`${label} response exceeds ${maxResponseBytes} bytes`);
  }
  if (!response.body) return '';

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxResponseBytes) {
        await reader.cancel();
        throw new Error(`${label} response exceeds ${maxResponseBytes} bytes`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return decodeHttpText(bytes, response.headers.get('content-type') ?? undefined);
}

export async function fetchCollectorText(
  input: string,
  dependencies: CollectorHttpDependencies,
  options: FetchCollectorTextOptions,
): Promise<CollectorTextResponse> {
  const fetchFn = dependencies.fetchFn ?? fetch;
  const resolveHostnameFn = dependencies.resolveHostnameFn ?? defaultResolveHostname;
  const maxResponseBytes = dependencies.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );

  try {
    let currentUrl = input;
    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
      const safeUrl = await assertSafeCollectorUrl(currentUrl, resolveHostnameFn);
      const response = await fetchFn(safeUrl.toString(), {
        signal: controller.signal,
        headers: options.headers,
        redirect: 'manual',
      });

      if (REDIRECT_STATUSES.has(response.status)) {
        await response.body?.cancel();
        if (redirectCount === MAX_REDIRECTS) {
          throw new Error(`${options.label} fetch exceeded ${MAX_REDIRECTS} redirects`);
        }
        const location = response.headers.get('location');
        if (!location) throw new Error(`${options.label} redirect is missing a Location header`);
        currentUrl = new URL(location, safeUrl).toString();
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`${options.label} fetch failed (${response.status} ${response.statusText})`);
      }

      return {
        text: await readBoundedText(response, options.label, maxResponseBytes),
        finalUrl: safeUrl.toString(),
      };
    }
    throw new Error(`${options.label} fetch exceeded ${MAX_REDIRECTS} redirects`);
  } finally {
    clearTimeout(timeout);
  }
}
