export type SourcePreferencePriority = 'required' | 'preferred' | 'supplemental';
export type SourcePreferenceKind = 'general_news' | 'local_news' | 'industry_vertical';

export interface SourcePreference {
  id?: string;
  name: string;
  url: string;
  sourceType: SourcePreferenceKind;
  priority: SourcePreferencePriority;
  isEnabled: boolean;
}

/** National default sources. Regional sites are deliberately administrator-managed. */
export const DEFAULT_SOURCE_PREFERENCES: SourcePreference[] = [
  { name: '新华网', url: 'https://www.news.cn/', sourceType: 'general_news', priority: 'required', isEnabled: true },
  { name: '人民网', url: 'https://www.people.com.cn/', sourceType: 'general_news', priority: 'required', isEnabled: true },
  { name: '中国新闻网', url: 'https://www.chinanews.com.cn/', sourceType: 'general_news', priority: 'required', isEnabled: true },
  { name: '央视新闻', url: 'https://news.cctv.com/', sourceType: 'general_news', priority: 'required', isEnabled: true },
  { name: '中国日报网', url: 'https://cn.chinadaily.com.cn/', sourceType: 'general_news', priority: 'preferred', isEnabled: true },
  { name: '澎湃新闻', url: 'https://www.thepaper.cn/', sourceType: 'general_news', priority: 'preferred', isEnabled: true },
  { name: '中国皮革协会', url: 'https://www.chinaleather.org/', sourceType: 'industry_vertical', priority: 'supplemental', isEnabled: true },
];

function host(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

/** Return enabled required domains in administrator order, without duplicates. */
export function getRequiredSourceDomains(preferences: SourcePreference[], limit = 4) {
  const normalizedLimit = Math.max(0, Math.floor(limit));
  if (normalizedLimit === 0) return [];
  const domains: string[] = [];
  const seen = new Set<string>();

  for (const source of preferences) {
    if (!source.isEnabled || source.priority !== 'required') continue;
    const domain = host(source.url).toLowerCase();
    if (!domain || seen.has(domain)) continue;
    seen.add(domain);
    domains.push(domain);
    if (domains.length >= normalizedLimit) break;
  }

  return domains;
}

/** Build evidence-producing site searches, always starting with required sources. */
export function buildPreferredSourceQueries(query: string, preferences: SourcePreference[], limit = 4) {
  return getRequiredSourceDomains(preferences, limit)
    .map((domain) => `${query} site:${domain}`);
}

export function describeSourcePreferences(preferences: SourcePreference[]) {
  return preferences
    .filter((source) => source.isEnabled)
    .map((source) => ({ name: source.name, url: source.url, sourceType: source.sourceType, priority: source.priority }));
}

export async function getActiveSourcePreferences(): Promise<SourcePreference[]> {
  const { getDb } = await import('@/lib/db');
  const { sourcePreferences } = await import('@/lib/db/schema');
  const { eq } = await import('drizzle-orm');
  const rows = await getDb().select().from(sourcePreferences).where(eq(sourcePreferences.isEnabled, true));
  return rows.length > 0
    ? rows.map((row) => ({ name: row.name, url: row.url, sourceType: row.sourceType as SourcePreferenceKind, priority: row.priority as SourcePreferencePriority, isEnabled: row.isEnabled }))
    : DEFAULT_SOURCE_PREFERENCES;
}
