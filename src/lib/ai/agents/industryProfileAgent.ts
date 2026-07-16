import { buildOpenAIClient, getProviderForTemplate } from '@/lib/ai/client';
import {
  buildFallbackIndustryTermProfile,
  normalizeIndustryTermProfile,
  profileCoverageGaps,
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

const PROFILE_ARRAY_FIELDS = [
  'strictTerms',
  'entityTerms',
  'operatingContextTerms',
  'productTerms',
  'supplyChainTerms',
  'riskEventTerms',
  'industryContextTerms',
  'exclusionTerms',
  'sourcePreferences',
] as const;

function mergeProfileCandidates(
  primary: Record<string, unknown> | null,
  repair: Record<string, unknown> | null
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...primary, ...repair };
  for (const field of PROFILE_ARRAY_FIELDS) {
    const first = Array.isArray(primary?.[field]) ? primary[field] : [];
    const second = Array.isArray(repair?.[field]) ? repair[field] : [];
    merged[field] = [...first, ...second];
  }
  return merged;
}

function buildProfilePrompt(input: IndustryProfileInput) {
  return {
    task: '根据产业名称和自然语言关注点生成资讯筛选画像。严格词是产业本体及明确同义名；其余语义槽位分别描述经营主体和场所、产品和工艺、产业链、风险事件、辅助上下文与排除词。',
    coverageRequirements: {
      strictTerms: '至少 2 个：行业本体和常见写法/别称。',
      entityTerms: '至少 4 个：该行业特有的企业、生产经营主体、机构或场所等实际新闻写法。',
      operatingContextTerms: '至少 4 个：能够在不出现行业正式名称时仍指向该行业的“主体/场所/业务动作”组合表达。必须因行业而异，不能只写泛化动作词。',
      productTerms: '至少 3 个：该行业的产品、服务、材料、工艺或技术。',
      supplyChainTerms: '至少 3 个：生产、产能、订单、采购、渠道、进出口、融资等与该行业匹配的链路表达。',
      riskEventTerms: '至少 3 个：该行业可能出现的安全、合规、质量、贸易、经营等事件表达；事件词不能单独作为候选命中依据。',
    },
    coverageRules: [
      'Generate enough aliases to catch different news-writing forms, not only the formal industry name.',
      'Every term must be specific to the input industry. Do not fill slots with generic words that would match every industry.',
      'Generate industry-specific operating entities and physical places in entityTerms.',
      'For industries with physical operations, include industry-qualified entity/place terms that could 独立出现于地方新闻标题；不应以城市、公司或事件限定词代替这类通用实体或场所写法。',
      'Use operatingContextTerms for industry-qualified combinations such as a role plus its real business place or process. Adapt the combination to the industry rather than assuming a manufacturing context.',
      'Generate products, processes, supply-chain and trade expressions in their own slots.',
      'Keep broad context words only in industryContextTerms.',
    ],
    input,
    outputSchema: {
      version: 2,
      canonicalIndustry: 'string',
      strictTerms: ['string'],
      entityTerms: ['string'],
      operatingContextTerms: ['string'],
      productTerms: ['string'],
      supplyChainTerms: ['string'],
      riskEventTerms: ['string'],
      industryContextTerms: ['string'],
      exclusionTerms: ['string'],
      sourcePreferences: ['authoritative|mainstream|business|industry|developer|research|trend|creator'],
    },
  };
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
          content: JSON.stringify(buildProfilePrompt(input)),
        },
      ],
    });
    const primary = parseJsonObject(response.choices[0]?.message.content ?? null);
    let candidate = primary;
    let profile = normalizeIndustryTermProfile(candidate, input);
    const reviewPrompt = {
      task: '独立审查以下产业画像是否足以筛出真实产业新闻。只输出 JSON 对象。',
      reviewQuestions: [
        '若一篇报道只提到该产业的主体、实际经营场所或业务动作，而不写行业正式名称，现有画像能否把它送入候选池？不能则补充 operatingContextTerms 与 entityTerms。',
        '对于存在实体经营场所的产业，画像是否包含可独立出现于地方新闻标题的行业限定主体或场所词？不应以城市、公司或事件限定词代替；缺少时补充 entityTerms。',
        '每个候选词是否确实属于输入产业，而非会命中大多数行业的泛化词？泛化词不要放入补丁。',
        '产品、供应链、风险场景是否覆盖了该产业真实的新闻写法，而不是只罗列行业定义？',
      ],
      originalInput: input,
      currentProfile: profile,
      outputSchema: {
        approved: true,
        issues: ['string'],
        patch: {
          strictTerms: ['string'],
          entityTerms: ['string'],
          operatingContextTerms: ['string'],
          productTerms: ['string'],
          supplyChainTerms: ['string'],
          riskEventTerms: ['string'],
        },
      },
    };
    try {
      const review = await openai.chat.completions.create({
        model: provider.modelId,
        temperature: 0,
        messages: [
          { role: 'system', content: '你是产业画像独立质检器。只返回 JSON 对象，不得编造与输入无关的产业术语。' },
          { role: 'user', content: JSON.stringify(reviewPrompt) },
        ],
      });
      const reviewResult = parseJsonObject(review.choices[0]?.message.content ?? null);
      const patch = reviewResult?.patch;
      candidate = mergeProfileCandidates(candidate, patch && typeof patch === 'object' && !Array.isArray(patch)
          ? patch as Record<string, unknown>
          : null);
      profile = normalizeIndustryTermProfile(candidate, input);
    } catch (reviewError) {
      console.warn('[industry profile] independent review failed; using the primary profile:', reviewError);
    }
    const missing = profileCoverageGaps(profile);
    if (missing.length === 0) return profile;

    const repairPrompt = {
      task: '补全产业画像中缺失的语义槽位。只输出 JSON 对象；不得用泛化词凑数，也不得改换输入行业。',
      missingSlots: missing,
      originalInput: input,
      currentProfile: profile,
      requirements: buildProfilePrompt(input).coverageRequirements,
    };
    try {
      const repaired = await openai.chat.completions.create({
        model: provider.modelId,
        temperature: 0.15,
        messages: [
          { role: 'system', content: '你是产业信息画像质检器。只返回 JSON 对象。' },
          { role: 'user', content: JSON.stringify(repairPrompt) },
        ],
      });
      candidate = mergeProfileCandidates(candidate, parseJsonObject(repaired.choices[0]?.message.content ?? null));
      profile = normalizeIndustryTermProfile(candidate, input);
    } catch (repairError) {
      console.warn('[industry profile] coverage repair failed; keeping the first profile:', repairError);
    }
    return profile;
  } catch (error) {
    console.warn('[industry profile] LLM profile generation fell back to input topic:', error);
    return fallback;
  }
}
