import { lookup } from 'node:dns/promises';
import {
  request as httpRequest,
  type IncomingMessage,
} from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import { Readable } from 'node:stream';
import { decodeHttpText } from '@/lib/utils/httpTextDecoder';

const DEFAULT_MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export type CollectorFetch = (
  input: string,
  init?: RequestInit,
  validatedAddresses?: string[],
) => Promise<Response>;

export type ResolveHostname = (
  hostname: string,
  signal?: AbortSignal,
) => Promise<string[]>;

export interface CollectorHttpDependencies {
  fetchFn?: CollectorFetch;
  resolveHostnameFn?: ResolveHostname;
  maxResponseBytes?: number;
  timeoutMs?: number;
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

function abortError(signal: AbortSignal) {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error('Collector request timed out');
}

function waitForResolution(
  resolution: Promise<string[]>,
  signal: AbortSignal,
) {
  if (signal.aborted) return Promise.reject(abortError(signal));
  return new Promise<string[]>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort);
      reject(abortError(signal));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    resolution.then(
      (addresses) => {
        signal.removeEventListener('abort', onAbort);
        resolve(addresses);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
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
  signal: AbortSignal,
) {
  if (signal.aborted) throw abortError(signal);
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
  const addresses = version
    ? [hostname]
    : await waitForResolution(resolveHostnameFn(hostname, signal), signal);
  if (addresses.length === 0 || addresses.some(unsafeIpAddress)) {
    throw new Error('Unsafe collector URL: private, loopback, or link-local targets are not allowed');
  }
  return { url, addresses };
}

function pinnedLookup(validatedAddresses: string[]): LookupFunction {
  const entries = validatedAddresses.map((address) => ({
    address,
    family: isIP(address),
  }));
  const preferred = entries.find((entry) => entry.family === 4) ?? entries[0];

  return (_hostname, options, callback) => {
    if (options.all) {
      callback(null, entries);
      return;
    }
    callback(null, preferred.address, preferred.family);
  };
}

function responseHeaders(message: IncomingMessage) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(message.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else if (value !== undefined) {
      headers.set(name, value);
    }
  }
  return headers;
}

function pinnedNodeFetch(
  input: string,
  init: RequestInit = {},
  validatedAddresses: string[] = [],
) {
  if (validatedAddresses.length === 0) {
    return Promise.reject(new Error('Collector request has no validated network address'));
  }
  const url = new URL(input);
  const tlsServername = url.hostname.replace(/^\[|\]$/g, '');
  const headers: Record<string, string> = {};
  new Headers(init.headers).forEach((value, name) => {
    headers[name] = value;
  });
  const requestOptions = {
    method: init.method ?? 'GET',
    headers,
    signal: init.signal ?? undefined,
    agent: false as const,
    lookup: pinnedLookup(validatedAddresses),
  };

  return new Promise<Response>((resolve, reject) => {
    const onResponse = (message: IncomingMessage) => {
      const status = message.statusCode ?? 500;
      const signal = init.signal ?? undefined;
      const onAbort = () => message.destroy(signal ? abortError(signal) : undefined);
      signal?.addEventListener('abort', onAbort, { once: true });
      message.once('close', () => signal?.removeEventListener('abort', onAbort));

      const bodyIsForbidden = status === 204 || status === 205 || status === 304;
      const body = bodyIsForbidden
        ? null
        : Readable.toWeb(message) as ReadableStream<Uint8Array>;
      if (bodyIsForbidden) message.resume();
      resolve(new Response(body, {
        status,
        statusText: message.statusMessage,
        headers: responseHeaders(message),
      }));
    };

    const request = url.protocol === 'https:'
      ? httpsRequest(url, {
        ...requestOptions,
        servername: isIP(tlsServername) ? undefined : tlsServername,
      }, onResponse)
      : httpRequest(url, requestOptions, onResponse);
    request.once('error', reject);
    request.end();
  });
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
  const fetchFn = dependencies.fetchFn ?? pinnedNodeFetch;
  const resolveHostnameFn = dependencies.resolveHostnameFn ?? defaultResolveHostname;
  const maxResponseBytes = dependencies.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const controller = new AbortController();
  const timeoutMs = dependencies.timeoutMs
    ?? options.timeoutMs
    ?? DEFAULT_TIMEOUT_MS;
  const timeout = setTimeout(() => {
    controller.abort(new Error(`Collector request timed out after ${timeoutMs} ms`));
  }, timeoutMs);

  try {
    let currentUrl = input;
    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
      const safeTarget = await assertSafeCollectorUrl(
        currentUrl,
        resolveHostnameFn,
        controller.signal,
      );
      const response = await fetchFn(safeTarget.url.toString(), {
        signal: controller.signal,
        headers: options.headers,
        redirect: 'manual',
      }, safeTarget.addresses);

      if (REDIRECT_STATUSES.has(response.status)) {
        await response.body?.cancel();
        if (redirectCount === MAX_REDIRECTS) {
          throw new Error(`${options.label} fetch exceeded ${MAX_REDIRECTS} redirects`);
        }
        const location = response.headers.get('location');
        if (!location) throw new Error(`${options.label} redirect is missing a Location header`);
        currentUrl = new URL(location, safeTarget.url).toString();
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`${options.label} fetch failed (${response.status} ${response.statusText})`);
      }

      return {
        text: await readBoundedText(response, options.label, maxResponseBytes),
        finalUrl: safeTarget.url.toString(),
      };
    }
    throw new Error(`${options.label} fetch exceeded ${MAX_REDIRECTS} redirects`);
  } finally {
    clearTimeout(timeout);
  }
}
