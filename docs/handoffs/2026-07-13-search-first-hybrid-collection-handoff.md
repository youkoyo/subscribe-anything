# 搜索优先混合采集重构：AI 续接文档

更新时间：2026-07-13（Asia/Shanghai，下班交接）

## 接手时先做什么

1. 阅读本文件，以及：
   - `docs/superpowers/specs/2026-07-13-search-first-hybrid-collection-design.md`
   - `docs/superpowers/plans/2026-07-13-search-first-hybrid-collection.md`
   - `.superpowers/sdd/progress.md`
   - `.superpowers/sdd/task-1-report.md` 至 `.superpowers/sdd/task-7-report.md`
2. 运行 `git status --short` 和 `git log -10 --oneline`，确认仍在分支 `改动生成脚本阶段代码前的分支`。
3. 不要从 Task 1 重做。Task 1–7 已完成并通过审查；从本文件的“Task 8 当前状态”继续。
4. 严格按实施计划连续完成 Task 8、Task 9、Task 10，使用显式测试命令，并在最终结论前重新执行完整验证。

## 用户最终目标与不可破坏的约束

重构“发现源”和“生成脚本”流程，使系统真正能发现、采集并推送符合用户条件的近期产业新闻。

典型验收案例：用户订阅“国内鞋业相关新闻”时，系统应发现主流媒体近期发布的鞋厂火灾报道；不得把 2023/2025 年旧闻、商品页、关于我们页、搜索页或缺少真实发布时间的内容当成新新闻。

- 产品界面仍是一条构建流程；后台内部按 `search`、`rss`、`json`、`feed_script` 分流。
- 搜索命中的文章直接进入严格验证，不把媒体首页或动态搜索页强行改造成脚本源。
- 只有现场验证能产生近期匹配样本的 RSS、JSON/API 或静态列表，才允许成为稳定源。
- 默认时间窗口是 14 天；用户明确配置时可以覆盖。
- 缺少可信 `publishedAt` 必须拒绝，禁止使用采集时间或入库时间代替。
- 管理员来源偏好只影响检索优先级，不是硬白名单；不得擅自加入福建、泉州、晋江等地域默认条件。
- `search` 采集器零匹配是健康空结果，不是“脚本损坏”。
- LLM 失败或余额不足不能阻断 `search`、`rss`、`json` 内置采集路径。

## 当前 Git 和工作区状态

- 当前分支：`改动生成脚本阶段代码前的分支`
- 本交接文档提交前的 Task 8 实现 HEAD：`8a89687 fix: isolate hybrid generation attempts`
- Task 8 已提交的四个实现 commit：
  - `3c45ecb feat: skip scripts for built-in collectors`
  - `bcb5cac fix: validate persisted collector configs`
  - `c253056 fix: preserve built-in collectors through completion`
  - `8a89687 fix: isolate hybrid generation attempts`
- 当前有一个未提交实现改动：`src/lib/managed/pipeline.ts` 删除了未使用的 `GenerationSuccessPayload` import。不要丢弃；下一步修复仍会编辑此文件。
- 原本存在的未跟踪文件：`docs/superpowers/plans/2026-07-13-local-development-setup.md`。它不属于本重构，不要编辑、删除或 stage。
- 禁止 `git reset --hard`，禁止 checkout/restore 整个工作树。每次只 stage 明确属于当前任务的文件。

## 已完成进度

- Task 1：完成，commit 范围 `412c36c..768c8ab`，审查 clean。
- Task 2：完成，commit 范围 `d13dbd1..228c357`，审查 clean。
- Task 3：完成，commit 范围 `211d87b..a1b7e94`，审查 clean。
- Task 4：完成，commit 范围 `819191e..62a122e`，审查 clean，本地 PostgreSQL migration 已应用。
- Task 5：完成，commit 范围 `1879ae4..c4a2f88`，审查 clean，82 个 focused tests 通过。
- Task 6：完成，commit 范围 `0bd1bc5..7288005`，审查 clean，113 个 focused tests 和 production build 通过。
- Task 7：完成，commit 范围 `0c88fae..3653423`，审查 clean，157 个 focused tests 和 production build 通过。
- Task 8：核心实现已完成，但尚未正式收尾、写 task report 或标记 complete。
- Task 9、Task 10：尚未开始。

## Task 8 当前已实现内容

主要文件：

- `src/lib/collection/hybridGeneration.ts`（新增）
- `tests/hybridGenerationPipeline.test.ts`（新增）
- `src/app/api/wizard/generate-scripts/route.ts`
- `src/app/api/subscriptions/[id]/retry-source/route.ts`
- `src/lib/managed/pipeline.ts`
- `src/lib/subscriptionCreator.ts`
- `src/components/wizard/Step3ScriptGen.tsx`
- `src/components/wizard/Step4Confirm.tsx`
- `src/types/wizard.ts`
- `tests/articleIngest.test.ts`

已经实现的语义：

- 只有 `feed_script` 调用 `generateScriptAgent`；`search`、`rss`、`json` 直接生成成功的 `GeneratedSource`，脚本为空字符串。
- 内置采集器成功日志保存 collector mode、配置、版本和已验证样本，且不写 `payload.script`。
- search 配置使用运行时 schema 校验，JSON 配置同样经过 schema 校验；未知 mode fail closed。
- 历史成功恢复和结果复用已经 mode-aware：`feed_script` 必须有脚本，内置采集器不要求脚本但要求有效样本。
- 当前 canonical source 配置优先于旧日志配置，避免旧日志覆盖新的采集方案。
- 手动向导和 managed Phase 2 都使用共享混合生成逻辑。
- managed Phase 2 会在所有来源完成后一次性保存排序后的完整 wizard snapshot，避免并发 read-modify-write 丢结果。
- 单个 feed 生成失败不会擦除已经成功的 search collector。
- canonical 内置采集器禁止走脚本重试；search URL 和未知非 HTTP URL 默认拒绝重试。
- retry lock 已移动到任何 `await` 之前，避免两个并发请求同时开始同一来源生成。
- Step 3 能识别无脚本的内置采集器成功结果；Step 4 会继续传递 mode、search plan、collector config 和 discovery version。
- `subscriptionCreator` 能持久化 collector type/config，旧来源缺少 mode 时仍兼容为 `feed_script`。

## Task 8 尚未完成：先修这个并发日志边界

当前最后一个已确认问题是 managed Phase 2 的 observer/waiting 日志存在 TOCTOU：

1. managed 流程发现 `sourceAbortControllers.has(sourceKey)`，准备等待已有手动任务；
2. 手动任务可能在 `has()` 之后先写入 success；
3. managed 流程随后再写一条“等待已有任务完成”的 info 日志；
4. `latestGenerationLogForSource` 把这条更晚的 info 当作新 attempt 边界，永久遮住刚写入的 success，最后等待超时。

按以下最小方案先 RED、再 GREEN：

1. 在 `tests/hybridGenerationPipeline.test.ts` 增加测试：当最新 observer info 的 payload 含 `attemptBoundary: false` 时，`latestGenerationLogForSource` 应跳过它并返回后面的 success。
2. 在 `src/lib/collection/hybridGeneration.ts` 的日志 payload 类型中增加 `attemptBoundary?: boolean`。
3. 修改 `latestGenerationLogForSource`：匹配到 `attemptBoundary === false` 的同源日志时继续向后扫描，不把它当生成 attempt 边界。
4. 在 `src/lib/managed/pipeline.ts` 写“等待已有任务完成”日志时加入 `{ sourceUrl: source.url, attemptBoundary: false }`。
5. 保留现有测试语义：普通 generation-start info 仍然是边界，必须遮住旧 error/success；只有显式 `attemptBoundary: false` 的 observer 日志可以被跳过。

Task 8 正式完成前还应检查两个 hardening 边界：

- 向导状态已经消失时，retry route 是否会把数据库中已持久化的 HTTP `rss/json` 来源错误当成 legacy feed 并允许脚本重试；如存在，应使用 persisted source 的 `collectorType` 进行 canonical 判定。
- `subscriptionCreator` 是否应该对运行时传入的 `collectionMode` 做白名单校验，避免调用 complete API 时绕过 TypeScript 类型并持久化未知 mode。

完成修复后，新建 `.superpowers/sdd/task-8-report.md`，更新 `.superpowers/sdd/progress.md`，只 stage Task 8 的明确文件并提交。

## Task 8 验证状态和必须重跑的命令

历史中间结果：

- `tests/hybridGenerationPipeline.test.ts` 最近一次为 8/8 通过。
- 相关小套件最近一次为 39/39 通过。
- `npm run build` 在 Task 8 主体实现后通过过，但 `8a89687` 及最后收尾修改之后尚未重新跑，因此不能据此宣布 Task 8 完成。

修复 observer 边界后至少执行：

```bash
node --import tsx --test tests/hybridGenerationPipeline.test.ts
node --import tsx --test tests/hybridGenerationPipeline.test.ts tests/managedDiscoverySelection.test.ts tests/articleIngest.test.ts tests/articleIngestBoundaries.test.ts tests/sourceSampleQuality.test.ts tests/searchCollectorSchema.test.ts tests/collectorDispatch.test.ts tests/searchCollector.test.ts
npx tsc --noEmit
npm run build
git diff --check
```

Task 8 最终 focused regression 建议执行：

```bash
node --import tsx --test tests/hybridGenerationPipeline.test.ts tests/discoveryPlan.test.ts tests/staticListSampler.test.ts tests/findSourcesAgentSafety.test.ts tests/managedDiscoverySelection.test.ts tests/sourcePortfolioPolicy.test.ts tests/sourceIntentPolicy.test.ts tests/sourcePreferences.test.ts tests/searchQueryPlan.test.ts tests/searchCollector.test.ts tests/searchCollectorSchema.test.ts tests/collectorDispatch.test.ts tests/articleValidator.test.ts tests/articleIngest.test.ts tests/articleIngestBoundaries.test.ts tests/sourceSampleQuality.test.ts tests/rssRadar.test.ts tests/httpTextDecoder.test.ts
```

已知 `npx tsc --noEmit` baseline 只有：

- `tests/dbConfig.test.ts:6`
- `tests/dbConfig.test.ts:20`

两处都是 `ProcessEnv.NODE_ENV` 类型缺失。这是本重构之前的已知问题，不要误归因于 Task 8，也不要顺手扩大范围修复。

## Task 9：向导展示（Task 8 完成后直接继续）

计划文件：

- `src/components/wizard/Step2FindSources.tsx`
- `src/components/wizard/SourceDiscoveryAuditDialog.tsx`
- `src/components/wizard/Step3ScriptGen.tsx`
- `src/components/wizard/Step4Confirm.tsx`
- `tests/hybridWizardSource.test.ts`

验收重点：

- Step 2 展示结构化 intent、短查询、权威域名、近期文章样本、collector mode 和排除原因，同时保留现有复选框及返回发现源行为。
- Step 3 把 search collector 显示为终态“检索方案验证通过”，不能显示“重试生成脚本”或脚本日志控制。
- Step 4 保留不同 collector mode/config 的确认信息，不能把 search 降级成 feed script。
- 先编写失败的 UI source tests，再实现，然后跑测试和 production build。

## Task 10：投递正确性和真实端到端验收

计划文件：

- `src/lib/enterprise/deliveryService.ts`
- `src/lib/enterprise/subscriptionService.ts`
- `tests/searchFirstEndToEnd.test.ts`
- `tests/enterpriseDeliverySource.test.ts`

验收重点：

- 投递显示 `messageCards.publisherName`，只有缺失时才回退 collector title。
- 严格选择符合每个用户条件且已经验证的卡片。
- 端到端 fixture 必须接受近期、带明确发布时间且与鞋业有关的火灾报道；拒绝旧闻、商品页、缺日期结果和不相关新闻。
- 空日报继续发送约定的“无匹配”提示。
- 最后运行全部 focused tests、`npm run build`、`git diff --check`，再启动 production server 做一条真实 fresh build。

## API Key 和真实验收要求

确定性验证不需要真实密钥：单元测试、fixture 集成测试、类型检查和 production build 使用 mock、依赖注入或本地样本即可完成。

Task 10 最后的真实联网验收需要：

- 可用的 PostgreSQL `DATABASE_URL`；
- 系统设置中已经保存并激活的大模型供应商；
- 系统设置中已经配置的搜索供应商，当前支持 Tavily 或 Serper；
- 允许真实消耗 LLM token 和搜索 API 配额。

不要让用户把 API Key 粘贴到聊天或交接文档。优先让用户通过应用设置页写入数据库；如果家里环境已经配置好，可以直接使用现有配置，但不要读取、打印或提交原始密钥。正式联网前只确认“是否存在可用配置”。

## 近期生产失败的已确认根因

历史失败构建订阅 ID：`sybdvbpvil09p4ph1e03gzcc`。

- 人民网社会 RSS 能采集内容，但近 14 天没有鞋业匹配，质量拒绝正确。
- 澎湃、央视属于动态搜索页，旧流程猜接口后仍为 0 条。
- 中国新闻网候选名为“搜索页”，实际 URL 是首页，长脚本仍采集 0 条。
- 环球鞋网旧页面多次验证失败。
- 中国皮革协会产生大量泛化或旧内容，之后还触发 `402 Insufficient Balance`。
- 同域存在证据曾错误放行 2023/2025 旧文、关于我们页和商品列表，证明“同域存在”不能作为来源准入条件。

接手时不要用放宽同域规则、堆提示词或继续猜动态搜索页接口的方式回退架构。
