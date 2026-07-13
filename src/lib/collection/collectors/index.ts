import { createJsonSourceCollector } from './jsonSourceCollector';
import { createRssSourceCollector } from './rssSourceCollector';
import { createSearchSourceCollector } from './searchSourceCollector';
import { createScriptSourceCollector } from './scriptSourceCollector';
import type {
  CollectCandidates,
  CollectorSource,
  CollectorType,
  SourceCollector,
} from './types';

export type CollectorRegistry = Record<CollectorType, SourceCollector>;

export function createCollectorDispatcher(
  registry: CollectorRegistry,
): CollectCandidates {
  return async (source: CollectorSource) => {
    const collectorType = source.collectorType as string;
    if (
      collectorType !== 'search'
      && collectorType !== 'rss'
      && collectorType !== 'json'
      && collectorType !== 'feed_script'
    ) {
      throw new Error(`Unknown collector type: ${collectorType}`);
    }
    return registry[collectorType].collectCandidates(source);
  };
}

const runtimeDispatcher = createCollectorDispatcher({
  search: createSearchSourceCollector(),
  rss: createRssSourceCollector(),
  json: createJsonSourceCollector(),
  feed_script: createScriptSourceCollector(),
});

export const collectCandidatesForSource: CollectCandidates = (source) => (
  runtimeDispatcher(source)
);

export type {
  CollectCandidates,
  CollectorSource,
  CollectorType,
  SourceCollector,
} from './types';
