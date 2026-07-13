# 实时产业资讯选源意图 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让鞋业等产业订阅优先发现时事、地方和行业垂直来源，财经来源只作为受限补充。

**Architecture:** 在发现源智能体输出之后加入纯函数的来源分类与排序策略。它为每个来源赋予 `sourceType`，控制财经来源数量，并要求推荐结果覆盖综合或地方新闻和行业垂直两类。页面显示来源类型；脚本样本质量门继续作为最终准入。

**Tech Stack:** TypeScript、Next.js、Node test runner、现有 OpenAI-compatible agent loop。

## Global Constraints

- 不把具体新闻事件或“晋江”写死为规则。
- 财经来源最多一个，且不能因权威性自动推荐。
- 推荐来源必须仍通过近 14 天、订阅条件匹配的样本校验。

---

### Task 1: 来源分类与组合策略

**Files:**
- Create: `src/lib/ai/agents/sourceIntentPolicy.ts`
- Create: `tests/sourceIntentPolicy.test.ts`

**Interfaces:**
- Produces: `SourceType = 'general_news' | 'local_news' | 'industry_vertical' | 'finance' | 'other'`.
- Produces: `classifySource(source): SourceType` and `applySourceIntentPolicy(sources): sources`.

- [ ] **Step 1: Write failing tests**

```ts
test('demotes extra finance feeds and preserves preferred source types', () => {
  const result = applySourceIntentPolicy([finance('人民网财经'), finance('中新网财经'), local('晋江政府新闻'), vertical('鞋业头条'), general('人民网社会')]);
  assert.equal(result.filter((s) => s.sourceType === 'finance' && s.recommended).length, 1);
  assert.ok(result.some((s) => s.sourceType === 'local_news' && s.recommended));
  assert.ok(result.some((s) => s.sourceType === 'industry_vertical' && s.recommended));
});
```

- [ ] **Step 2: Verify red**

Run `node --import tsx --test tests/sourceIntentPolicy.test.ts`.

Expected: import failure because `sourceIntentPolicy` does not exist.

- [ ] **Step 3: Implement the policy**

```ts
export function applySourceIntentPolicy(sources: IntentSource[]) {
  const typed = sources.map((source) => ({ ...source, sourceType: source.sourceType ?? classifySource(source) }));
  let financeRecommended = 0;
  return typed.sort((a, b) => priorityOf(a.sourceType!) - priorityOf(b.sourceType!)).map((source) => {
    if (source.sourceType !== 'finance') return source;
    financeRecommended += 1;
    return financeRecommended === 1 ? source : { ...source, recommended: false };
  });
}
```

Classify title and description terms: 社会、综合、突发为 `general_news`; 政府、地方媒体为 `local_news`; 鞋业、制鞋、皮革和垂直行业媒体为 `industry_vertical`; 财经、证券、金融和上市公司为 `finance`.

- [ ] **Step 4: Verify green**

Run `node --import tsx --test tests/sourceIntentPolicy.test.ts`.

Expected: two passing tests.

- [ ] **Step 5: Commit**

Run `git add tests/sourceIntentPolicy.test.ts src/lib/ai/agents/sourceIntentPolicy.ts` then `git commit -m "feat: classify realtime source intent"`.

### Task 2: 将策略接入发现源智能体

**Files:**
- Modify: `src/lib/ai/agents/findSourcesAgent.ts`
- Modify: `tests/sourceIntentPolicy.test.ts`

**Interfaces:**
- Consumes: `applySourceIntentPolicy` from Task 1.
- Produces: every emitted `FoundSource` has `sourceType`; final results are policy-sorted before UI and pipeline persistence.

- [ ] **Step 1: Add an integration assertion**

```ts
test('source intent policy preserves sourceType for UI labels', () => {
  const [source] = applySourceIntentPolicy([vertical('鞋业头条')]);
  assert.equal(source.sourceType, 'industry_vertical');
});
```

- [ ] **Step 2: Extend the agent output and prompt**

1. Extend `FoundSource` with `sourceType?: SourceType`.
2. Require `sourceType` in the runtime JSON output: `general_news`、`local_news`、`industry_vertical`、`finance`、`other`.
3. Use the preflight query `${subject} 突发事件 事故 火灾 政策 企业动态`; this is an event-class query, not an event-specific rule.
4. Preserve model-supplied `sourceType` in `normalizeSource` and call `applySourceIntentPolicy` immediately before the `sources` SSE emission and function return.
5. Prompt for at least one general/local source and one industry vertical source when those candidates exist; finance maximum one.

- [ ] **Step 3: Verify tests**

Run `node --import tsx --test tests/sourceIntentPolicy.test.ts tests/sourceSampleQuality.test.ts`.

Expected: all tests pass.

- [ ] **Step 4: Commit**

Run `git add src/lib/ai/agents/findSourcesAgent.ts tests/sourceIntentPolicy.test.ts` then `git commit -m "feat: prioritize realtime source intent"`.

### Task 3: 在发现源页面解释来源类别

**Files:**
- Modify: `src/components/wizard/Step2FindSources.tsx`
- Test: `tests/sourceIntentPolicy.test.ts`

**Interfaces:**
- Consumes: `FoundSource.sourceType` from Task 2.
- Produces: per-source visual label using `实时综合新闻`、`地方动态`、`行业垂直`、`财经补充`、`其他来源`.

- [ ] **Step 1: Add the UI label map**

```ts
const sourceTypeLabel = {
  general_news: '实时综合新闻', local_news: '地方动态', industry_vertical: '行业垂直', finance: '财经补充', other: '其他来源',
} as const;
```

Render this badge beside the existing recommendation badge; do not change checkbox selection behavior.

- [ ] **Step 2: Verify the full change**

Run `npm run build; node --import tsx --test tests/sourceIntentPolicy.test.ts tests/sourceSampleQuality.test.ts tests/enterpriseCriteriaMatcher.test.ts tests/enterpriseDeliveryScoring.test.ts tests/enterpriseProfileMatcher.test.ts tests/enterpriseEmailTemplate.test.ts tests/enterpriseDeliverySource.test.ts; git diff --check`.

Expected: build exit 0, all named tests pass, and no whitespace errors.

- [ ] **Step 3: Commit**

Run `git add src/components/wizard/Step2FindSources.tsx tests/sourceIntentPolicy.test.ts` then `git commit -m "feat: show source intent in discovery"`.
