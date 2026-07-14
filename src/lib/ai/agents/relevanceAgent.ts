import { buildOpenAIClient, getProviderForTemplate } from '@/lib/ai/client';
import {
  classifyProfileRelevance,
  type IndustryTermProfile,
  type ProfileRelevance,
  type RelevanceLabel,
} from '@/lib/industry-configs/term-profile';

export interface RelevanceCandidate {
  id: string;
  title: string;
  summary?: string | null;
}

function readJson(content: string | null): unknown {
  if (!content) return null;
  const raw = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? content;
  const array = raw.match(/\[[\s\S]*\]/)?.[0];
  try { return array ? JSON.parse(array) : null; } catch { return null; }
}

function safeLabel(value: unknown): RelevanceLabel | null {
  return value === 'strong' || value === 'related' || value === 'irrelevant' ? value : null;
}

/** AI confirmation for lexical candidates. It never merges items from different feeds. */
export async function classifyCandidatesWithAI(
  profile: IndustryTermProfile,
  candidates: RelevanceCandidate[],
  userId?: string | null
): Promise<Map<string, ProfileRelevance>> {
  const fallback = new Map(candidates.map((candidate) => [
    candidate.id,
    classifyProfileRelevance(profile, candidate),
  ]));
  if (candidates.length === 0) return fallback;

  try {
    const provider = await getProviderForTemplate('find-sources', userId);
    const openai = buildOpenAIClient(provider);
    const response = await openai.chat.completions.create({
      model: provider.modelId,
      temperature: 0,
      messages: [
        { role: 'system', content: '你是产业新闻相关性分类器。只输出 JSON 数组，不要合并、去重、改写条目。' },
        { role: 'user', content: JSON.stringify({
          profile,
          labels: {
            strong: '直接报道产业本体、明确同义名或产业本体的核心事件',
            related: '直接涉及画像中的经营主体/场所、产品/工艺或供应链，并与该产业存在实际关联',
            irrelevant: '只有词面巧合、仅命中宽泛上下文或风险事件词、泛生活内容，或与产业无实际关系',
          },
          items: candidates,
          output: [{ id: 'item id', label: 'strong|related|irrelevant', reason: '不超过30字' }],
        }) },
      ],
    });
    const parsed = readJson(response.choices[0]?.message.content ?? null);
    if (!Array.isArray(parsed)) return fallback;
    for (const entry of parsed) {
      if (!entry || typeof entry !== 'object') continue;
      const record = entry as Record<string, unknown>;
      const id = typeof record.id === 'string' ? record.id : '';
      const label = safeLabel(record.label);
      if (!id || !label || !fallback.has(id)) continue;
      const existing = fallback.get(id)!;
      fallback.set(id, {
        label,
        matchedTerms: existing.matchedTerms,
        reason: typeof record.reason === 'string' && record.reason.trim()
          ? record.reason.trim().slice(0, 60)
          : existing.reason,
      });
    }
  } catch (error) {
    console.warn('[relevance classifier] AI confirmation fell back to profile rules:', error);
  }
  return fallback;
}
