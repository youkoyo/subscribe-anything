# 预置发现源库与产业创建体验 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 204 个中文 RSS 源沉淀为可匹配、可验证的预置发现源库，接入“预置源优先、AI 兜底”的发现与脚本链路，同时把管理员新增产业配置改成普通人也能完成的渐进式表单。

**Architecture:** 预置源以代码内种子数据作为可版本化事实源，启动迁移后幂等写入 PostgreSQL 目录表；纯函数完成分类、偏好映射和相关性排序，服务层负责读取启用源及在线 RSS 验证。发现阶段先调用目录协调器，覆盖不足才调用原 AI 智能体；命中的标准 RSS 使用确定性通用采集脚本，跳过 LLM 脚本生成。创建页保留现有青蓝深色主题，核心信息常显、结构化条件和报送规则渐进披露，并实时预览目录匹配结果。

**Tech Stack:** Next.js 15 App Router、React 19、TypeScript、Tailwind CSS、Drizzle ORM/PostgreSQL、Node test runner、isolated-vm 采集沙箱。

---

### Task 1: 建立预置源目录领域模型和匹配规则

**Files:**
- Create: `tests/discoverySourceCatalog.test.ts`
- Create: `src/lib/discovery-sources/types.ts`
- Create: `src/lib/discovery-sources/catalog-seeds.ts`
- Create: `src/lib/discovery-sources/catalog.ts`
- Source input: `D:/Downloads/feeds-zh.opml`

- [ ] **Step 1: 写失败测试**

覆盖 204 条源完整导入、URL 去重、九类 OPML 分类、偏好/可信度/用途分类，以及主题和来源偏好对排序结果的影响。

- [ ] **Step 2: 运行测试确认 RED**

Run: `node --import tsx --test tests/discoverySourceCatalog.test.ts`

- [ ] **Step 3: 实现最小目录模型**

定义 `SourcePreference`、`TrustLevel`、`UsageRole`、`CuratedSourceSeed` 和 `CuratedSourceMatch`；把 OPML 中 204 条记录完整固化到 `catalog-seeds.ts`，通过确定性规则补齐偏好、可信度、用途、关键词和稳定 ID。

- [ ] **Step 4: 实现可解释匹配**

实现查询词提取、产业主题到新闻/财经/科技/编程等分类映射、来源偏好映射、评分和命中原因，确保弱相关源不会仅凭“默认偏好”阻止 AI 回退。

- [ ] **Step 5: 运行测试确认 GREEN**

Run: `node --import tsx --test tests/discoverySourceCatalog.test.ts`

### Task 2: 持久化目录并提供管理员匹配预览

**Files:**
- Modify: `src/lib/db/schema.ts`
- Modify: `src/types/db.ts`
- Modify: `src/lib/db/migrate.ts`
- Create: `src/lib/discovery-sources/repository.ts`
- Create: `src/app/api/discovery-sources/match/route.ts`
- Create: `tests/discoverySourceCatalogSource.test.ts`
- Create: `drizzle-pg/0001_*.sql`（由 Drizzle 生成）
- Modify: `drizzle-pg/meta/_journal.json`（由 Drizzle 生成）
- Create: `drizzle-pg/meta/0001_snapshot.json`（由 Drizzle 生成）

- [ ] **Step 1: 写 schema、seed 和 API 契约失败测试**

断言目录表包含启用状态、偏好、可信度、用途、关键词、验证状态字段；启动迁移会幂等 seed；匹配接口要求管理员权限且只返回必要预览字段。

- [ ] **Step 2: 运行测试确认 RED**

Run: `node --import tsx --test tests/discoverySourceCatalogSource.test.ts`

- [ ] **Step 3: 增加 PostgreSQL 表和类型**

新增 `discovery_source_catalog` 表，`feed_url` 唯一；保留运行时启停及最近验证结果，目录条目不与用户订阅源强耦合。

- [ ] **Step 4: 生成迁移并接入幂等 seed**

Run: `npm run db:generate`

在 `runMigrations()` 中加入 `seedDiscoverySourceCatalog()`，使用稳定 ID 与 `onConflictDoNothing()`，避免覆盖管理员后续启停选择。

- [ ] **Step 5: 实现仓储和预览 API**

仓储优先读取数据库启用源，空库时可回退代码种子；API 接受 `topic`、`criteria`、`sourceTypes`，返回匹配分数、原因、偏好、可信度和总数，不进行昂贵在线验证。

- [ ] **Step 6: 运行测试确认 GREEN**

Run: `node --import tsx --test tests/discoverySourceCatalogSource.test.ts tests/postgresMigrationSource.test.ts`

### Task 3: 接入“预置源优先、AI 回退”发现流程

**Files:**
- Create: `tests/discoverySourceDiscovery.test.ts`
- Create: `src/lib/discovery-sources/discovery.ts`
- Modify: `src/types/wizard.ts`
- Modify: `src/lib/managed/pipeline.ts`
- Modify: `src/components/wizard/Step2FindSources.tsx`

- [ ] **Step 1: 写协调器失败测试**

用依赖注入覆盖三条路径：目录覆盖充足时不调用 AI；目录不足时合并 AI 且按 URL 去重；目录验证失败时完整回退 AI。

- [ ] **Step 2: 运行测试确认 RED**

Run: `node --import tsx --test tests/discoverySourceDiscovery.test.ts`

- [ ] **Step 3: 扩展发现源元数据**

在 `FoundSource` 中增加可选的 `discoveryMethod`、`catalogSourceId`、`sourcePreference`、`trustLevel`、`isStandardFeed`、`initialItems`，保持现有向导状态 JSON 向后兼容。

- [ ] **Step 4: 实现在线验证与覆盖判定**

仅验证高分候选，限制并发与候选数；覆盖充足要求至少 3 个有效 RSS、存在可信主源且匹配主要偏好。返回可解释的 `catalog`、`hybrid` 或 `ai` 路径。

- [ ] **Step 5: 替换两处直接 AI 发现调用**

让 `runFindSourcesStep()` 和 `runManagedPipeline()` 共用协调器，日志明确展示“预置库命中/验证/AI 补充”，向导列表标识来源方式。

- [ ] **Step 6: 运行测试确认 GREEN**

Run: `node --import tsx --test tests/discoverySourceDiscovery.test.ts`

### Task 4: 为标准 RSS 使用确定性通用采集脚本

**Files:**
- Create: `tests/standardFeedScript.test.ts`
- Create: `src/lib/discovery-sources/standard-feed-script.ts`
- Modify: `src/lib/managed/pipeline.ts`

- [ ] **Step 1: 写通用脚本失败测试**

覆盖 URL 安全嵌入、RSS 2.0/Atom 解析结构、标准源不调用 `generateScriptAgent`，以及初始验证数据沿用。

- [ ] **Step 2: 运行测试确认 RED**

Run: `node --import tsx --test tests/standardFeedScript.test.ts`

- [ ] **Step 3: 实现本地模板生成器**

生成满足沙箱 `collect()` 契约的无依赖脚本，限制返回条数、清洗 HTML、规范日期，使用 `JSON.stringify()` 安全固化 feed URL。

- [ ] **Step 4: 在手动步骤和托管管道中短路 LLM**

标准 RSS 直接写成功日志和 `GeneratedSource`，保留现有网页源 AI 生成、重试、失败修复流程。

- [ ] **Step 5: 运行测试确认 GREEN**

Run: `node --import tsx --test tests/standardFeedScript.test.ts tests/discoverySourceDiscovery.test.ts`

### Task 5: 重构新增产业配置的 UI 与输入模型

**Files:**
- Create: `tests/industryConfigCreateFormSource.test.ts`
- Modify: `src/components/industry-configs/IndustryConfigCreateForm.tsx`
- Modify: `src/app/industry-configs/new/page.tsx`
- Modify: `src/lib/industry-configs/utils.ts`
- Modify: `src/lib/industry-configs/types.ts`
- Modify: `src/app/globals.css`（仅在 Tailwind 现有工具不足时）

- [ ] **Step 1: 写 UI 和默认推导失败测试**

断言核心区只要求产业名称与自然语言关注说明；来源偏好使用易懂预设；关键词、区域、对象、风险词及发布报送放入可展开高级设置；不展示“每分钟”调试报送；页面包含匹配预览、步骤提示、保存状态和 reduced-motion 兼容。

- [ ] **Step 2: 运行测试确认 RED**

Run: `node --import tsx --test tests/industryConfigCreateFormSource.test.ts tests/industryConfigUtils.test.ts`

- [ ] **Step 3: 实现自然语言优先的数据推导**

结构化字段为空时，从名称、分类、细分和关注说明生成稳定的建议条件；保留高级用户手工覆盖能力和现有 API 字段兼容性。

- [ ] **Step 4: 重排为舒适的双栏工作区**

桌面端左侧主表单、右侧粘性“当前配置/预计来源”摘要；移动端单列。核心区、来源偏好、高级设置形成清晰层级，提交动作固定在内容尾部，不新增配色体系。

- [ ] **Step 5: 加入克制过渡**

使用现有 `tailwindcss-animate` 和 CSS transition 完成卡片进入、展开/收起、选择态、匹配结果刷新；不做无语义的全站滑屏，并在 `prefers-reduced-motion` 下关闭位移动画。

- [ ] **Step 6: 运行测试确认 GREEN**

Run: `node --import tsx --test tests/industryConfigCreateFormSource.test.ts tests/industryConfigUtils.test.ts tests/industryConfigApiSource.test.ts`

### Task 6: 文档、回归与审查

**Files:**
- Modify: `docs/industry-config-rss-catalog-refactor.md`
- Modify: `docs/superpowers/plans/2026-07-14-curated-source-catalog-industry-creation.md`

- [ ] **Step 1: 回写实现状态和运维说明**

补充目录 seed、在线验证、回退阈值、通用脚本、表单默认值、数据库迁移和故障降级说明；勾选已完成清单。

- [ ] **Step 2: 运行聚焦测试**

Run: `node --import tsx --test tests/discoverySourceCatalog.test.ts tests/discoverySourceCatalogSource.test.ts tests/discoverySourceDiscovery.test.ts tests/standardFeedScript.test.ts tests/industryConfigCreateFormSource.test.ts tests/industryConfigUtils.test.ts tests/industryConfigApiSource.test.ts`

- [ ] **Step 3: 运行完整显式测试并区分基线失败**

Run: `node --import tsx --test tests/*.test.ts`

基线为 105 项中 96 通过、9 项失败；不得把既有断言漂移误报为本次回归。

- [ ] **Step 4: 类型和生产构建验证**

Run: `npx tsc --noEmit`

Run: `npm run build`

- [ ] **Step 5: 代码审查**

检查目录匹配误命中、AI 回退条件、数据库 seed 幂等、标准脚本沙箱安全、表单键盘可达性、响应式布局、reduced motion 以及未意外修改用户文件。
