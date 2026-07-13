export type SourceType =
  | 'general_news'
  | 'local_news'
  | 'industry_vertical'
  | 'finance'
  | 'other';

export interface IntentSource {
  title: string;
  url: string;
  description: string;
  recommended?: boolean;
  sourceType?: SourceType;
}

const SOURCE_TYPE_PRIORITY: Record<SourceType, number> = {
  local_news: 0,
  general_news: 1,
  industry_vertical: 2,
  finance: 3,
  other: 4,
};

function includesAny(text: string, terms: string[]) {
  return terms.some((term) => text.includes(term));
}

export function classifySource(source: Pick<IntentSource, 'title' | 'description' | 'url'>): SourceType {
  const text = `${source.title} ${source.description} ${source.url}`.toLowerCase();

  if (includesAny(text, ['财经', '金融', '证券', '资本市场', '上市公司', 'finance', 'business'])) {
    return 'finance';
  }
  if (includesAny(text, ['人民政府', '市政府', '县政府', '区政府', '政府新闻', '政务', '地方新闻', '本地新闻', '地方媒体'])) {
    return 'local_news';
  }
  if (includesAny(text, ['社会新闻', '社会频道', '综合新闻', '突发事件', '时政', '民生'])) {
    return 'general_news';
  }
  if (includesAny(text, ['鞋业', '制鞋', '鞋厂', '鞋企', '鞋材', '皮革', '行业新闻', '行业媒体', '产业链', '协会'])) {
    return 'industry_vertical';
  }
  return 'other';
}

/**
 * Prefer sources that can cover incidents and local/industry dynamics.
 * Finance remains available as one supplementary source, never the default set.
 */
export function applySourceIntentPolicy<T extends IntentSource>(sources: T[]): Array<T & { sourceType: SourceType }> {
  const typed = sources.map((source) => ({
    ...source,
    // Finance markers in a title, description, or URL are unambiguous enough
    // to override an LLM label. This prevents a finance feed from evading the
    // one-source cap by claiming to be general news.
    sourceType: classifySource(source) === 'finance'
      ? 'finance' as const
      : source.sourceType ?? classifySource(source),
  }));

  typed.sort((a, b) => SOURCE_TYPE_PRIORITY[a.sourceType] - SOURCE_TYPE_PRIORITY[b.sourceType]);

  let financeRecommended = 0;
  return typed.map((source) => {
    if (source.sourceType === 'finance') {
      financeRecommended += 1;
      return { ...source, recommended: financeRecommended === 1 && source.recommended !== false };
    }

    if (source.sourceType === 'general_news' || source.sourceType === 'local_news' || source.sourceType === 'industry_vertical') {
      return { ...source, recommended: true };
    }

    return source;
  });
}
