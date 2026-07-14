import { buildOpenAIClient, getProviderForTemplate } from '@/lib/ai/client';
import {
  buildFallbackIndustryTermProfile,
  normalizeIndustryTermProfile,
  type IndustryProfileInput,
  type IndustryTermProfile,
} from '@/lib/industry-configs/term-profile';

function parseJsonObject(content: string | null): Record<string, unknown> | null {
  if (!content) return null;
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? content;
  const object = fenced.match(/\{[\s\S]*\}/)?.[0];
  if (!object) return null;
  try {
    const parsed = JSON.parse(object);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

/**
 * Creates an industry profile from plain language. The fallback keeps the
 * original topic intact, so a missing provider never blocks subscription setup.
 */
export async function generateIndustryTermProfile(
  input: IndustryProfileInput,
  userId?: string | null
): Promise<IndustryTermProfile> {
  const fallback = buildFallbackIndustryTermProfile(input);
  try {
    // Reuse the configured discovery provider. A separate editable prompt is
    // unnecessary here because this is an internal structural extraction step.
    const provider = await getProviderForTemplate('find-sources', userId);
    const openai = buildOpenAIClient(provider);
    const response = await openai.chat.completions.create({
      model: provider.modelId,
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content: '你是产业信息画像引擎。只返回 JSON 对象，不要 Markdown。不得编造与输入无关的行业。',
        },
        {
          role: 'user',
          content: JSON.stringify({
            task: '根据产业名称和自然语言关注点生成资讯筛选画像。严格词是产业本体及明确同义名；其余语义槽位分别描述经营主体和场所、产品和工艺、产业链、风险事件、辅助上下文与排除词。',
            coverageRules: [
              'Generate enough aliases to catch different news-writing forms, not only the formal industry name.',
              'Generate industry-specific operating entities and physical places in entityTerms.',
              'Generate products, processes, supply-chain and trade expressions in their own slots.',
              'Generate risk-event expressions, but never use an event word alone as an industry candidate.',
              'Keep broad context words only in industryContextTerms.',
            ],
            input,
            outputSchema: {
              version: 2,
              canonicalIndustry: 'string',
              strictTerms: ['string'],
              entityTerms: ['string'],
              productTerms: ['string'],
              supplyChainTerms: ['string'],
              riskEventTerms: ['string'],
              industryContextTerms: ['string'],
              exclusionTerms: ['string'],
              sourcePreferences: ['authoritative|mainstream|business|industry|developer|research|trend|creator'],
            },
          }),
        },
      ],
    });
    return normalizeIndustryTermProfile(
      parseJsonObject(response.choices[0]?.message.content ?? null),
      input
    );
  } catch (error) {
    console.warn('[industry profile] LLM profile generation fell back to input topic:', error);
    return fallback;
  }
}
