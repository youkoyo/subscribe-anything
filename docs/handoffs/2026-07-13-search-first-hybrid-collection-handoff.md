# 搜索优先混合采集重构：AI 接手文档

更新时间：2026-07-13（Asia/Shanghai）

## 用户最终目标

重构“发现源”和“生成脚本”两个环节，使项目真正能够发现、采集并推送用户条件对应的近期产业新闻。

典型验收案例：用户订阅“国内鞋业相关新闻”，系统应能发现主流媒体报道的近期鞋厂火灾；不能把 2023/2025 年旧闻、商品页、关于我们页或刚入库但没有真实发布时间的内容当作新新闻。

用户已明确确认以下架构方向：

- 产品界面仍是一条构建流程；
- 后台内部采用 `search` 搜索采集器和稳定 `feed`/脚本采集器；
- 搜索命中的文章直接进入文章验证，不再把媒体首页或动态搜索页强迫转换成脚本；
- 只有现场验证能产出近期匹配样本的 RSS/API/静态列表才进入稳定源；
- 默认窗口 14 天，用户明确配置可覆盖；
- 缑少真实 `publishedAt` 必须拒绝，严禁用采集/入库时间代替；
- 管理员来源偏好用于优先检索，不是硬白名单；默认不加入福建/泉州/晋江等地域源。

## 必读规格和计划

1. 设计规格：`docs/superpowers/specs/2026-07-13-search-first-hybrid-collection-design.md`
2. 实施计划：`docs/superpowers/plans/2026-07-13-search-first-hybrid-collection.md`
3. SDD 进度：`.superpowers/sdd/progress.md`
4. Task 1 要求：`.superpowers/sdd/task-1-brief.md`
5. Task 1 实现报告：`.superpowers/sdd/task-1-report.md`

使用 `superpowers:subagent-driven-development` 按计划连续执行。每个任务需要：实现代理 → 任务级规格/质量审查 → 修复 Important/Critical → 更新 progress ledger。不要跳过任务审查。

## 当前 Git 状态

- 分支：`改动生成脚本阶段代码前的分支`
- 重构基线 commit：`412c36c docs: design search-first hybrid collection`
- Task 1 当前 commit：`404201d feat: add deterministic search query planning`
- 设计前已有相关文档 commit：`e1a1e57`、`8a081fe`

工作树非常脏，包含用户此前确认的数据库、本地运行、发现源、脚本验证、日报和来源偏好等改动。禁止 `git reset --hard`、禁止 checkout/restore 整个工作树。每个任务只 stage 自己明确列出的文件。

`docs/superpowers/plans/2026-07-13-search-first-hybrid-collection.md` 尚未提交。交接文档本身也可能未提交。

## 已完成：Task 1（待正式复审通过）

已实现：

- `src/lib/search/queryPlan.ts`
- `src/lib/ai/agents/sourcePreferences.ts`
- `tests/searchQueryPlan.test.ts`

当前能力：

- 结构化 `MonitoringIntent`；
- version 1 `SearchPlan`；
- 产业、事件、经营、企业、地区和管理员必查域名查询；
- 查询最长 80 字符、总数最多 16；
- 默认 14 天和 `requirePublishedAt: true`；
- 无全局地域默认。

focused tests 曾报告 12/12 通过，查询计划测试 10/10 通过。

## 当前正在处理的 Task 1 审查问题

正式 reviewer 判定 Task 1 `Needs fixes`，有两个 Important：

1. `最近3周`、`过去2个月` 等多周/月显式窗口会错误回退为 14 天；应分别解析为 21/60 天。
2. 管理员 `required` 域名默认只取前四个，第五个即使查询预算足够也会被静默丢弃。必须改成预算感知：优先覆盖 required 域名，同时至少保留一个事件类开放查询；行为需要测试锁定。

已派发过修复代理 `/root/fix_task_1_review`，但用户要求交接时该代理尚未改文件，已被安全中断。它确认的最小设计是：新增 `最近3周 → 21`、`过去2个月 → 60` 的 RED 测试；required 域名在 16 条总预算内优先，并始终为事件开放查询保留 1 个槽，超预算时按管理员顺序确定性截断。下一位 AI 首先执行：

1. 重新派发 fresh fix agent，按上一段设计修复 Task 1 的两个 Important；
2. 要求严格 TDD，只编辑 Task 1 三个文件并追加 `.superpowers/sdd/task-1-report.md`；
3. 修复完成后运行：
   `node --import tsx --test tests/searchQueryPlan.test.ts tests/sourcePreferences.test.ts`
4. 重新生成 Task 1 review package，并派 fresh reviewer 复审；
5. 审查通过后向 `.superpowers/sdd/progress.md` 追加：
   `Task 1: complete (commits 412c36c..<HEAD7>, review clean)`
6. 然后从计划 Task 2 开始。

旧修复代理已经中断，不会与新代理并行编辑。

## 之后的实施顺序

严格按计划执行：

1. Task 2：扩展搜索结果日期，增加可注入、部分失败不阻断的搜索执行器。
2. Task 3：统一严格文章验证；缺发布时间、旧文、首页/搜索页/商品页全部拒绝。
3. Task 4：数据库增加 collector 类型、配置和文章证据字段，旧源默认 `feed_script`。
4. Task 5：构建期和运行期统一入库，删除 `publishedAt = now` 路径。
5. Task 6：调度器按 `search/rss/json/feed_script` 分流。
6. Task 7：发现源改成“验证后的采集方案”，搜索文章直接成为样本。
7. Task 8：search collector 跳过脚本生成，手动和托管流程都要覆盖。
8. Task 9：Step 2/3/4 展示查询、样例、采集方式和排除原因。
9. Task 10：真实发布者、用户条件推送和鞋厂火灾端到端验收。

## 近期生产失败的已确认根因

最新失败构建订阅 ID：`sybdvbpvil09p4ph1e03gzcc`。

数据库证据：

- 人民网社会 RSS 能采 100 条，但近 14 天没有鞋业匹配内容；质量拒绝正确。
- 澎湃、央视是动态搜索页，脚本猜接口后仍采 0 条。
- 中国新闻网候选名为“搜索页”，实际 URL 是首页；8477 字符脚本仍采 0 条。
- 环球鞋网旧页面连续三次验证失败。
- 中国皮革协会采到 277/291 条泛化或旧内容，没有近期匹配，最后又触发 `402 Insufficient Balance`。

发现阶段的同域证据也不合格：中新网凭 2023 年文章、人民网凭 2025 年文章、环球鞋网凭关于我们页、美中鞋业网凭商品列表通过。这证明“同域存在”不能作为稳定来源准入。

## 当前工作树已有但未系统收尾的改动

不要丢弃以下方向：

- 来源偏好表/API/设置页和默认全国媒体；
- `SourceDiscoveryAuditDialog` 与 Step 2 AI 找源记录；
- GBK/GB18030 页面解码；
- 脚本完整性检查、HTML 片段拒绝、三次验证上限；
- 14 天样本质量检查和普通用户条件匹配；
- 空日报仍发送无匹配提示；
- Step 3 返回发现源。

这些改动多数仍未提交，后续重构应兼容或替换，而不是整体回滚。

## 已知验证状态

- 最近多次 `npm run build` 曾通过，包括来源偏好和发现源修复之后的构建。
- Task 1 focused tests 通过。
- Task 1 实现代理报告 `npx tsc --noEmit --pretty false --incremental false` 会被既有 `tests/dbConfig.test.ts` 两处 `ProcessEnv.NODE_ENV` 类型问题阻断；不要把它误归因于 Task 1。
- 全量 `npm test` 之前存在若干与本重构无关的旧失败；完成任务时优先跑计划列出的 focused tests，并在最终阶段统一跑构建和相关套件。

## 数据库和运行环境

- `.env.production.local` 使用 `DATABASE_TARGET=local` 和 `DATABASE_URL_LOCAL`。
- PostgreSQL only。
- 已执行过 `0001_source_preferences` 迁移。
- 生产启动：`npm run build` 后 `npm run start`；启动时 `runMigrations()` 会运行迁移和默认数据 seed。
- Windows 本地 `isolated-vm` 需要 Node 22 LTS；当前曾看到 Node 24，但构建可通过。搜索采集器重构后，权威新闻路径不应依赖 isolated-vm。

## 接手原则

- 不要再通过放宽同域规则、增加更多提示词或继续猜动态搜索页接口来修补。
- 搜索命中的文章本身才是候选新闻；媒体首页不是采集结果。
- 任何入池路径都必须走同一个严格文章验证与入库服务。
- 缺真实发布时间一律拒绝。
- search collector 零条匹配是健康的空结果，不应被标成“脚本损坏”。
- LLM 额度不足不能影响搜索、RSS 和 JSON 内置采集路径。
