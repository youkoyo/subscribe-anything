import pLimit from 'p-limit';
import { classifyCandidatesWithAI } from '@/lib/ai/agents/relevanceAgent';
import {
  profileCandidateTerms,
  type IndustryTermProfile,
  type ProfileRelevance,
} from './term-profile';

export interface ProfileCandidateItem {
  id: string;
  title: string;
  summary?: string | null;
}

function textContainsCandidateTerm(item: ProfileCandidateItem, terms: readonly string[]) {
  const text = `${item.title} ${item.summary ?? ''}`.toLocaleLowerCase('zh-CN');
  return terms.some((term) => text.includes(term.toLocaleLowerCase('zh-CN')));
}

/** Selects only industry-semantic candidates; context and event words never qualify alone. */
export function selectProfileCandidates<T extends ProfileCandidateItem>(
  profile: IndustryTermProfile,
  items: T[],
): T[] {
  const terms = profileCandidateTerms(profile);
  return items.filter((item) => textContainsCandidateTerm(item, terms));
}

/** Classifies semantic candidates in bounded batches without merging source items. */
export async function classifyProfileItems<T extends ProfileCandidateItem>(
  profile: IndustryTermProfile,
  items: T[],
  userId?: string | null,
): Promise<Map<string, ProfileRelevance>> {
  const candidates = selectProfileCandidates(profile, items);
  const classifications = new Map<string, ProfileRelevance>();
  const batches: T[][] = [];
  for (let offset = 0; offset < candidates.length; offset += 24) {
    batches.push(candidates.slice(offset, offset + 24));
  }

  const limit = pLimit(2);
  await Promise.all(batches.map((batch) => limit(async () => {
    const result = await classifyCandidatesWithAI(profile, batch, userId);
    for (const [id, relevance] of result) classifications.set(id, relevance);
  })));

  return classifications;
}
