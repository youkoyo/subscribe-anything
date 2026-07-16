# 产业配置编辑表单统一实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新建产业信息页与产业信息池的编辑弹窗使用同一套表单，且编辑不丢失旧配置字段。

**Architecture:** 提取可控的 `IndustryConfigForm` 组件，新建页和编辑弹窗只持有初始值与提交动作。PATCH 只发送共享表单字段；服务层与已存储值合并，保留隐藏的旧字段。

**Tech Stack:** Next.js App Router、React 19、TypeScript、Tailwind CSS、Node.js test runner、Drizzle ORM/PostgreSQL.

---

### Task 1: 保护 PATCH 中未暴露的旧配置

**Files:**
- Modify: `tests/industryConfigApiSource.test.ts`
- Modify: `src/lib/industry-configs/service.ts`

- [ ] **Step 1: 编写失败测试**

在 `tests/industryConfigApiSource.test.ts` 新增以下测试，确认更新服务合并而非覆盖已有值。

```ts
test('industry config updates preserve fields omitted by the unified form', async () => {
  const service = await readFile('src/lib/industry-configs/service.ts', 'utf8');
  assert.match(service, /const mergedInput: IndustryConfigInput = \{/);
  assert.match(service, /keywords: input\.keywords \?\? existing\.snapshot\.keywords/);
  assert.match(service, /riskTerms: input\.riskTerms \?\? existing\.snapshot\.riskTerms/);
  assert.match(service, /deliveryCron: input\.deliveryCron \?\? existing\.deliveryCron/);
  assert.match(service, /\.\.\.mergedInput/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --import tsx --test tests/industryConfigApiSource.test.ts`

Expected: FAIL，`mergedInput` 尚未实现。

- [ ] **Step 3: 实现更新合并**

在 `updateIndustryConfigForAdmin` 中、`generateIndustryTermProfile` 前创建以下值，并使用 `mergedInput` 生成画像与更新数据库。对 `regions`、`entities`、`sourceTypes`、`sourcePreferences`、`alertLevel`、`isEnabled`、`visibility`、`subscriptionMode`、`deliveryTimezone` 和 `maxItemsPerEmail` 使用同一 `??` 后备模式。

```ts
const mergedInput: IndustryConfigInput = {
  ...input,
  keywords: input.keywords ?? existing.snapshot.keywords,
  riskTerms: input.riskTerms ?? existing.snapshot.riskTerms,
  deliveryCron: input.deliveryCron ?? existing.deliveryCron ?? undefined,
};
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --import tsx --test tests/industryConfigApiSource.test.ts`

Expected: PASS.

- [ ] **Step 5: 提交变更**

Run: `git add tests/industryConfigApiSource.test.ts src/lib/industry-configs/service.ts && git commit -m "fix: preserve hidden industry config fields on update"`

### Task 2: 提取新建页共享表单

**Files:**
- Create: `src/components/industry-configs/IndustryConfigForm.tsx`
- Modify: `src/components/industry-configs/IndustryConfigCreateForm.tsx`
- Modify: `tests/industryConfigCreateFormSource.test.ts`

- [ ] **Step 1: 编写失败测试**

在 `tests/industryConfigCreateFormSource.test.ts` 新增测试：

```ts
test('industry config form is shared by creation and editing surfaces', async () => {
  const form = await readFile('src/components/industry-configs/IndustryConfigForm.tsx', 'utf8');
  const create = await readFile('src/components/industry-configs/IndustryConfigCreateForm.tsx', 'utf8');
  assert.match(form, /export interface IndustryConfigFormValues/);
  assert.match(form, /SOURCE_PREFERENCES/);
  assert.match(form, /aria-pressed/);
  assert.match(form, /\u9ad8级资料/);
  assert.match(form, /\u53d1布与投递/);
  assert.match(create, /IndustryConfigForm/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --import tsx --test tests/industryConfigCreateFormSource.test.ts`

Expected: FAIL，共享组件尚不存在。

- [ ] **Step 3: 实现共享组件**

新建 `IndustryConfigForm.tsx`，导出 `IndustryConfigFormValues`、`DEFAULT_INDUSTRY_CONFIG_FORM_VALUES` 和 `IndustryConfigForm`。使用以下可控合约：

```ts
export interface IndustryConfigFormValues {
  name: string;
  description: string;
  sourcePreferences: SourcePreference[];
  category: string;
  subCategory: string;
  subscriptionMode: 'open' | 'approval_required';
  autoProfileExpansion: boolean;
  deliveryEnabled: boolean;
  maxItemsPerEmail: number;
}
```

将现有新建页的名称、关注方向、来源偏好、“高级资料”、“发布与投递”、资源匹配预览、动效与必填校验移入此组件。`IndustryConfigCreateForm` 只保留创建提交和成功后跳转至 `/subscriptions/new?industryConfigId=<id>` 的容器逻辑。

- [ ] **Step 4: 运行测试确认通过**

Run: `node --import tsx --test tests/industryConfigCreateFormSource.test.ts`

Expected: PASS.

- [ ] **Step 5: 提交变更**

Run: `git add tests/industryConfigCreateFormSource.test.ts src/components/industry-configs/IndustryConfigForm.tsx src/components/industry-configs/IndustryConfigCreateForm.tsx && git commit -m "refactor: extract shared industry config form"`

### Task 3: 以共享表单替换编辑弹窗

**Files:**
- Modify: `src/components/industry-configs/IndustryConfigManager.tsx`
- Modify: `tests/industryConfigPageSource.test.ts`

- [ ] **Step 1: 编写失败测试**

在 `tests/industryConfigPageSource.test.ts` 新增测试：

```ts
test('industry pool editor uses the creation form instead of legacy controls', async () => {
  const source = await readFile('src/components/industry-configs/IndustryConfigManager.tsx', 'utf8');
  assert.match(source, /IndustryConfigForm/);
  assert.doesNotMatch(source, /\u4fe1息源类型<\/legend>/);
  assert.doesNotMatch(source, /\u62a5送时区/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --import tsx --test tests/industryConfigPageSource.test.ts`

Expected: FAIL，管理器仍渲染旧的表单控件。

- [ ] **Step 3: 实现编辑容器**

移除 `IndustryConfigManager.tsx` 中的旧 `FormState`、`emptyForm`、`splitList`、`joinList`、`toggleSourceType` 和旧弹窗字段。预填 `config.snapshot.sourcePreferences ?? DEFAULT_INDUSTRY_CONFIG_FORM_VALUES.sourcePreferences`，其余值从 `snapshot`与配置顶层字段读取。使用以下渲染，并保留保存成功后的 `fetchConfigs`、关闭弹窗和 toast。

```tsx
<IndustryConfigForm
  value={form}
  onChange={setForm}
  onSubmit={handleSubmit}
  submitting={submitting}
  submitLabel="保存"
  compact
/>
```

编辑的 PATCH 载荷仅包含 `IndustryConfigFormValues` 定义的字段。

- [ ] **Step 4: 运行测试确认通过**

Run: `node --import tsx --test tests/industryConfigPageSource.test.ts tests/industryConfigApiSource.test.ts`

Expected: PASS.

- [ ] **Step 5: 提交变更**

Run: `git add tests/industryConfigPageSource.test.ts src/components/industry-configs/IndustryConfigManager.tsx && git commit -m "feat: unify industry config editor with creation form"`

### Task 4: 验证

**Files:**
- Modify: `docs/superpowers/specs/2026-07-15-industry-config-edit-form-unification-design.md` (只记录实际结果)

- [ ] **Step 1: 运行聚焦测试**

Run: `node --import tsx --test tests/industryConfigCreateFormSource.test.ts tests/industryConfigPageSource.test.ts tests/industryConfigApiSource.test.ts tests/industryConfigUtils.test.ts`

Expected: PASS.

- [ ] **Step 2: 运行类型和生产构建验证**

Run: `npx tsc --noEmit`

Expected: 无 TypeScript 错误。

Run: `npm run build`

Expected: Next.js 与服务端 TypeScript 构建成功。

- [ ] **Step 3: 手动验证**

以管理员身份在产业信息池打开“编辑”，确认字段顺序与 `/industry-configs/new` 一致；修改名称或关注方向并保存，刷新后确认可见字段已更新且旧配置的关键词等隐藏字段仍保留。

- [ ] **Step 4: 提交验证记录**

Run: `git add docs/superpowers/specs/2026-07-15-industry-config-edit-form-unification-design.md && git commit -m "docs: record industry config form verification"`
