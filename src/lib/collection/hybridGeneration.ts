import { isReusableGeneratedSample } from '@/lib/ai/agents/sourceSampleQuality';
import { parseJsonCollectorConfig } from '@/lib/collection/collectors/jsonSourceCollector';
import { parseSearchPlanConfig } from '@/lib/collection/collectors/searchSourceCollector';
import type { CollectedItem } from '@/lib/sandbox/contract';
import type {
  CollectionMode,
  FoundSource,
  GeneratedSource,
} from '@/types/wizard';

export interface ScriptGenerationResult {
  success: boolean;
  script?: string;
  cronExpression?: string;
  initialItems?: CollectedItem[];
  sandboxUnavailable?: boolean;
  error?: string;
}

export interface GenerationSuccessPayload {
  sourceUrl: string;
  collectionMode?: CollectionMode;
  searchPlan?: FoundSource['searchPlan'];
  collectorConfigJson?: string;
  discoveryVersion?: 1;
  cronExpression?: string;
  initialItems?: CollectedItem[];
  script?: string;
  unverified?: boolean;
}

export interface HybridGenerationOutcome {
  sourceIndex: number;
  source: FoundSource;
  status: 'success' | 'unverified' | 'failed';
  generatedSource: GeneratedSource;
  generatedBy: 'collector' | 'script';
  error?: string;
  cause?: unknown;
}

export interface HybridGenerationLog {
  level: 'success' | 'error';
  payload: GenerationSuccessPayload;
}

export interface RunHybridGenerationOptions {
  now?: Date;
  onOutcome?: (outcome: HybridGenerationOutcome) => void | Promise<void>;
}

export function requiresScriptGeneration(source: Pick<FoundSource, 'collectionMode'>) {
  return (source.collectionMode ?? 'feed_script') === 'feed_script';
}

export function canRetrySourceGeneration(
  sourceUrl: string,
  canonicalSource: FoundSource | undefined,
  hasWizardState: boolean,
) {
  if (canonicalSource) return requiresScriptGeneration(canonicalSource);
  try {
    const protocol = new URL(sourceUrl).protocol;
    if (protocol !== 'http:' && protocol !== 'https:') return false;
  } catch {
    return false;
  }
  return !hasWizardState;
}

function collectorConfigFor(source: FoundSource) {
  if (source.collectorConfigJson?.trim()) return source.collectorConfigJson;
  return JSON.stringify(source.searchPlan ?? {});
}

function hasValidCollectorConfig(source: FoundSource, configJson: string) {
  try {
    if (source.collectionMode === 'search') parseSearchPlanConfig(configJson);
    if (source.collectionMode === 'json') parseJsonCollectorConfig(configJson, source.url);
    return true;
  } catch {
    return false;
  }
}

export function createValidatedCollectorGeneratedSource(
  source: FoundSource,
  criteria: string | undefined,
  now = new Date(),
): GeneratedSource | null {
  if (requiresScriptGeneration(source)) return null;
  if (source.discoveryVersion !== 1 || !isReusableGeneratedSample(source.initialItems, criteria, now)) {
    return null;
  }
  if (source.collectionMode === 'search' && !source.searchPlan?.queries?.length) return null;

  const collectorConfigJson = collectorConfigFor(source);
  if (!hasValidCollectorConfig(source, collectorConfigJson)) return null;

  return {
    title: source.title,
    url: source.url,
    description: source.description,
    script: '',
    cronExpression: '0 * * * *',
    initialItems: source.initialItems ?? [],
    isEnabled: true,
    collectionMode: source.collectionMode,
    searchPlan: source.searchPlan,
    collectorConfigJson,
    discoveryVersion: 1,
  };
}

function generatedSourceBase(source: FoundSource) {
  return {
    title: source.title,
    url: source.url,
    description: source.description,
    collectionMode: source.collectionMode ?? 'feed_script' as CollectionMode,
    searchPlan: source.searchPlan,
    collectorConfigJson: source.collectorConfigJson,
    discoveryVersion: source.discoveryVersion,
  };
}

function failedOutcome(
  source: FoundSource,
  sourceIndex: number,
  generatedBy: HybridGenerationOutcome['generatedBy'],
  error: string,
  script = '',
  cause?: unknown,
): HybridGenerationOutcome {
  return {
    sourceIndex,
    source,
    status: 'failed',
    generatedBy,
    error,
    cause,
    generatedSource: {
      ...generatedSourceBase(source),
      script,
      cronExpression: '0 * * * *',
      initialItems: [],
      isEnabled: false,
      failedReason: error,
    },
  };
}

async function generateOne(
  source: FoundSource,
  sourceIndex: number,
  criteria: string | undefined,
  generateFeedScript: (source: FoundSource, sourceIndex: number) => Promise<ScriptGenerationResult>,
  now: Date,
): Promise<HybridGenerationOutcome> {
  if (!requiresScriptGeneration(source)) {
    const generatedSource = createValidatedCollectorGeneratedSource(source, criteria, now);
    return generatedSource
      ? {
          sourceIndex,
          source,
          status: 'success',
          generatedBy: 'collector',
          generatedSource,
        }
      : failedOutcome(
          source,
          sourceIndex,
          'collector',
          'Validated collector configuration or current samples are missing',
        );
  }

  try {
    const result = await generateFeedScript(source, sourceIndex);
    if (result.success && result.script) {
      return {
        sourceIndex,
        source,
        status: 'success',
        generatedBy: 'script',
        generatedSource: {
          ...generatedSourceBase(source),
          script: result.script,
          cronExpression: result.cronExpression ?? '0 * * * *',
          initialItems: result.initialItems ?? [],
          isEnabled: true,
        },
      };
    }
    if (result.sandboxUnavailable && result.script) {
      return {
        sourceIndex,
        source,
        status: 'unverified',
        generatedBy: 'script',
        generatedSource: {
          ...generatedSourceBase(source),
          script: result.script,
          cronExpression: result.cronExpression ?? '0 * * * *',
          initialItems: [],
          isEnabled: true,
        },
      };
    }
    return failedOutcome(
      source,
      sourceIndex,
      'script',
      result.error ?? 'Script generation failed',
      result.script ?? '',
    );
  } catch (cause) {
    return failedOutcome(
      source,
      sourceIndex,
      'script',
      cause instanceof Error ? cause.message : String(cause),
      '',
      cause,
    );
  }
}

export async function runHybridGeneration(
  sources: FoundSource[],
  criteria: string | undefined,
  generateFeedScript: (source: FoundSource, sourceIndex: number) => Promise<ScriptGenerationResult>,
  options: RunHybridGenerationOptions = {},
) {
  const now = options.now ?? new Date();
  return Promise.all(sources.map(async (source, sourceIndex) => {
    const outcome = await generateOne(source, sourceIndex, criteria, generateFeedScript, now);
    await options.onOutcome?.(outcome);
    return outcome;
  }));
}

export function generationLogFromOutcome(outcome: HybridGenerationOutcome): HybridGenerationLog {
  const generated = outcome.generatedSource;
  const common: GenerationSuccessPayload = {
    sourceUrl: generated.url,
    collectionMode: generated.collectionMode,
    searchPlan: generated.searchPlan,
    collectorConfigJson: generated.collectorConfigJson,
    discoveryVersion: generated.discoveryVersion,
    cronExpression: generated.cronExpression,
    initialItems: generated.initialItems,
    ...(outcome.status === 'unverified' ? { unverified: true } : {}),
  };
  return {
    level: outcome.status === 'failed' ? 'error' : 'success',
    payload: generated.script ? { ...common, script: generated.script } : common,
  };
}

export function restoreGeneratedSourceFromSuccessPayload(
  source: FoundSource,
  payload: GenerationSuccessPayload,
  criteria: string | undefined,
  now = new Date(),
): GeneratedSource | null {
  if (payload.sourceUrl !== source.url || payload.unverified) return null;
  const sourceMode = source.collectionMode ?? 'feed_script';
  if (payload.collectionMode && payload.collectionMode !== sourceMode) return null;
  if (!Array.isArray(payload.initialItems)) return null;

  if (sourceMode !== 'feed_script') {
    return createValidatedCollectorGeneratedSource({
      ...source,
      collectionMode: sourceMode,
      searchPlan: payload.searchPlan ?? source.searchPlan,
      collectorConfigJson: payload.collectorConfigJson ?? source.collectorConfigJson,
      discoveryVersion: payload.discoveryVersion ?? source.discoveryVersion,
      initialItems: payload.initialItems as FoundSource['initialItems'],
    }, criteria, now);
  }

  if (!payload.script || !isReusableGeneratedSample(payload.initialItems, criteria, now)) return null;
  return {
    ...generatedSourceBase(source),
    script: payload.script,
    cronExpression: payload.cronExpression ?? '0 * * * *',
    initialItems: payload.initialItems,
    isEnabled: true,
  };
}

export function isReusableGeneratedSource(
  source: GeneratedSource,
  criteria: string | undefined,
  now = new Date(),
) {
  if ((source.collectionMode ?? 'feed_script') === 'feed_script') {
    return !!source.script && isReusableGeneratedSample(source.initialItems, criteria, now);
  }
  return createValidatedCollectorGeneratedSource({
    title: source.title,
    url: source.url,
    description: source.description,
    collectionMode: source.collectionMode,
    searchPlan: source.searchPlan,
    collectorConfigJson: source.collectorConfigJson,
    discoveryVersion: source.discoveryVersion,
    initialItems: source.initialItems as FoundSource['initialItems'],
  }, criteria, now) !== null;
}
