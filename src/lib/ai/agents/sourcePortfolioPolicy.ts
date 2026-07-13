import type { IntentSource } from './sourceIntentPolicy';

export interface SourceEvidence {
  url: string;
  title?: string;
  snippet?: string;
}

export interface SourceDecisionRecord {
  source: IntentSource;
  decision: 'accepted' | 'rejected';
  reason: string;
  evidence: SourceEvidence[];
}

/** Combine preflight and in-agent search evidence without losing later searches. */
export function collectSourceEvidence(...groups: SourceEvidence[][]): SourceEvidence[] {
  const byUrl = new Map<string, SourceEvidence>();
  for (const group of groups) {
    for (const item of group) {
      if (item.url) byUrl.set(item.url, item);
    }
  }
  return [...byUrl.values()];
}

function hostname(value: string) {
  try { return new URL(value).hostname.toLowerCase(); } catch { return ''; }
}

function registrableDomain(host: string) {
  const labels = host.split('.').filter(Boolean);
  if (labels.length < 3) return host;
  const publicSuffix = labels.slice(-2).join('.');
  // The sources in this product are predominantly Chinese sites, where a
  // registrable domain commonly has three labels (e.g. chinanews.com.cn).
  if (['com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn'].includes(publicSuffix)) {
    return labels.slice(-3).join('.');
  }
  return labels.slice(-2).join('.');
}

function hasSameEvidenceDomain(left: string, right: string) {
  if (!left || !right) return false;
  return left === right
    || left.endsWith(`.${right}`)
    || right.endsWith(`.${left}`)
    || registrableDomain(left) === registrableDomain(right);
}

function isTaiwanOrForeignOnly(source: IntentSource) {
  const text = `${source.title} ${source.description} ${source.url}`.toLowerCase();
  return /台湾|taiwan|tfn\.bestmotion|wwd\.com/.test(text);
}

function isDomesticSource(source: IntentSource) {
  if (isTaiwanOrForeignOnly(source)) return false;
  const host = hostname(source.url);
  return host.endsWith('.cn') || /中国|国内|人民政府|新华社|中新网|人民网/.test(`${source.title} ${source.description}`);
}

function hasDomainEvidence(source: IntentSource, evidence: SourceEvidence[]) {
  const sourceHost = hostname(source.url);
  return evidence.some((item) => {
    const evidenceHost = hostname(item.url);
    return hasSameEvidenceDomain(sourceHost, evidenceHost);
  });
}

export function getRecommendedSourcesMissingEvidence(sources: IntentSource[], evidence: SourceEvidence[]) {
  return sources.filter((source) => source.recommended && !hasDomainEvidence(source, evidence));
}

function evidenceForSource(source: IntentSource, evidence: SourceEvidence[]) {
  const sourceHost = hostname(source.url);
  return evidence.filter((item) => {
    const evidenceHost = hostname(item.url);
    return hasSameEvidenceDomain(sourceHost, evidenceHost);
  });
}

/**
 * Creates an audit-friendly record of every candidate considered by discovery.
 * The UI uses this instead of trying to infer an exclusion reason from the
 * final accepted list.
 */
export function buildSourceDecisionRecords(input: {
  acceptedSources: IntentSource[];
  candidateSources: IntentSource[];
  evidence: SourceEvidence[];
  rejectedReasons: string[];
}): SourceDecisionRecord[] {
  const acceptedUrls = new Set(input.acceptedSources.map((source) => source.url));
  const byUrl = new Map<string, IntentSource>();
  for (const source of [...input.candidateSources, ...input.acceptedSources]) {
    if (source.url) byUrl.set(source.url, source);
  }

  return [...byUrl.values()].map((source) => {
    const accepted = acceptedUrls.has(source.url);
    const matchedEvidence = evidenceForSource(source, input.evidence);
    return {
      source,
      decision: accepted ? 'accepted' : 'rejected',
      reason: accepted
        ? `通过实时新闻准入：${source.sourceType ?? '其他来源'}，${matchedEvidence.length > 0 ? '有对应检索证据' : '作为非推荐备选保留'}`
        : `未采用：${input.rejectedReasons.join('；') || '未进入最终可采集来源组合'}`,
      evidence: matchedEvidence.slice(0, 3),
    };
  });
}

export function evaluateSourcePortfolio(input: {
  criteria: string;
  sources: IntentSource[];
  evidence: SourceEvidence[];
}) {
  const reasons: string[] = [];
  const domesticRequired = input.criteria.includes('国内');
  const recommended = input.sources.filter((source) => source.recommended);

  if (input.sources.length < 5 || input.sources.length > 10) {
    reasons.push('候选源必须为至少 5 个且不超过 10 个');
  }

  const generalOrLocal = input.sources.filter((source) =>
    source.sourceType === 'general_news' || source.sourceType === 'local_news'
  );
  if (!generalOrLocal.some((source) => !domesticRequired || isDomesticSource(source))) {
    reasons.push('缺少国内综合或地方新闻源');
  }

  const industry = input.sources.filter((source) => source.sourceType === 'industry_vertical');
  if (!industry.some((source) => !domesticRequired || isDomesticSource(source))) {
    reasons.push('缺少国内行业垂直源');
  }

  if (recommended.filter((source) => source.sourceType === 'finance').length > 1) {
    reasons.push('财经推荐源不能超过 1 个');
  }

  for (const source of getRecommendedSourcesMissingEvidence(recommended, input.evidence)) {
    if (!hasDomainEvidence(source, input.evidence)) {
      reasons.push(`推荐源缺少预检索同域证据：${source.title}`);
    }
  }

  return { valid: reasons.length === 0, reasons };
}
