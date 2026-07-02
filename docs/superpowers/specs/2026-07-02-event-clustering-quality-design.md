# 事件归并与内容质量控制设计

日期：2026-07-02

## 背景

当前项目已经具备从订阅主题出发，自动发现数据源、生成采集脚本、定时采集消息卡片的能力。现有链路更偏向“采集到什么就展示什么”，对产业情报场景来说会出现三个明显问题：

- 数据源缺少权威性评判标准，用户难以区分监管部门、行业协会、主流媒体、自媒体和聚合转载站的可信度。
- 多个数据源经常报道同一件事，文章不是同一篇，但事实事件相同，消息中心会被重复报道刷屏。
- 采集到的新闻内容缺少质量过滤和相似内容折叠，有些文章信息密度低、套话多，或者与其他文章高度雷同。

本设计将当前“文章流”升级为“同订阅内事件折叠流”。系统仍保留每篇原始文章，但默认按事件展示代表消息，并把同一事件的其他来源折叠为多源佐证。

## 目标

第一版目标：

- 在同一个订阅内，把描述同一事件的多篇文章归并为一个事件簇。
- 为数据源建立自动权威性评估，并允许用户手动修正。
- 为每条消息卡片计算内容质量分、重复程度和代表消息分。
- 消息中心和订阅详情默认展示事件簇，而不是原始文章刷屏列表。
- 规则优先、AI 兜底，避免每条消息都调用模型。
- 没有可用 LLM provider 时，规则归并仍能运行，灰区保守处理为新事件。

非目标：

- 不做跨订阅或跨产业配置的事件中心。
- 不删除低质量内容，只标记、降权和折叠。
- 不引入向量数据库。
- 不做历史消息强制回填。
- 不建设完整事件时间线、风险因子或产业情报大屏。

## 核心决策

### 归并范围

事件归并只发生在同一个 `subscriptionId` 内。不同订阅即使采集到相似报道，也不在第一版中归并。这样能避免不同业务语境被混在一起，也让实现更贴近现有数据模型。

### 展示策略

同一事件折叠为一个事件卡片。默认展示综合评分最高的代表消息，其他文章作为同事件来源展开查看。低质量或高度雷同文章不删除，只默认收进相似报道区域。

### 代表消息选择

代表消息使用综合评分：

- 权威性：45%
- 内容质量：35%
- 时间新鲜度：15%
- 原创或非转载信号：5%

权威来源优先，但不会机械地让空泛公告压过信息量更高的可靠报道。

### AI 使用策略

规则优先，AI 只在灰区兜底。AI 不负责删除文章，只给出是否同一事件、置信度、质量补充和判断理由。AI 结果需要落库或缓存，避免同一对内容反复调用。

## 数据模型

### sources 扩展

`sources` 增加来源权威字段：

```ts
authorityLevel: 'high' | 'medium' | 'low' | 'unknown';
authorityScore: number;
sourceType:
  | 'authority'
  | 'official'
  | 'mainstream_media'
  | 'industry_media'
  | 'social'
  | 'aggregator'
  | 'unknown';
authorityReason: string | null;
authorityOverride: boolean;
```

含义：

- `authorityLevel` 给用户看的分级。
- `authorityScore` 用于排序和代表消息评分。
- `sourceType` 记录来源类型。
- `authorityReason` 展示自动判断理由。
- `authorityOverride=true` 表示用户手动修正过，后续自动评估不能覆盖。

### 新增 message_event_clusters

新增事件簇表，表示同一订阅下的一件事：

```ts
id: string;
subscriptionId: string;
eventTitle: string;
eventSummary: string | null;
eventKey: string;
representativeCardId: string | null;
cardCount: number;
sourceCount: number;
highestAuthorityLevel: 'high' | 'medium' | 'low' | 'unknown';
qualityScore: number;
firstPublishedAt: Date | null;
latestPublishedAt: Date | null;
createdAt: Date;
updatedAt: Date;
```

索引建议：

- `(subscription_id, event_key)`
- `(subscription_id, latest_published_at)`
- `(representative_card_id)`

### message_cards 扩展

`message_cards` 增加事件归并和质量字段：

```ts
eventClusterId: string | null;
eventKey: string | null;
canonicalSignal: string | null;
contentQualityScore: number;
duplicateScore: number;
representativeScore: number;
qualityReason: string | null;
isRepresentative: boolean;
isLowQuality: boolean;
```

含义：

- `eventClusterId` 指向所属事件簇。
- `eventKey` 是规则生成的粗粒度事件 key。
- `canonicalSignal` 存储标准化标题、主体词、地区、动作词等信号，便于调试。
- `contentQualityScore` 衡量信息密度和可用性。
- `duplicateScore` 衡量与已有事件内容的重复程度。
- `representativeScore` 用于选择代表消息。
- `isRepresentative` 标记当前事件簇的代表消息。
- `isLowQuality` 表示默认折叠展示。

## 数据源权威评估

新增模块 `src/lib/intelligence/sourceAuthority.ts`。

评估时机：

- AI 找源返回候选数据源后，可以给 `FoundSource` 增加权威字段，帮助用户选择。
- 创建 `sources` 记录时写入权威字段。
- 用户在数据源详情页手动修正时设置 `authorityOverride=true`。

规则优先：

- 政府、监管、法院、交易所、协会、企业官网、公告类 RSS/API：高权威。
- 主流媒体、行业媒体：中高或中等。
- 普通新闻站、地方媒体：中等。
- 自媒体、论坛、社交平台、聚合转载站：低或未知。

当规则无法判断时，可以调用 AI 兜底生成：

```json
{
  "sourceType": "industry_media",
  "authorityLevel": "medium",
  "authorityScore": 68,
  "reason": "行业媒体，内容相关性较强，但不是官方一手来源"
}
```

第一版不建设产业级白名单，但字段设计允许后续从用户修正沉淀出产业配置规则。

## 采集入库流程

现有流程：

```text
runScript -> items -> hash(title + url) 去重 -> insert message_cards
```

新流程：

```text
runScript
  -> normalize item
  -> score content quality
  -> generate event signal
  -> match event cluster
  -> insert message card
  -> update cluster representative
  -> update subscription counts
```

### 标准化

每条 `CollectedItem` 入库前先生成标准化信号：

- 标准化标题：去掉“最新消息”“重磅”“转载”“来源”等噪声。
- 标准化 URL：去掉常见追踪参数。
- 时间归一：无发布时间时使用采集时间。
- 文本信号：标题 + 摘要，截断到规则和 AI 判断需要的长度。

### 质量评分

新增模块 `src/lib/intelligence/eventClustering.ts`。

规则评分维度：

- 标题和摘要过短：降分。
- 摘要为空或全是模板套话：降分。
- 标题/摘要包含明确主体、地点、事件动作、处置结果：升分。
- 来源权威、原始公告、明确发布时间：升分。
- 与同事件已有文章高度相似且没有新增事实：降分。

低质量内容不丢弃，只设置 `isLowQuality=true` 并默认折叠。

### 事件 key

从标题和摘要提取粗粒度信号：

- 主体：企业、机构、园区、产品、地区。
- 地区：省市区或产业区域。
- 日期：发布日期或标题中的事件日期。
- 动作词：爆炸、泄漏、处罚、召回、停产、涨价、事故、检查等。

示例：

```text
山东|化工园区|爆炸|2026-07-02
```

第一版可以先用规则词表和简单分词，不引入复杂 NLP 依赖。

### 事件匹配

只比较同一订阅最近 30 天内的事件簇。

匹配过程：

1. 用 `eventKey` 或相近信号筛出候选事件簇。
2. 计算标题和摘要 token overlap/Jaccard。
3. 相似度高于阈值时直接归并。
4. 相似度低于阈值时创建新事件。
5. 灰区调用 AI 判断。

建议阈值：

- `similarity >= 0.75`：直接同一事件。
- `similarity <= 0.35`：直接新事件。
- `0.35 < similarity < 0.75`：进入 AI 兜底。

AI 返回结构：

```json
{
  "sameEvent": true,
  "confidence": 0.86,
  "reason": "主体、地点、事故类型一致，只是不同媒体报道角度不同",
  "qualityScore": 78,
  "addedFacts": ["新增伤亡人数", "补充监管部门处置"]
}
```

如果没有 LLM provider，灰区保守处理为新事件，避免错误归并。

### 代表消息更新

新消息进入事件簇后，重新计算该簇所有卡片的代表分：

```text
representativeScore =
  authorityScore * 0.45
  + contentQualityScore * 0.35
  + freshnessScore * 0.15
  + originalityScore * 0.05
```

分数最高的卡片设为 `isRepresentative=true`，事件簇更新 `representativeCardId`、`cardCount`、`sourceCount`、`highestAuthorityLevel`、`firstPublishedAt`、`latestPublishedAt`。

## API 设计

### 消息事件列表

新增或扩展消息接口，支持事件视图：

```text
GET /api/message-events?status=unread|read|all&subscriptionId=&limit=&offset=
```

返回事件簇和代表卡片：

```ts
{
  data: Array<{
    cluster: MessageEventCluster;
    representativeCard: MessageCard;
    sourceCount: number;
    cardCount: number;
  }>;
  offset: number;
  limit: number;
}
```

### 事件详情

展开事件时读取同簇文章：

```text
GET /api/message-events/[id]
```

返回：

- 事件簇信息。
- 代表消息。
- 同事件所有文章，按 `representativeScore` 排序。
- 低质量或高重复文章可以由前端默认折叠。

### 原始文章视图

保留现有 `/api/message-cards`，作为原始文章视图和调试入口，不破坏已有调用。

### 来源权威修正

扩展数据源更新接口，允许用户修改：

- `authorityLevel`
- `authorityScore`
- `sourceType`
- `authorityReason`

用户修改后设置 `authorityOverride=true`。

## 前端设计

### 消息中心

默认展示事件列表，而不是原始文章列表。

事件卡片展示：

- 代表消息标题。
- 事件摘要。
- 代表来源名称和权威等级。
- “共 N 个来源 / N 篇报道”。
- 发布时间范围。
- 命中监控条件标记。
- 质量或权威提示，例如“高权威源 · 信息量较高”。

展开后展示同事件文章：

- 权威源和代表分靠前。
- 低质量和高度雷同文章进入“相似报道”折叠区。
- 每篇展示来源、发布时间、质量理由和原文链接。
- 收藏仍然作用在具体文章上。

### 订阅详情

默认使用事件视图。保留切换：

- `事件视图`：默认，折叠后的情报流。
- `原始文章`：展示所有采集文章，用于排查和完整查看。

### 数据源详情

展示并允许修改来源权威：

- 权威等级：高 / 中 / 低 / 未知。
- 来源类型。
- 自动判断理由。
- 手动修正入口。

## 兼容与迁移

- 旧消息 `eventClusterId` 为空时仍可通过原始文章接口展示。
- 第一版不强制回填历史消息。
- 新字段要提供默认值，保证旧数据库迁移后可运行。
- 现有 `contentHash = hash(title + url)` 去重保留，用于过滤完全相同的文章。
- 新事件归并是第二层去重，用于处理不同 URL 但同一事件的报道。

## 测试策略

### 规则单元测试

覆盖：

- 来源权威评估：政府域名、监管机构、主流媒体、行业媒体、聚合站、自媒体。
- 事件 key 生成：同一事件不同标题得到接近或相同 key。
- 内容质量评分：空摘要、套话摘要、明确事实摘要、转载提示。
- 代表消息评分：高权威和高信息量文章能胜出。

### 采集入库集成测试

构造同一个订阅下的多条消息：

- 同一 URL/标题：继续被原 hash 去重。
- 不同 URL 但同一事件：进入同一 `message_event_cluster`。
- 不同事件：创建不同 cluster。
- 低质量相似文章：不删除，标记 `isLowQuality`。
- 新的高权威文章进入后，能替换代表消息。

### API 和 UI 测试

沿用当前项目的 `node:test` 源码测试风格，先验证：

- 消息事件接口返回事件视图数据。
- 原始文章接口仍可用。
- 数据源接口支持权威字段。
- 用户手动覆盖权威等级后，自动评估不会覆盖。

## 实施顺序

1. 数据模型和迁移：新增事件簇表，扩展 `sources` 和 `message_cards`。
2. 规则模块：实现来源权威、内容质量、事件 key、相似度和代表分。
3. 入库流程：改造 `collector.ts` 和 `subscriptionCreator.ts`，在写卡片时归并事件。
4. API：新增事件视图接口，保留原始文章接口。
5. 前端：消息中心和订阅详情接入事件视图，数据源详情支持权威修正。
6. AI 兜底：为灰区事件匹配接入结构化 LLM 判断，并做失败降级。

## 风险与降级

- 误归并风险：第一版只在同订阅内归并，灰区无 AI 时保守新建事件。
- AI 成本风险：只在相似度灰区调用 AI，并缓存判断结果。
- 低质量误判风险：不删除文章，只折叠展示。
- 旧数据兼容风险：旧卡片无事件簇仍走原始文章视图。
- UI 复杂度风险：先做事件卡片和展开列表，不做复杂图谱或时间线。

## 结论

第一版应从“文章级采集”升级为“同订阅事件级展示”。数据源权威等级解决来源可信度问题，事件簇解决同一事件多源刷屏问题，内容质量评分解决低信息密度和雷同内容问题。所有原始文章仍然保留，系统默认展示更像产业情报的代表消息和多源佐证。
