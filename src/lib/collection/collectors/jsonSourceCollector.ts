import type { ArticleCandidate, JsonValue } from '../articleTypes';
import {
  fetchCollectorText,
  type CollectorHttpDependencies,
} from './httpCollectorFetch';
import type { CollectorSource, SourceCollector } from './types';
const UNSAFE_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);

interface JsonFieldMappings {
  title: string;
  url: string;
  publishedAt: string;
  summary?: string;
  publisherName?: string;
}

interface JsonCollectorConfig {
  endpoint?: string;
  itemsPath?: string;
  fields: JsonFieldMappings;
}

export type JsonSourceCollectorDependencies = CollectorHttpDependencies;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonBlankString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function validatePath(value: unknown, label: string, required: boolean) {
  if (value === undefined && !required) return undefined;
  const path = nonBlankString(value);
  if (!path) {
    if (required) throw new Error(`JSON collector config requires fields.${label}`);
    throw new Error(`JSON collector config ${label} must be a non-empty string`);
  }
  const segments = path.split('.');
  if (segments.some((segment) => !segment || UNSAFE_SEGMENTS.has(segment))) {
    throw new Error(`JSON collector field path ${label} is unsafe`);
  }
  return path;
}

function endpointUrl(value: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('JSON collector endpoint must be a valid HTTP(S) URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('JSON collector endpoint must be a valid HTTP(S) URL');
  }
  return parsed.toString();
}

export function parseJsonCollectorConfig(
  configJson: string,
  sourceUrl: string,
): JsonCollectorConfig & { endpoint: string } {
  let value: unknown;
  try {
    value = JSON.parse(configJson);
  } catch {
    throw new Error('JSON collector config must be valid JSON');
  }
  if (!isRecord(value) || !isRecord(value.fields)) {
    throw new Error('JSON collector config requires a fields mapping');
  }

  let configuredEndpoint: string | undefined;
  if (value.endpoint !== undefined) {
    configuredEndpoint = nonBlankString(value.endpoint);
    if (!configuredEndpoint || typeof value.endpoint !== 'string') {
      throw new Error('JSON collector endpoint must be a non-empty string');
    }
  }
  const endpoint = endpointUrl(configuredEndpoint ?? sourceUrl);
  const itemsPath = value.itemsPath === undefined
    ? undefined
    : validatePath(value.itemsPath, 'itemsPath', false);
  return {
    endpoint,
    ...(itemsPath ? { itemsPath } : {}),
    fields: {
      title: validatePath(value.fields.title, 'title', true) as string,
      url: validatePath(value.fields.url, 'url', true) as string,
      publishedAt: validatePath(value.fields.publishedAt, 'publishedAt', true) as string,
      ...(validatePath(value.fields.summary, 'summary', false)
        ? { summary: validatePath(value.fields.summary, 'summary', false) }
        : {}),
      ...(validatePath(value.fields.publisherName, 'publisherName', false)
        ? { publisherName: validatePath(value.fields.publisherName, 'publisherName', false) }
        : {}),
    },
  };
}

function getPath(value: unknown, path: string | undefined): unknown {
  if (!path) return value;
  let current = value;
  for (const segment of path.split('.')) {
    if (!isRecord(current) || !Object.prototype.hasOwnProperty.call(current, segment)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

function jsonSafe(value: unknown): JsonValue {
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? null : JSON.parse(serialized) as JsonValue;
  } catch {
    return null;
  }
}

function mappedString(value: unknown, path: string | undefined) {
  return path ? nonBlankString(getPath(value, path)) : undefined;
}

function candidate(item: unknown, fields: JsonFieldMappings): ArticleCandidate {
  const summary = mappedString(item, fields.summary);
  const publishedAt = mappedString(item, fields.publishedAt);
  const publisherName = mappedString(item, fields.publisherName);
  return {
    origin: 'feed',
    url: mappedString(item, fields.url) ?? '',
    title: mappedString(item, fields.title) ?? '',
    ...(summary ? { summary } : {}),
    ...(publishedAt ? { publishedAt } : {}),
    ...(publisherName ? { publisherName } : {}),
    raw: jsonSafe(item),
  };
}

export function createJsonSourceCollector(
  dependencies: JsonSourceCollectorDependencies = {},
): SourceCollector {
  return {
    async collectCandidates(source: CollectorSource) {
      const config = parseJsonCollectorConfig(source.collectorConfigJson, source.url);
      const response = await fetchCollectorText(config.endpoint, dependencies, {
        label: 'JSON',
        headers: {
          Accept: 'application/json',
          'User-Agent': 'SubscribeAnything/1.0; runtime JSON collector',
        },
      });
      let document: unknown;
      try {
        document = JSON.parse(response.text);
      } catch {
        throw new Error('JSON collector response must contain valid JSON');
      }
      const items = getPath(document, config.itemsPath);
      if (!Array.isArray(items)) {
        throw new Error('JSON collector itemsPath must resolve to an array');
      }
      return items.map((item) => candidate(item, config.fields));
    },
  };
}
