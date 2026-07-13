import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { getDb } from './index';
import * as schema from './schema';
import { DEFAULT_SOURCE_PREFERENCES } from '@/lib/ai/agents/sourcePreferences';

const MIGRATIONS_DIR = 'drizzle-pg';

const DEFAULT_PROMPT_TEMPLATES = [
  {
    id: 'find-sources',
    name: '查找订阅源',
    description: '引导智能体通过网络搜索，为给定主题找到合适的数据源',
    content: `为主题"{{topic}}"（监控条件：{{criteria}}）找到 5-10 个高质量数据源。

**工具调用限制**
- webSearch 最多调用 10 次，请合理规划搜索策略
- checkFeed 可多次调用（每次可验证多个 URL）

**步骤**
1. webSearch：确认实体标准名称/别名，搜索相关订阅源。**同时搜索官方 RSS/Atom 源**（如搜"X站 RSS"、"X站 feed"），很多网站本身提供官方 RSS，优先使用

2. checkFeed：将步骤 1 中发现的所有 RSS URL **合并为一次**调用，传 \`urls\` 和 \`keywords\`（实体所有已知别名）
   - \`valid: true\` → 直接采用，无需再查 rssRadar
   - 失败 → 见步骤 3

3. rssRadar（仅对尚无有效 RSS 的域名调用）：queries 只传裸域名（如 bilibili.com）
   - 有匹配路由 → 填入 \`:param\` 占位符构造完整 URL，再用 checkFeed 验证
   - 无匹配路由 → 保留原始网页 URL；禁止自行拼造 RSSHub 路径

4. 修复无效 RSS：
   - \`templateMismatch: true\` → 修正 URL 结构后重新验证
   - \`keywordFound: false\` → webSearch 查找正确实体 ID，重新构造后验证
   - 仍失败 → 回退为原始网页 URL（无需验证）

**输出（JSON 数组）**
每项：\`title\`、\`url\`（有效 RSS 优先，否则网页 URL）、\`description\`（内容特点、更新频率、是否含监控指标）、\`recommended\`（质量高/更新频繁/RSS 有效 → true，否则 false）；监控条件不为"无"时加 \`canProvideCriteria\`（能否采集到监控所需指标）

最优质 2-4 个源标记 \`recommended: true\`。`,
    defaultContent: '',
  },
  {
    id: 'generate-script',
    name: '生成采集脚本',
    description: '引导智能体为特定数据源编写 JavaScript 采集脚本',
    content: `你是一位 JavaScript 数据采集专家，为以下数据源编写采集脚本。

数据源：{{title}}
URL：{{url}}
描述：{{description}}
监控条件：{{criteria}}

**沙箱环境（isolated-vm V8，非 Node.js / 非浏览器）**
- 脚本入口：\`async function collect(): Promise<CollectedItem[]>\`，可带 export 前缀
- 可用：\`fetch\`（最多 5 次，无 \`headers\` 属性）、\`URL\`、\`URLSearchParams\`、标准 JS
- 禁用：\`require\`/\`import\`、\`process\`/\`fs\`/\`Buffer\`、DOM API（DOMParser/document/window）、\`console\`、\`setTimeout\`、\`atob\`/\`btoa\`、\`TextDecoder\`/\`TextEncoder\`
- HTML 解析：只能用字符串方法或正则，不能用任何 DOM API

**返回字段**
- 必填：\`title\`（string）、\`url\`（string）
- 建议：\`publishedAt\`（ISO 8601，从数据源提取真实时间）、\`summary\`、\`thumbnailUrl\`
- 监控条件不为"无"时需加：\`criteriaResult\`（'matched'|'not_matched'|'invalid'）、\`metricValue\`
- 无数据返回 \`[]\`，禁止构造假数据兜底；所有 fetch URL 必须限于 \`{{domain}}\` 域名

**你的调研工具（仅供你在生成脚本前调研使用，绝不可出现在脚本代码中）**
- \`webFetch(url)\`：获取页面/Feed 内容，用于了解页面结构
- \`webFetchBrowser(url)\`：无头浏览器，捕获 XHR/Fetch 请求（适合 SPA 或被反爬页面）
- \`webSearch(query)\`：搜索 API 文档、实体 ID 等辅助信息
- \`rssRadar(queries)\`：查询现有 RSS 路由
- \`validateScript(script)\`：在沙箱中验证脚本（**必须调用**）

⚠️ 脚本代码内部只能使用沙箱环境中列出的 API（\`fetch\`、\`URL\`、\`URLSearchParams\`），不能调用 \`webFetch\`、\`webFetchBrowser\`、\`webSearch\`、\`rssRadar\` 等调研工具。

**工作流程**
1. 用 webFetch 抓取目标 URL，判断内容类型：
   - 含 \`<rss\`/\`<feed\`/\`<item\`/\`<entry\` → RSS/Atom，直接编写解析脚本
   - HTML 页面 → 调用 rssRadar；有匹配路由则将 templateUrl 中的 \`:param\` 占位符替换为真实参数，再用 webFetch 拉取完整 RSS XML 后编写解析脚本；无匹配则解析 HTML 或 API
   - 返回空/失败 → 改用 webFetchBrowser，优先分析 capturedRequests 中的 API 端点
2. RSS/XML 解析：用 split/indexOf/slice 逐块提取字段；**禁止对 XML 标签用正则**；务必 webFetch 实际内容确认 XML 结构后再写脚本
3. 脚本写好后调用 validateScript；失败则修复重试（最多 3 次）

**注意（脚本以 JSON 字符串传输，以下两类写法会导致语法报错）**
- 正则中匹配字面 \`/\` 时用字符类 \`[/]\` 代替 \`\\/\`
- 字符串字面量中需要换行时写 \`\\n\` 转义，不要使用真实换行符`,
    defaultContent: '',
  },
  {
    id: 'validate-script',
    name: '校验采集脚本',
    description: '对采集脚本和采集结果进行 LLM 质量审查，验证数据真实性，可同时修复发现的问题',
    content: `对以下采集脚本进行质量审查。

数据源：{{url}}
描述：{{description}}
监控条件：{{criteria}}

脚本：
\`\`\`javascript
{{script}}
\`\`\`

采集结果（前 5 条）：
\`\`\`json
{{items}}
\`\`\`

**CollectedItem 返回字段格式**
- \`title\`（必填，string）：条目标题
- \`url\`（必填，string）：条目详情链接
- \`publishedAt\`（建议，ISO 8601 字符串）：发布时间，如 "2024-03-15T10:30:00Z" 或 "2024-03-15T18:30:00+08:00"
- \`summary\`（可选，string）：内容摘要
- \`thumbnailUrl\`（可选，string）：封面图片 URL
- \`criteriaResult\`（监控条件不为"无"时必填）：'matched' | 'not_matched' | 'invalid'
- \`metricValue\`（监控条件不为"无"时建议）：提取的监控指标原始值（如 "¥299"、"98%"、"5000+"）

**审查步骤**
1. 代码质量：
   - 有无假数据兜底？无数据应返回 \`[]\`
   - \`publishedAt\` 建议提取但非必须，不提取不算质量问题
   - fetch URL 是否限于数据源域名 \`{{domain}}\`？
   - 监控条件不为"无"时是否正确实现 \`criteriaResult\`/\`metricValue\`？
2. 数据真实性：用 webFetch 抓取前 2 条 URL，确认可访问且页面内容与 title 吻合；因网络限制无法访问时结合代码质量综合判断

**输出**
\`\`\`json
{"valid": true, "reason": "简明说明（30字以内）"}
\`\`\`
valid=false 且可修复时，在 JSON 块后附完整修复脚本。`,
    defaultContent: '',
  },
  {
    id: 'repair-script',
    name: '修复采集脚本',
    description: '引导智能体诊断并修复失效的采集脚本',
    content: `以下采集脚本运行失败，请修复。

URL：{{url}}
错误：{{lastError}}

脚本：
\`\`\`javascript
{{script}}
\`\`\`

**沙箱环境（isolated-vm V8，非 Node.js / 非浏览器）**
可用：\`fetch\`（最多 5 次，无 \`headers\` 属性）、\`URL\`、\`URLSearchParams\`、标准 JS
禁用：\`require\`/\`import\`、\`process\`/\`fs\`/\`Buffer\`、DOM API、\`console\`、\`setTimeout\`、\`atob\`/\`btoa\`、\`TextDecoder\`/\`TextEncoder\`
HTML 解析：只能用字符串方法或正则

**你的调研工具（仅供你调研使用，绝不可出现在脚本代码中）**
- \`webFetch(url)\`：获取页面内容，用于了解当前页面结构
- \`webFetchBrowser(url)\`：无头浏览器，捕获 XHR/Fetch 请求
- \`webSearch(query)\`：搜索辅助信息
- \`validateScript(script)\`：在沙箱中验证脚本（**必须调用**）

⚠️ 脚本代码内部只能使用沙箱环境中列出的 API（\`fetch\`、\`URL\`、\`URLSearchParams\`），不能调用上述调研工具。

**步骤**
1. 用 webFetch 重新抓取页面，分析当前结构；SPA 骨架则改用 webFetchBrowser，分析 capturedRequests 中的 API 端点
2. 结合错误信息定位问题并修复；无数据返回 \`[]\`，禁止构造假数据兜底
3. 用 validateScript 验证，失败则重试（最多 3 次）

**注意（脚本以 JSON 字符串传输，以下两类写法会导致语法报错）**
- 正则中匹配字面 \`/\` 时用字符类 \`[/]\` 代替 \`\\/\`
- 字符串字面量中需要换行时写 \`\\n\` 转义，不要使用真实换行符`,
    defaultContent: '',
  },
  {
    id: 'analyze-subscription',
    name: '分析订阅数据',
    description: '引导智能体对订阅的消息卡片进行综合分析，生成 HTML 报告',
    content: `你是一个数据分析智能体。对订阅主题"{{topic}}"的 {{count}} 条内容进行深度分析。

监控条件：{{criteria}}
分析需求：{{analysisRequest}}

数据（JSON，含 url 字段）：
{{data}}

## 分析流程

1. **评估数据充分性**：先浏览所有卡片的标题和摘要，判断现有信息是否足够完成分析。
2. **按需获取原文**：如果某些关键条目的标题/摘要过于简略、缺乏具体数据或细节，使用 webFetch 工具抓取其 url 对应的原文内容，获取更详细的信息后再分析。只抓取对分析结论有关键影响的条目，建议不超过 5 个。
3. **生成报告**：综合所有信息（卡片数据 + 抓取到的原文内容）生成完整 HTML 报告。

## 报告要求

包含：执行摘要、内容趋势、值得关注的条目（用 \`<a href="url" target="_blank">\` 链接原文）、结论与建议。

格式：语义化 HTML + 内嵌 CSS；仅输出 HTML，不要加 \`\`\`html 代码块标记。`,
    defaultContent: '',
  },
];

export async function runMigrations() {
  const db = getDb();

  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  console.log('[DB] PostgreSQL migrations complete');

  await seedPromptTemplates(db);
  await seedSearchProvider(db);
  await seedRssInstance(db);
  await seedSourcePreferences(db);
}

async function seedSourcePreferences(db: ReturnType<typeof getDb>) {
  const now = new Date();
  for (const source of DEFAULT_SOURCE_PREFERENCES) {
    await db.insert(schema.sourcePreferences).values({ ...source, createdAt: now, updatedAt: now })
      .onConflictDoNothing({ target: schema.sourcePreferences.url });
  }
}

async function seedPromptTemplates(db: ReturnType<typeof getDb>) {
  for (const tpl of DEFAULT_PROMPT_TEMPLATES) {
    const [existing] = await db
      .select()
      .from(schema.promptTemplates)
      .where(eq(schema.promptTemplates.id, tpl.id));

    if (!existing) {
      await db
        .insert(schema.promptTemplates)
        .values({
          ...tpl,
          defaultContent: tpl.content,
          updatedAt: new Date(),
        })
        .onConflictDoNothing();
      continue;
    }

    const userCustomized = existing.content !== existing.defaultContent;
    await db
      .update(schema.promptTemplates)
      .set({
        defaultContent: tpl.content,
        name: tpl.name,
        description: tpl.description,
        updatedAt: new Date(),
        ...(userCustomized ? {} : { content: tpl.content }),
      })
      .where(eq(schema.promptTemplates.id, tpl.id));
  }

  console.log('[DB] Prompt templates seeded');
}

async function seedSearchProvider(db: ReturnType<typeof getDb>) {
  await db
    .insert(schema.searchProviderConfig)
    .values({
      id: 'default',
      provider: 'none',
      apiKey: '',
      updatedAt: new Date(),
    })
    .onConflictDoNothing();
}

async function seedRssInstance(db: ReturnType<typeof getDb>) {
  const [existing] = await db
    .select({ id: schema.rssInstances.id })
    .from(schema.rssInstances)
    .where(eq(schema.rssInstances.isActive, true))
    .limit(1);

  if (existing) return;

  const now = new Date();
  await db
    .insert(schema.rssInstances)
    .values({
      id: 'default-rsshub',
      name: 'RSSHub Official',
      baseUrl: 'https://rsshub.app',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();
}
