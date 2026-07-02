# 企业级产业订阅与个性化邮件报送设计

日期：2026-07-02

## 背景

当前项目已经具备个人订阅创建、AI 找源、脚本生成、定时采集、消息卡片和邮件配置能力。后续项目计划接入企业系统，使用方式会从“个人自由创建订阅”升级为“管理员维护产业方向，普通用户选择方向并补充个人关注条件”。

典型场景：

- 管理员发布“食品安全”产业信息方向。
- 普通用户 A 订阅该方向，并补充“食品安全管理条例相关”。
- 普通用户 B 订阅同一方向，并补充“食品安全对餐饮公司影响”。
- 系统按管理员配置的时间，例如每日 9 点，为 A 和 B 分别生成邮件。
- 邮件不发送全部抓取信息，只筛选与各自监控条件最相关的 5-10 条，并展示概要、权威性、相关性和原文链接。

本设计把现有 `industry_configs` 升级为管理员维护的企业级产业方向目录，并引入“监控需求簇”来决定用户是否复用已有采集池，还是触发新的 AI 找源和脚本生成流程。

## 目标

第一版目标：

- 管理员维护企业级产业方向，普通用户不能创建或编辑产业方向。
- 普通用户选择已发布的产业方向，补充个性化监控条件和收件邮箱。
- 相似的用户监控条件复用同一个采集池。
- 不相似的用户监控条件形成新的监控需求簇，并按管理员配置自动创建或等待审批。
- 监控需求簇创建采集池时复用现有 AI 新建订阅流程。
- 管理员统一配置产业方向的邮件报送时间、时区和每封邮件最大条数。
- 报送时为每个用户按其个性化条件筛选 5-10 条高相关信息。
- 邮件包含表格、概要、来源权威性、相关性说明和原文链接。
- 所有发送、失败、跳过都要留日志。

非目标：

- 不做组织部门、企业通讯录和复杂权限体系。
- 不做普通用户自定义报送时间。
- 不做复杂退订中心，第一版可以在用户关注配置中暂停。
- 不做跨企业租户隔离，当前按单企业部署理解。
- 不强制迁移历史个人产业配置语义；后续产业配置统一视为管理员维护。
- 不在管理员添加产业方向时立即生成爬虫脚本。

## 核心概念

### 产业方向

产业方向由管理员维护，存储在 `industry_configs`。它表示企业希望长期关注的业务主题，例如“食品安全”“化工原料”“煤炭产业”。

管理员创建产业方向时，只定义业务画像和报送规则，不创建采集脚本。真正的采集池创建由普通用户的有效订阅触发。

### 监控需求簇

监控需求簇表示一个产业方向下的一组相似用户监控条件。例如：

```text
产业方向：食品安全
  监控需求簇 1：食品安全法规政策
    用户需求：食品安全管理条例相关
    采集池：sub_xxx

  监控需求簇 2：餐饮企业经营影响
    用户需求：食品安全对餐饮公司影响
    采集池：sub_yyy
```

同一需求簇内的用户共享采集订阅和 sources，但邮件筛选仍按每个用户自己的 `customCriteria` 个性化排序。

### 用户产业关注

用户产业关注表示普通用户订阅某个管理员产业方向，并提供自己的补充条件、收件邮箱和状态。

用户关注不会直接拥有自己的爬虫脚本。它会绑定到某个监控需求簇；如果没有合适簇，再触发新簇创建。

## 数据模型

### industry_configs 调整

`industry_configs` 直接升级为管理员维护的企业级产业方向目录。普通用户不再拥有个人产业配置。

新增或调整字段：

```ts
createdBy: string | null; // 管理员 userId
visibility: 'draft' | 'published';
subscriptionMode: 'open' | 'approval_required';
autoProfileExpansion: boolean;
deliveryCron: string | null;
deliveryTimezone: string;
deliveryEnabled: boolean;
maxItemsPerEmail: number;
```

字段含义：

- `createdBy`：创建或维护该方向的管理员。
- `visibility=draft`：管理员草稿，普通用户不可见。
- `visibility=published`：已发布，普通用户可订阅。
- `subscriptionMode=open`：普通用户订阅后直接生效。
- `approval_required`：普通用户提交后需管理员审批。
- `autoProfileExpansion=true`：当用户条件不匹配已有需求簇时，自动创建新需求簇并启动采集池创建。
- `false`：新需求簇进入待管理员确认。
- `deliveryCron`：管理员统一配置报送时间，例如 `0 9 * * *`。
- `deliveryTimezone`：默认 `Asia/Shanghai`。
- `deliveryEnabled`：是否启用邮件报送。
- `maxItemsPerEmail`：默认 10，建议限制在 5-10 条。

读取规则：

- 管理员可读写全部产业方向。
- 普通用户只能读取 `visibility='published'` 且 `isEnabled=true` 的产业方向。

迁移策略：

- 现有 `industry_configs` 后续统一转为管理员维护。
- 如果数据库存在管理员用户，迁移时可把既有配置归属到第一个管理员。
- 如果没有管理员，保留数据但标记为 `draft`，等管理员创建后再接管。

### industry_monitoring_profiles

新增监控需求簇表：

```ts
id: string;
industryConfigId: string;
title: string;
seedCriteria: string;
criteriaSummary: string | null;
keywordsJson: string;
targetEntitiesJson: string;
status: 'pending' | 'creating' | 'active' | 'failed' | 'disabled';
sharedSubscriptionId: string | null;
triggeredByUserId: string | null;
requiresAdminApproval: boolean;
approvedBy: string | null;
approvedAt: Date | null;
lastProvisionedAt: Date | null;
provisioningError: string | null;
createdAt: Date;
updatedAt: Date;
```

字段含义：

- `seedCriteria`：触发该簇创建的用户原始补充条件。
- `criteriaSummary`：规则或 AI 生成的需求摘要。
- `keywordsJson` / `targetEntitiesJson`：用于匹配后续用户条件。
- `status=pending`：等待管理员确认创建。
- `creating`：正在走 AI 找源和脚本生成流程。
- `active`：已有可用共享采集订阅。
- `failed`：采集池创建失败，可由管理员重试。
- `sharedSubscriptionId`：复用现有 `subscriptions.id`，该订阅下挂具体 sources。

### user_industry_subscriptions

新增用户产业关注表：

```ts
id: string;
userId: string;
industryConfigId: string;
monitoringProfileId: string | null;
status:
  | 'pending_approval'
  | 'pending_profile'
  | 'active'
  | 'rejected'
  | 'paused';
customCriteria: string;
recipientEmailsJson: string;
approvalReason: string | null;
lastDeliveredAt: Date | null;
createdAt: Date;
updatedAt: Date;
```

字段含义：

- `monitoringProfileId`：用户关注绑定的监控需求簇。
- `pending_approval`：用户订阅产业方向需管理员审批。
- `pending_profile`：用户关注已通过，但新需求簇等待管理员确认或采集池创建。
- `active`：可参与邮件报送。
- `paused`：用户暂停接收。
- `recipientEmailsJson`：默认包含用户账号邮箱，可追加额外企业邮箱。

约束建议：

- 同一用户对同一产业方向可允许多个关注条件，也可以第一版限制一个。建议第一版允许多个，便于一个用户同时关注法规和企业影响。
- 额外邮箱数量设上限，例如最多 5 个。

### delivery logs

新增产业方向级报送运行表：

```ts
industry_delivery_runs
id: string;
industryConfigId: string;
scheduledFor: Date;
status: 'running' | 'completed' | 'failed';
startedAt: Date;
finishedAt: Date | null;
error: string | null;
createdAt: Date;
```

新增用户级发送日志：

```ts
user_delivery_logs
id: string;
runId: string;
userIndustrySubscriptionId: string;
userId: string;
recipientEmailsJson: string;
selectedCardIdsJson: string;
subject: string;
status: 'sent' | 'skipped' | 'failed';
error: string | null;
sentAt: Date | null;
createdAt: Date;
```

## 管理员流程

1. 管理员进入“产业方向”管理页。
2. 新建产业方向，例如“食品安全”。
3. 填写产业画像：
   - 名称
   - 分类
   - 描述
   - 关键词
   - 风险词
   - 地区
   - 关注对象
   - 推荐来源类型
   - 关注级别
4. 配置订阅权限：
   - 开放订阅
   - 需管理员审批
5. 配置监控需求扩展策略：
   - 允许自动扩展采集池
   - 需要管理员确认新需求簇
6. 配置邮件报送：
   - 是否启用
   - cron 时间
   - 时区
   - 每封邮件最多条数
7. 发布方向。

管理员发布方向时不创建爬虫脚本。只有当普通用户有效订阅并形成监控需求簇时，才创建共享采集池。

管理员待办包括：

- 审批用户订阅申请。
- 审批新监控需求簇。
- 重试失败的采集池创建。
- 修复失败 source。
- 查看报送运行日志和用户发送日志。

## 普通用户流程

1. 普通用户进入“产业方向”目录。
2. 查看管理员已发布的产业方向。
3. 选择方向，例如“食品安全”。
4. 填写个性化监控条件：
   - A：食品安全管理条例相关
   - B：食品安全对餐饮公司影响
5. 配置收件邮箱：
   - 默认使用账号邮箱。
   - 可补充额外企业邮箱。
6. 提交关注。

提交后：

- 如果产业方向为开放订阅，关注进入匹配流程。
- 如果产业方向需审批，状态为 `pending_approval`。
- 审批通过后进入匹配流程。

匹配后：

- 如果找到相似监控需求簇，用户关注绑定该 profile。
- 如果没有相似 profile：
  - 产业方向允许自动扩展：创建新 profile 并启动采集池创建。
  - 不允许自动扩展：创建 pending profile，用户关注进入 `pending_profile`。

## 监控需求簇匹配

新增模块建议：

```text
src/lib/enterprise/profileMatcher.ts
```

输入：

- 产业方向画像。
- 用户 `customCriteria`。
- 当前产业方向下已有 active/creating profiles。

规则优先：

- 关键词重合度。
- 目标实体重合度。
- 意图词重合度，例如法规、政策、处罚、企业影响、价格、事故、召回。
- 产业画像中风险词和地区的匹配情况。

建议判断：

- 高相似度：直接复用。
- 低相似度：创建新 profile。
- 灰区：调用 AI 判断。

AI 返回结构：

```json
{
  "reuseProfileId": "profile_1",
  "confidence": 0.82,
  "reason": "用户关注条例解释，与现有法规政策监控簇高度相似"
}
```

或：

```json
{
  "reuseProfileId": null,
  "suggestedTitle": "餐饮企业经营影响",
  "criteriaSummary": "关注食品安全监管变化对餐饮公司经营、成本、处罚和合规动作的影响",
  "reason": "关注对象和分析角度与法规政策监控不同"
}
```

没有 LLM provider 时：

- 规则高相似度仍复用。
- 规则低相似度直接创建或进入待审批。
- 灰区保守处理为新 profile 或待审批，取决于 `autoProfileExpansion`。

## 共享采集池创建

监控需求簇需要采集池时，复用现有新建订阅能力：

```text
profile -> bare subscription -> find_sources -> generate_scripts -> complete -> sharedSubscriptionId
```

创建输入不只是用户原句，而是产业画像和监控需求簇的组合：

```text
topic = {产业方向名称} - {profile.title}
criteria = 管理员产业画像关键词 + 风险词 + 地区 + 用户 seedCriteria + criteriaSummary
```

状态流转：

```text
pending -> creating -> active
pending -> creating -> failed
failed -> creating -> active
```

创建成功：

- 写入 `industry_monitoring_profiles.sharedSubscriptionId`。
- 设置 `status=active`。
- 绑定到该 profile 的用户关注进入 `active`。

创建失败：

- 设置 `status=failed`。
- 写入 `provisioningError`。
- 管理员可重试。

重要约束：

- 后续相似用户复用已有 profile，不重复生成 sources。
- 不相似用户可能触发新的 profile 和新的共享采集池。
- 采集池仍由现有 scheduler 执行 source cron。

## 邮件报送

### 调度

管理员在产业方向配置：

```ts
deliveryCron: '0 9 * * *';
deliveryTimezone: 'Asia/Shanghai';
deliveryEnabled: true;
maxItemsPerEmail: 10;
```

系统启动时加载启用报送的产业方向并注册 delivery job。

到点后：

```text
创建 industry_delivery_run
  -> 查询该产业方向下 active 用户关注
  -> 对每个用户关注生成个性化邮件
  -> 发送邮件
  -> 写 user_delivery_log
  -> 更新 run 状态
```

### 筛选范围

每个用户关注从其绑定的 `monitoringProfile.sharedSubscriptionId` 查询消息。

第一版查询范围：

- 上次 `lastDeliveredAt` 之后新增的消息或事件。
- 若无 `lastDeliveredAt`，使用最近 24 小时或最近一次报送周期。

如果已实现事件归并设计，优先按事件簇筛选；否则先按 `message_cards` 筛选。

### 选文评分

邮件选文综合排序：

```text
deliveryScore =
  relevanceToCustomCriteria * 0.45
  + authorityScore * 0.20
  + importanceScore * 0.15
  + freshnessScore * 0.10
  + contentQualityScore * 0.10
```

含义：

- `relevanceToCustomCriteria`：与用户补充条件的相关性，权重最高。
- `authorityScore`：来源权威性。
- `importanceScore`：事故、处罚、召回、政策变化、重大价格波动等。
- `freshnessScore`：越接近本次报送周期越高。
- `contentQualityScore`：来自事件归并和质量控制设计。

规则优先：

- 关键词匹配。
- 风险词匹配。
- 来源权威等级。
- 发布时间。
- 事件质量分。

AI 可用于：

- 判断消息与用户 `customCriteria` 的相关性。
- 生成“为什么与你相关”。
- 生成邮件顶部概要。

第一版约束：

- 只选 5-10 条。
- 低于最低相关性阈值时不发送邮件，记录 `skipped`。
- 不把全部抓取信息一股脑发给用户。

## 邮件内容格式

邮件标题示例：

```text
食品安全产业信息早报｜法规政策监控｜2026-07-02
```

邮件结构：

```text
顶部概要：
- 今日筛选出 8 条与“食品安全管理条例相关”的信息。
- 其中高权威来源 3 条，涉及监管政策、处罚案例和地方执行动态。
- 建议重点关注：xxx。

信息表格：
| 序号 | 标题 | 来源 | 权威性 | 相关性 | 发布时间 | 摘要 | 链接 |
```

每条信息包含：

- 标题。
- 来源。
- 权威性：高/中/低和简短理由。
- 相关性：高/中/低或分数，以及“为什么相关”。
- 发布时间。
- 信息概要。
- 原文链接。
- 如果已有事件归并：显示“共 N 个来源报道此事件”。

邮件 HTML 应使用内联样式和表格布局，兼容企业邮箱客户端。

## API 和页面

### 管理员页面

产业方向管理：

- 列表、创建、编辑、发布、停用。
- 配置订阅模式、扩展策略、报送策略。
- 查看监控需求簇列表。
- 查看待审批用户关注。
- 查看待确认新 profile。
- 查看报送日志。

### 普通用户页面

产业方向目录：

- 浏览已发布方向。
- 查看方向说明、关键词、风险词和报送时间。
- 创建关注配置。
- 查看我的关注列表。
- 暂停或恢复关注。
- 修改 `customCriteria` 和收件邮箱。

### API 建议

管理员：

```text
GET /api/industry-configs
POST /api/industry-configs
PATCH /api/industry-configs/[id]
POST /api/industry-configs/[id]/publish
GET /api/industry-configs/[id]/profiles
POST /api/industry-profiles/[id]/approve
POST /api/industry-profiles/[id]/retry
GET /api/industry-delivery-runs
```

普通用户：

```text
GET /api/enterprise/industry-catalog
POST /api/enterprise/industry-subscriptions
GET /api/enterprise/my-industry-subscriptions
PATCH /api/enterprise/my-industry-subscriptions/[id]
POST /api/enterprise/my-industry-subscriptions/[id]/pause
```

具体路径可在实现计划中结合现有 `/api/industry-configs` 收敛命名。

## 权限规则

- 管理员可创建、编辑、发布、停用产业方向。
- 管理员可审批用户关注和新 profile。
- 管理员可查看全部报送日志。
- 普通用户只能查看已发布启用的产业方向。
- 普通用户只能管理自己的关注配置。
- 普通用户不能直接创建 sources 或修改共享采集池。

## 与事件归并质量设计的关系

本设计和 `2026-07-02-event-clustering-quality-design.md` 是互补关系。

企业邮件报送第一版可以先基于原始 `message_cards` 工作；但推荐在邮件选文时优先使用事件归并结果：

- 邮件避免同一事件重复出现多次。
- 表格可展示来源权威性。
- 低质量或高度雷同内容不进入邮件。
- 代表消息和多源佐证能提升企业情报可信度。

建议实施顺序上，企业版可以先完成目录、用户关注、profile 和邮件日志；邮件评分字段与事件归并字段对接可作为后续增强。

## 测试策略

### 权限测试

- 普通用户不能创建、编辑、删除产业方向。
- 普通用户只能看到 published + enabled 的方向。
- 管理员能审批用户关注。
- 管理员能审批新 profile。

### profile matching 测试

- 相似条件复用已有 profile。
- 不相似条件创建新 profile 或进入待审批。
- 灰区无 LLM 时按配置保守处理。
- 绑定 profile 后用户关注状态正确。

### 采集池创建测试

- 首个有效用户关注触发 profile 采集池创建。
- 相似后续用户不会重复创建 sources。
- 不相似用户能形成新 profile。
- profile 创建失败后记录错误并可重试。

### 邮件筛选测试

- 不同用户从同一 profile 得到不同排序。
- 邮件只选 5-10 条高相关内容。
- 低相关内容不发送，记录 skipped。
- 发送成功、失败、跳过都有日志。
- 收件邮箱包含账号邮箱和额外邮箱。

### 兼容测试

- 现有认证、SMTP、订阅、消息卡片接口不被破坏。
- 管理员设置页现有能力保持可用。
- 现有产业配置工具函数迁移后仍能构建 snapshot 和 suggestion。

## 分阶段实施

### 阶段 1：企业产业目录和用户关注

- 升级 `industry_configs` 权限语义。
- 新增用户关注表。
- 管理员发布产业方向。
- 普通用户订阅方向、填写条件和邮箱。
- 支持开放订阅和需审批。

### 阶段 2：监控需求簇和共享采集池

- 新增 `industry_monitoring_profiles`。
- 实现 profile matching。
- 接入现有 AI 新建订阅流程创建 profile 采集池。
- 支持自动扩展和管理员确认扩展。

### 阶段 3：定时报送

- 新增 delivery run 和 user delivery log。
- 注册产业方向报送 cron。
- 实现个性化筛选和 HTML 邮件。
- 发送成功、失败、跳过可追踪。

### 阶段 4：质量增强联动

- 接入事件归并、来源权威和内容质量评分。
- 邮件优先按事件展示。
- 表格展示权威性、相关性、事件来源数。

## 风险与降级

- profile 误复用：灰区交给 AI，或管理员可拆分 profile。
- profile 过多：默认需要管理员确认扩展，避免无限创建采集池。
- AI 创建失败：profile 标记 failed，管理员可重试。
- 邮件低质量：设置最低相关性阈值，低于阈值 skipped。
- 企业邮箱发送失败：写日志，不影响其他用户发送。
- 普通用户条件频繁修改：第一版可重新匹配 profile，但不自动删除旧 profile。

## 结论

企业版应采用“管理员产业方向 + 监控需求簇 + 用户个性化关注 + 定时报送”的结构。管理员负责定义企业关注方向和报送规则，普通用户负责表达自己的监控条件。系统通过监控需求簇复用相似采集池，在不相似时按管理员策略扩展新的采集池，并在报送时为每个用户筛选最相关的 5-10 条高质量信息。
