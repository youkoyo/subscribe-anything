import type { ArticleCandidate } from '../articleTypes';

export type CollectorType = 'search' | 'rss' | 'json' | 'feed_script';

export interface CollectorSource {
  id: string;
  subscriptionId: string;
  title: string;
  collectorType: CollectorType;
  collectorConfigJson: string;
  url: string;
  script: string;
  cronExpression: string;
}

export interface SourceCollector {
  collectCandidates(source: CollectorSource): Promise<ArticleCandidate[]>;
}

export type CollectCandidates = (
  source: CollectorSource,
) => Promise<ArticleCandidate[]>;
