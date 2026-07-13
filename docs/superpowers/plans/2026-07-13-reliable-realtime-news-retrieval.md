# 可靠实时产业新闻检索 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让发现源和脚本采集能读取 GBK 新闻页面、拒绝不合格的国内新闻来源组合，并采到近期鞋业重大事件。

**Architecture:** 新增纯响应解码模块，调研抓取与沙箱 fetch 共用。新增来源组合评估器，将候选数量、国内属性、类别配额和预检索证据变成硬规则；发现源智能体仅在组合通过时返回成功。

**Tech Stack:** TypeScript、Node `TextDecoder`、Next.js、isolated-vm、Node test runner。

## Global Constraints

- HTTP 头部 charset 优先，HTML meta charset 为回退；GBK/GB2312 映射 GB18030。
- 条件包含“国内”时，不接受只有海外或台湾来源的组合。
- 不为“晋江”或某篇文章硬编码 URL；测试用页面夹具仅验证通用 GBK 解码。

---

### Task 1: 共享 HTTP 文本解码

**Files:**
- Create: `src/lib/utils/httpTextDecoder.ts`
- Modify: `src/lib/ai/tools/webFetch.ts`
- Modify: `src/lib/sandbox/runner.ts`
- Test: `tests/httpTextDecoder.test.ts`

**Interfaces:**
- Produces: `decodeHttpText(bytes: Uint8Array, contentType?: string): string`.
- Both server-side research fetch and sandbox `response.text()` consume it.

- [ ] **Step 1: Write failing GBK test**

```ts
test('decodes GBK HTML from meta charset', () => {
  const bytes = new TextEncoder().encode('<meta charset="gbk">');
  const gbkFixture = Buffer.from([0x3c, 0x6d, 0x65, 0x74, 0x61, 0x20, 0x63, 0x68, 0x61, 0x72, 0x73, 0x65, 0x74, 0x3d, 0x22, 0x67, 0x62, 0x6b, 0x22, 0x3e, 0xb9, 0xab, 0xcd, 0xb7]);
  assert.match(decodeHttpText(gbkFixture), /官方/);
});
```

- [ ] **Step 2: Verify red**

Run `node --import tsx --test tests/httpTextDecoder.test.ts`.

Expected: module import failure.

- [ ] **Step 3: Implement decoder**

Implement `detectCharset` from response header then first 8 KB decoded as ASCII-compatible text. Normalize `gbk` and `gb2312` to `gb18030`; on unsupported label use UTF-8. Replace direct UTF-8 `TextDecoder` calls in `webFetch` and sandbox host fetch with this helper.

- [ ] **Step 4: Verify green**

Run `node --import tsx --test tests/httpTextDecoder.test.ts`.

Expected: GBK fixture and UTF-8 fallback tests pass.

### Task 2: 发现源组合硬验收

**Files:**
- Create: `src/lib/ai/agents/sourcePortfolioPolicy.ts`
- Modify: `src/lib/ai/agents/findSourcesAgent.ts`
- Test: `tests/sourcePortfolioPolicy.test.ts`

**Interfaces:**
- Produces: `evaluateSourcePortfolio({ sources, criteria, evidence }): { valid, reasons }`.
- `findSourcesAgent` retries a rejected portfolio once with corrective feedback, otherwise throws a visible discovery error instead of writing a success log.

- [ ] **Step 1: Write failing tests**

```ts
test('rejects a domestic request containing only foreign or Taiwan industry sources', () => {
  const result = evaluateSourcePortfolio({ criteria: '近期国内鞋业相关新闻资讯', sources: [wwd, taiwanFootwear, shoesPortal], evidence: [] });
  assert.equal(result.valid, false);
  assert.match(result.reasons.join(' '), /国内综合或地方新闻源/);
});
```

- [ ] **Step 2: Verify red**

Run `node --import tsx --test tests/sourcePortfolioPolicy.test.ts`.

Expected: module import failure.

- [ ] **Step 3: Implement policy and agent retry**

Require 5–10 sources, at least one `general_news` or `local_news`, one domestic `industry_vertical`, no more than one recommended finance source, and when criteria contains 国内 reject URL/title/description markers for Taiwan and clearly foreign-only sources. Require each recommended source domain to appear in recent preflight evidence. Append a correction user message to the same agent conversation and request a new JSON array once; throw the returned reasons if it remains invalid.

- [ ] **Step 4: Verify green**

Run `node --import tsx --test tests/sourcePortfolioPolicy.test.ts tests/sourceIntentPolicy.test.ts`.

Expected: all portfolio and source-intent tests pass.

### Task 3: 将实际链接证据传入脚本生成

**Files:**
- Modify: `src/lib/ai/agents/generateScriptAgent.ts`
- Modify: `src/lib/ai/agents/validateScriptAgent.ts`
- Test: `tests/generateScriptContract.test.ts`

**Interfaces:**
- The generation prompt requires parsing list links observed through `webFetch`/`webFetchBrowser` and rejects guessed article IDs.
- Validation error after three attempts names the source and requires a retry from the list page.

- [ ] **Step 1: Write failing contract assertion**

```ts
test('generation contract prohibits guessed article IDs', async () => {
  const prompt = buildCollectionScriptContract();
  assert.match(prompt, /禁止猜测文章 ID/);
  assert.match(prompt, /实际返回的列表链接/);
});
```

- [ ] **Step 2: Verify red**

Run `node --import tsx --test tests/generateScriptContract.test.ts`.

Expected: helper export missing.

- [ ] **Step 3: Export and use the contract**

Export `buildCollectionScriptContract()` from `generateScriptAgent.ts`; append it to the provider template. Retain the three-attempt hard stop and include the prior script error in the retry context.

- [ ] **Step 4: Full verification**

Run `npm run build; node --import tsx --test tests/httpTextDecoder.test.ts tests/sourcePortfolioPolicy.test.ts tests/generateScriptContract.test.ts tests/sourceIntentPolicy.test.ts tests/validateScriptContract.test.ts tests/sourceSampleQuality.test.ts; git diff --check`.

Expected: build exit 0 and all named tests pass.
