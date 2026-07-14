# 通用产业画像与预置 RSS 全量分类 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让预置 RSS 对当前完整响应逐条执行通用产业画像候选筛选和 AI 相关性判定，不保留行业特例或旧画像兼容逻辑。

**Architecture:** 将画像扩展为版本 2 的语义槽位；候选筛选、AI 分类和信息池接纳收敛为一个宿主侧模块。首次发现和常驻调度都调用该模块；sandbox 脚本只解析 RSS/Atom 的所有条目。预置源有至少一条强相关或有关内容时不回退到旧 AI 找源。

**Tech Stack:** Next.js 15、TypeScript、Drizzle ORM/PostgreSQL、isolated-vm、OpenAI-compatible client、Node test runner with tsx.

---

## File structure

- Modify: `src/lib/industry-configs/term-profile.ts` — 定义画像 v2 槽位、候选词集合和纯规则回退。
- Modify: `src/lib/ai/agents/industryProfileAgent.ts` — 要求模型按 v2 槽位输出通用画像。
- Create: `src/lib/industry-configs/profile-classifier.ts` — 统一候选筛选、批量 AI 判定和条目转换。
- Modify: `src/lib/ai/agents/relevanceAgent.ts` — 使用 v2 槽位提供 AI 判定上下文。
- Modify: `src/lib/ai/tools/rssFetch.ts` — 支持预置发现源解析完整 RSS/Atom 文档。
- Modify: `src/lib/discovery-sources/discovery.ts` — 首次发现调用统一分类器，不在本文件保留候选/批处理逻辑。
- Modify: `src/lib/discovery-sources/standard-feed-script.ts` — 仅完整解析条目，不在 sandbox 内判相关性或截断条目。
- Modify: `src/lib/managed/pipeline.ts` — 使用当前 v2 画像；移除旧画像归一化/补词兼容。
- Modify: `src/lib/scheduler/collector.ts` — 预置 RSS 常驻采集在写卡前调用统一分类器。
- Modify: `src/lib/sandbox/contract.ts` — 将 sandbox 返回项标记为原始候选，不再允许其声明预置源相关性。
- Modify: `tests/industryTermProfile.test.ts`、`tests/discoverySourcePipelineSource.test.ts`。
- Create: `tests/profileClassifier.test.ts`、`tests/standardFeedScript.test.ts`。

## Task 1: 建立画像 v2 纯数据模型

**Files:**
- Modify: `src/lib/industry-configs/term-profile.ts`
- Test: `tests/industryTermProfile.test.ts`

- [ ] **Step 1: 写失败测试，定义非行业特例的 v2 画像接口**

```ts
test('v2 profile exposes semantic candidate slots without industry-specific expansion', () => {
  const profile = normalizeIndustryTermProfile({
    version: 2,
    canonicalIndustry: '任意产业',
    strictTerms: ['任意产业'],
    entityTerms: ['该产业主体'],
    productTerms: ['该产业产品'],
    supplyChainTerms: ['该产业供应链'],
    riskEventTerms: ['火灾'],
    industryContextTerms: ['制造业'],
    exclusionTerms: [],
  }, { topic: '任意产业' });

  assert.equal(profile.version, 2);
  assert.deepEqual(profileCandidateTerms(profile), ['任意产业', '该产业主体', '该产业产品', '该产业供应链']);
  assert.equal(profileCandidateTerms(profile).includes('火灾'), false);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --import tsx --test tests/industryTermProfile.test.ts`

Expected: FAIL，因为 `version`、各语义槽位或 `profileCandidateTerms` 尚不存在。

- [ ] **Step 3: 实现 v2 类型与无特例归一化**

```ts
export interface IndustryTermProfile {
  version: 2;
  canonicalIndustry: string;
  strictTerms: string[];
  entityTerms: string[];
  productTerms: string[];
  supplyChainTerms: string[];
  riskEventTerms: string[];
  industryContextTerms: string[];
  exclusionTerms: string[];
  sourcePreferences: SourcePreference[];
}

export function profileCandidateTerms(profile: IndustryTermProfile): string[] {
  return uniqueTerms([
    ...profile.strictTerms,
    ...profile.entityTerms,
    ...profile.productTerms,
    ...profile.supplyChainTerms,
  ], 96);
}
```

删除 `deriveProductionEntityTerms` 及所有“鞋业/鞋厂”示例或代码规则。`buildFallbackIndustryTermProfile` 只返回主题本体作为严格词，其他槽位为空。

- [ ] **Step 4: 运行测试确认通过**

Run: `node --import tsx --test tests/industryTermProfile.test.ts`

Expected: PASS。

## Task 2: 令 AI 按通用语义槽位生成画像

**Files:**
- Modify: `src/lib/ai/agents/industryProfileAgent.ts`
- Test: `tests/industryTermProfile.test.ts`

- [ ] **Step 1: 写失败测试，锁定提示词约束**

```ts
test('profile agent requests every v2 semantic slot and forbids industry examples', async () => {
  const agent = await readFile('src/lib/ai/agents/industryProfileAgent.ts', 'utf8');
  for (const field of ['entityTerms', 'productTerms', 'supplyChainTerms', 'riskEventTerms']) {
    assert.match(agent, new RegExp(field));
  }
  assert.doesNotMatch(agent, /鞋业|鞋厂|芯片|餐饮/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --import tsx --test tests/industryTermProfile.test.ts`

Expected: FAIL，因为现有提示词包含行业示例且没有全部 v2 字段。

- [ ] **Step 3: 修改模型输出契约**

在 `outputSchema` 增加所有 v2 槽位，并在任务说明中要求模型：

```ts
coverageRules: [
  'Generate industry-specific operating entities and physical places.',
  'Generate products, processes, supply-chain and trade expressions.',
  'Generate risk-event expressions, but never use an event word alone as an industry candidate.',
  'Keep broad context words only in industryContextTerms.',
]
```

不要在提示词中举具体行业名称；输出经 `normalizeIndustryTermProfile` 验证。

- [ ] **Step 4: 运行测试确认通过**

Run: `node --import tsx --test tests/industryTermProfile.test.ts`

Expected: PASS。

## Task 3: 提取统一候选筛选与 AI 分类器

**Files:**
- Create: `src/lib/industry-configs/profile-classifier.ts`
- Modify: `src/lib/ai/agents/relevanceAgent.ts`
- Test: `tests/profileClassifier.test.ts`

- [ ] **Step 1: 写失败测试，验证风险词不会单独成为候选**

```ts
test('only semantic candidate slots reach AI classification', async () => {
  const profile = makeProfile({
    strictTerms: ['产业甲'], entityTerms: ['产业甲工厂'],
    productTerms: ['甲产品'], supplyChainTerms: [], riskEventTerms: ['火灾'],
  });
  const candidates = selectProfileCandidates(profile, [
    { id: 'a', title: '某地火灾通报' },
    { id: 'b', title: '产业甲工厂火灾通报' },
  ]);
  assert.deepEqual(candidates.map((item) => item.id), ['b']);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --import tsx --test tests/profileClassifier.test.ts`

Expected: FAIL，因为分类模块不存在。

- [ ] **Step 3: 实现可复用分类器**

导出下列接口：

```ts
export function selectProfileCandidates<T extends { id: string; title: string; summary?: string | null }>(
  profile: IndustryTermProfile,
  items: T[],
): T[];

export async function classifyProfileItems<T extends { id: string; title: string; summary?: string | null }>(
  profile: IndustryTermProfile,
  items: T[],
  userId?: string | null,
): Promise<Map<string, ProfileRelevance>>;
```

`selectProfileCandidates` 只检查 `profileCandidateTerms(profile)`；`classifyProfileItems` 以 24 条为一批调用 `classifyCandidatesWithAI`。AI 异常时，`classifyProfileRelevance` 仅将严格词判为 `strong`，其他候选判为 `irrelevant`。更新 `relevanceAgent` 的提示词，传递 v2 槽位和风险词，要求逐条输出 JSON，且不得跨源合并。

- [ ] **Step 4: 补充 AI 不可用时的严格词回退测试并运行**

```ts
test('deterministic relevance keeps only strict matches when AI is unavailable', () => {
  const profile = makeProfile({
    strictTerms: ['产业甲'], entityTerms: ['产业甲工厂'],
  });
  assert.equal(classifyProfileRelevance(profile, { title: '产业甲政策发布' }).label, 'strong');
  assert.equal(classifyProfileRelevance(profile, { title: '产业甲工厂火灾' }).label, 'irrelevant');
});
```

Run: `node --import tsx --test tests/profileClassifier.test.ts`

Expected: PASS。

## Task 4: 让首次发现解析完整 RSS 响应并复用分类器

**Files:**
- Modify: `src/lib/ai/tools/rssFetch.ts`
- Modify: `src/lib/discovery-sources/discovery.ts`
- Test: `tests/discoverySourcePipelineSource.test.ts`

- [ ] **Step 1: 写失败测试，定义完整响应模式**

```ts
assert.match(discovery, /rssFetch\(match\.source\.feedUrl, \{ maxItems: 'all' \}\)/);
assert.doesNotMatch(discovery, /hasProfileCandidateTerm|classifyCandidatesWithAI/);
assert.match(rssFetch, /maxItems === 'all'/);
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --import tsx --test tests/discoverySourcePipelineSource.test.ts`

Expected: FAIL，因为发现阶段仍有 100 条上限和重复分类逻辑。

- [ ] **Step 3: 实现完整响应解析与首次发现适配**

```ts
export type RssFetchOptions = { maxItems?: number | 'all' };
const itemLimit = options.maxItems === 'all' ? Number.POSITIVE_INFINITY : options.maxItems ?? 10;
```

将 `parseRss`、`parseAtom` 的切片改为使用 `itemLimit`。`discoverFromCuratedCatalog` 调用 `rssFetch(feedUrl, { maxItems: 'all' })`，将有效源全部条目交给 `classifyProfileItems`，仅把 `strong` 与 `related` 转为 `initialItems`。保留每个来源独立的条目列表和原 URL。

- [ ] **Step 4: 运行测试确认通过**

Run: `node --import tsx --test tests/discoverySourcePipelineSource.test.ts tests/profileClassifier.test.ts`

Expected: PASS。

## Task 5: 让常驻预置源返回全量原始项并在宿主侧分类

**Files:**
- Modify: `src/lib/discovery-sources/standard-feed-script.ts`
- Modify: `src/lib/sandbox/contract.ts`
- Modify: `src/lib/scheduler/collector.ts`
- Test: `tests/standardFeedScript.test.ts`
- Test: `tests/profileClassifier.test.ts`

- [ ] **Step 1: 写失败测试，确认 sandbox 不再裁剪或自行判相关**

```ts
test('preset feed script returns every parsable entry without relevance filtering', async () => {
  const script = buildStandardFeedScript('https://example.test/feed', makeProfile());
  assert.doesNotMatch(script, /slice\(0, \d+\)/);
  assert.doesNotMatch(script, /relevanceLabel|STRICT|RELATED|CONTEXT/);
  assert.match(script, /return blocks\.map/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --import tsx --test tests/standardFeedScript.test.ts`

Expected: FAIL，因为当前脚本仍含关键词数组、相关性标签和截断。

- [ ] **Step 3: 令标准脚本只解析完整原始条目**

删除 `profile` 参数及所有 `STRICT`、`RELATED`、`CONTEXT`、`relevanceLabel` 代码。保留 XML 清洗、RSS/Atom 链接与日期解析；使用 `blocks.map(...)`，返回完整的 `CollectedItem[]`。

- [ ] **Step 4: 在 collector 中接入宿主分类**

在 `src/lib/scheduler/collector.ts` 的 `runScript` 成功后：

```ts
const rawItems = runResult.items ?? [];
const items = source.collectionStrategy === 'generic_rss'
  ? await classifyPresetSourceItems(subscription, rawItems)
  : rawItems;
```

`classifyPresetSourceItems` 从 `subscription.industryConfigSnapshot` 读取 v2 画像；若快照不存在或不是 v2，返回空数组而不是写入未经判定的内容。它调用 `classifyProfileItems`，仅返回强相关/有关条目，并附带 `relevanceLabel`、`relevanceReason`、`matchedTerms`。非预置 AI 脚本保持既有标准。

- [ ] **Step 5: 更新 sandbox 契约并运行测试**

从 `CollectedItem` 删除“由预置脚本设置相关性”的注释，保留可选相关性字段供宿主写回卡片。运行：

`node --import tsx --test tests/standardFeedScript.test.ts tests/profileClassifier.test.ts`

Expected: PASS。

## Task 6: 清理管线中的旧画像兼容与临时补丁

**Files:**
- Modify: `src/lib/managed/pipeline.ts`
- Modify: `src/lib/subscriptionCreator.ts`
- Modify: `tests/discoverySourcePipelineSource.test.ts`

- [ ] **Step 1: 写失败测试，声明新链路不含旧画像补词**

```ts
assert.doesNotMatch(pipeline, /normalizeIndustryTermProfile\(input\.snapshot\?\.termProfile/);
assert.doesNotMatch(termProfile, /deriveProductionEntityTerms/);
assert.match(pipeline, /profile\.version === 2/);
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --import tsx --test tests/discoverySourcePipelineSource.test.ts`

Expected: FAIL，因为当前管线仍有旧画像归一化和临时补词。

- [ ] **Step 3: 实现无兼容的 v2 管线**

`discoverSourcesWithFallback` 只接受 `snapshot.termProfile?.version === 2`，否则调用 `generateIndustryTermProfile` 生成新的 v2 画像。生成的预置源脚本改为 `buildStandardFeedScript(source.url)`，不传画像。`createSourcesForSubscription` 继续按 `(sourceId, contentHash)` 写卡，确保跨源不合并。

- [ ] **Step 4: 运行全部聚焦测试**

Run: `node --import tsx --test tests/industryTermProfile.test.ts tests/profileClassifier.test.ts tests/discoverySourcePipelineSource.test.ts tests/standardFeedScript.test.ts`

Expected: PASS，且不启动服务。

## Task 7: 类型检查与交付验证

**Files:**
- Verify only: the files above

- [ ] **Step 1: 运行 TypeScript 类型检查**

Run: `npx tsc --noEmit`

Expected: exit code 0。

- [ ] **Step 2: 运行完整测试集**

Run: `node --import tsx --test tests/*.test.ts`

Expected: 新增测试全部通过；如果仓库既有静态断言失败，记录其文件和失败原因，不把它归因于本变更。

- [ ] **Step 3: 不启动服务地核对变更范围**

Run: `git diff --check; git status --short`

Expected: 没有空白错误；无临时调试脚本；没有启动 `npm run dev` 或 `npm run start`。
