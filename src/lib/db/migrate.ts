import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { getDb } from './index';
import * as schema from './schema';

const MIGRATIONS_DIR = 'drizzle-pg';

const DEFAULT_PROMPT_TEMPLATES = [
  {
    id: 'find-sources',
    name: '查找订阅源',
    description: '引导智能体通过网络搜索，为给定主题找到合适的数据源',
    content: `为主题"{{topic}}"（监控条件：{{criteria}}）找到 5-10 个数据源。

**主题关键词：{{topicKeywords}}**

**工具调用限制**
- webSearch 最多 10 次
- checkFeed 可多次调用

**步骤**
1. webSearch：用多种关键词组合搜索候选 URL，**先广泛收集，不要在这一步挑三拣四**：
   - "{{topic}} RSS"、"{{topic}} feed"、"{{topic}} 行业网站"
   - "{{topic}} 新闻"、"{{topic}} 资讯"、"{{topic}} 最新"
   - 对实体类 topic，搜特定名称（如"中国皮革协会 新闻""中茶协 公告"）

2. checkFeed：把步骤 1 的所有候选 RSS URL 合并一次调用，传 urls 和 keywords。
   checkFeed 返回的 freshness 是**参考信息不是硬过滤条件**：
   - "活跃"/"较新" → 推荐源（recommended: true），在 description 里记下 freshness
   - "陈旧"/"非常陈旧"/"疑似死站" → **仍然保留**，但标记 recommended: false 并在 description 里如实注明"更新慢/可能已停更"
   - 只要 URL 可访问且含匹配关键词，就纳入候选，新鲜度只是加减分

3. rssRadar：对没有 RSS 的域名调用，有匹配路由就构造 URL 再 checkFeed 验证，没有路由就直接保留网页 URL

4. **如果收集到的有效源少于 5 个**：继续 webSearch 用不同关键词组合补搜，不要因为 freshness 差就扔掉

**输出（JSON 数组）**
每项：title、url（RSS 优先，没有就网页 URL）、description（内容特点+更新频率+checkFeed 返回的 freshness）、recommended（活跃+内容匹配 → true）。
底线：输出至少 3 个源，最好 5-10 个。如果整个领域偏冷门，就如实返回能找到的全部，包括更新慢的，不要返回空数组。`,
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
主题关键词：{{topicKeywords}}

**沙箱环境（isolated-vm V8，非 Node.js / 非浏览器）**
- 脚本入口：\`async function collect(): Promise<CollectedItem[]>\`，可带 export 前缀
- 可用：\`fetch(url, opts)\`（最多 5 次，opts 支持 method/headers/body）、\`URL\`、\`URLSearchParams\`
- 可用：\`TextDecoder\`/\`TextEncoder\`（字符编码）、\`atob\`/\`btoa\`（base64）、\`console.log\`
- 禁用：\`require\`/\`import\`、\`process\`/\`fs\`/\`Buffer\`、DOM API（DOMParser/document/window）、\`setTimeout\`
- HTML 解析：提供以下辅助函数（性能好、比手写正则更可靠），也可用字符串方法/正则

**HTML 解析辅助函数（推荐优先使用）**
\`\`\`
__htmlGetText(html)           → 去除标签、解码实体，返回纯文本
__htmlGetByTag(html, 'item') → 返回所有 <item> 元素的 innerHTML 字符串数组
__htmlGetAttr(tagStr, 'href') → 从标签字符串提取指定属性值
__htmlGetLinks(html)          → 返回 [{href, text}] 提取所有链接
__htmlGetElements(html, tag)  → 返回 [{text, html, attrs}] 完整元素数据
\`\`\`

**返回字段**
- 必填：\`title\`（string）、\`url\`（string）、\`publishedAt\`（**必填**，ISO 8601 字符串，**必须能从页面提取真实发布时间**）
- 建议：\`summary\`、\`thumbnailUrl\`
- 监控条件不为"无"时需加：\`criteriaResult\`（'matched'|'not_matched'|'invalid'）、\`metricValue\`
- 无数据返回 \`[]\`，禁止构造假数据兜底；所有 fetch URL 必须限于 \`{{domain}}\` 域名

**主题相关性过滤（**硬性**要求）**
- 主题关键词不为"无"时，**必须在脚本中硬编码关键词列表**，对每条采集结果的 title + summary 做关键词匹配
- **完全不在关键词命中范围内的条目直接 filter 掉，不返回**，不要靠 criteriaResult 标记来兜底
- 一个条目里命中任意一个关键词即视为相关（OR 逻辑）
- 如果全都不相关，返回 \`[]\`，不要为了凑数返回无关条目

**时间新鲜度过滤（**硬性**要求）**
- **每条返回的 item 必须能提取出发布时间（pubDate / datetime / 时间戳）**
- **默认丢弃早于 90 天的条目**（行业资讯类典型更新周期）
  - 真·实时新闻站点（财经快讯、政策速递）应能保持 90 天内大量更新，过期内容无价值
  - 协会/政府/期刊类站点更新慢，90 天已属宽容
- 如果页面里某条 item 找不到时间，**该条丢弃**，不要猜测时间
- 优先从 RSS/Atom 的 \`<pubDate>\`、HTML 的 \`<time datetime="...">\`、\`[data-time]\`、\`datetime="..."\` 等结构化字段提取
- 中文日期格式（"2024年03月15日" / "3小时前" / "昨天"）也要识别，自己写正则解析

**源停滞检测（重要）**
- 脚本里先收集所有候选 item（不过滤时间），用 \`console.log('raw_count=' + rawItems.length)\` 记录
- 计算所有候选里 \`newestDate\`（最大 publishedAt）
- 如果 \`newestDate\` 距今 **超过 180 天**，视为**源已停滞**：
  - 在脚本里 \`console.log('STALE_SOURCE_DETECTED latest=' + newestDate.toISOString())\`
  - **仍然返回 \`[]\`**（不要把 8 年前的旧数据塞进信息池）
  - 错误信息会附带上 STALE_SOURCE_DETECTED 标记，admin 端会知道这个源该废弃
- 区分两种零结果：
  - 抓得到但全陈旧 → 源停滞
  - 抓不到或全是无效数据 → 脚本或选择器有问题

**避免误抓"历史/热门"内容**
- 很多新闻站首页会同时展示"最新"和"热门/排行/推荐"两个区块，**只抓取"最新"区块**
- 警惕"全部时间""按热度排序"等列表，只抓"按发布时间倒序"的列表
- 警惕 sitemap / archive 页面（包含全部历史文章），不要把它们当数据源
- 如果一个 URL 看起来像归档页（如 \`/archive/\`、\`/page/2\`），改用 RSS 或"最新 N 条"接口

**失败策略阶梯（必须遵守，禁止死循环）**
- 当 validateScript 返回 failureHint 时，它已明确告诉你失败类型和正确策略：FETCH_FAILED→立即用 webFetchBrowser 或 rssRadar 找替代入口；ANTI_CRAWL→立即改用 webFetchBrowser 分析 capturedRequests 找 JSON API；EMPTY_RESULT→用 webFetchBrowser 看实际 HTML 结构；DEAD_SOURCE→该源已死（验证码/WAF/域名停售），立即放弃不要挣扎。关键规则：同一轮 validateScript 返回 failureHint 后，下一轮必须调用 webFetchBrowser 或 rssRadar，禁止再用同样的 fetch 方案。DEAD_SOURCE 时直接返回 [] 结束
- validateScript 跑出很多条但 publishedAt 缺失时，**必须**回脚本里修日期提取逻辑，而不是删数据
- 所有方案都失败 → 承认该源无法采集，返回 []，不要兜圈重试

**你的调研工具（仅供你在生成脚本前调研使用，绝不可出现在脚本代码中）**
- \`webFetch(url)\`：获取页面/Feed 内容，用于了解页面结构
- \`webFetchBrowser(url)\`：无头浏览器，捕获 XHR/Fetch 请求（适合 SPA 或被反爬页面）
- \`webSearch(query)\`：搜索 API 文档、实体 ID 等辅助信息
- \`rssRadar(queries)\`：查询现有 RSS 路由
- \`validateScript(script)\`：在沙箱中验证脚本（**必须调用**）

⚠️ 脚本代码内部只能使用沙箱环境中列出的 API（\`fetch\`、\`URL\`、\`URLSearchParams\`、\`TextDecoder\`、\`atob\`、\`__htmlGetText\` 等 HTML 辅助函数），不能调用 \`webFetch\`、\`webFetchBrowser\`、\`webSearch\`、\`rssRadar\` 等调研工具。

**工作流程**
1. 用 webFetch 抓取目标 URL，判断内容类型：
   - 含 \`<rss\`/\`<feed\`/\`<item\`/\`<entry\` → **优先用 RSS/Atom 解析**（自带正确时间，无反爬，最稳定）
   - HTML 页面 → 优先用 __htmlGetElements / __htmlGetLinks / __htmlGetByTag 提取结构化数据；也可调用 rssRadar 找 RSS 路由
   - 返回空/失败/反爬 → 改用 webFetchBrowser，优先分析 capturedRequests 中的 API 端点
2. fetch 可传 \`{headers: {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'}}\` 应对反爬，可传 \`{method: 'POST', body: '...'}\` 请求 API
3. **调用 validateScript 前，务必在脚本开头加 console.log 打印 fetch 返回的关键信息**，如响应的前 500 字符、status、content-type。这样验证失败时你能看到实际返回了什么，精确定位问题而不是盲目重试。
4. validateScript 跑出 0 条：先看 console.log 输出 → 是空 HTML / 反爬 / 结构变了 → 改用 webFetchBrowser 或修选择器
5. validateScript 跑出条目但 publishedAt 全空：**别**接受这个结果，**必须**改脚本提取时间

**RSS/Atom 解析示例（直接抄，自带正确时间）**
\`\`\`javascript
async function collect() {
  var r = await fetch('https://example.com/feed');
  var xml = await r.text();
  console.log('status=' + r.status + ' content-type=' + r.headers['content-type'] + ' len=' + xml.length);
  var items = __htmlGetByTag(xml, 'item');
  if (items.length === 0) items = __htmlGetByTag(xml, 'entry');
  var topicKeywords = ['关键词1', '关键词2'];  // 硬编码主题关键词
  var cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;  // 90 天前
  return items.map(function(item) {
    var titles = __htmlGetByTag(item, 'title');
    var links = __htmlGetByTag(item, 'link');
    var dates = __htmlGetByTag(item, 'pubDate').concat(__htmlGetByTag(item, 'published'));
    var title = titles.length > 0 ? __htmlGetText(titles[0]) : '';
    var url = links.length > 0 ? __htmlGetText(links[0]) : '';
    if (!url && links.length > 0) url = __htmlGetAttr(links[0].replace(/^<link[^>]*/, ''), 'href') || '';
    var publishedAt = dates.length > 0 ? new Date(__htmlGetText(dates[0])).toISOString() : '';
    return { title: title, url: url, summary: '', publishedAt: publishedAt };
  })
  .filter(function(i) { return i.title && i.url && i.publishedAt; })  // 必须有发布时间
  .filter(function(i) { var t = new Date(i.publishedAt).getTime(); return t >= cutoff; })  // 90 天内
  .filter(function(i) {  // 主题关键词命中
    var text = (i.title + ' ' + (i.summary || '')).toLowerCase();
    return topicKeywords.some(function(kw) { return text.indexOf(kw.toLowerCase()) >= 0; });
  });
}
\`\`\`

**HTML 页面解析示例（直接抄）**
\`\`\`javascript
async function collect() {
  var r = await fetch('https://example.com/news', {
    headers: {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'}
  });
  var html = await r.text();
  console.log('status=' + r.status + ' len=' + html.length);
  // 优先用 class 选择器，避开 article → li → div 这种宽匹配
  // 找网页里"最新文章"区块的容器类名（先观察 webFetch 结果再定）
  var articles = __htmlGetElements(html, 'div');  // 这里要改成具体的类名容器，如 __htmlGetByTag(html, 'div class="news-item"')
  var topicKeywords = ['关键词1', '关键词2'];
  var cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
  var staleCutoff = Date.now() - 180 * 24 * 60 * 60 * 1000;  // 停滞阈值
  var raw = articles.map(function(el) {
    var links = __htmlGetLinks(el.html);
    var url = links.length > 0 ? links[0].href : '';
    var title = links.length > 0 ? links[0].text : el.text.slice(0, 100);
    // 从 <time datetime> 提取时间，没有就丢弃这条
    var timeMatch = el.html.match(/<time[^>]+datetime=["']([^"']+)["']/i);
    if (!timeMatch) timeMatch = el.html.match(/datetime=["']([^"']+)["']/i);
    var publishedAt = timeMatch ? new Date(timeMatch[1]).toISOString() : '';
    return { title: title, url: url, summary: el.text.slice(0, 200), publishedAt: publishedAt };
  });
  console.log('raw_count=' + raw.length);
  // 检测源停滞
  var newestTs = 0;
  for (var i = 0; i < raw.length; i++) {
    if (raw[i].publishedAt) {
      var t = new Date(raw[i].publishedAt).getTime();
      if (t > newestTs) newestTs = t;
    }
  }
  if (newestTs > 0 && newestTs < staleCutoff) {
    console.log('STALE_SOURCE_DETECTED latest=' + new Date(newestTs).toISOString());
    return [];
  }
  return raw
    .filter(function(i) { return i.title && i.url && i.publishedAt; })
    .filter(function(i) { var t = new Date(i.publishedAt).getTime(); return t >= cutoff; })
    .filter(function(i) {
      var text = (i.title + ' ' + (i.summary || '')).toLowerCase();
      return topicKeywords.some(function(kw) { return text.indexOf(kw.toLowerCase()) >= 0; });
    });
}
\`\`\`

**常见 JavaScript 陷阱（务必遵守）**
- \`continue\` / \`break\` 只能出现在 for/while 循环体内，不能出现在 if/函数顶层
- 同一作用域内禁止用 \`const\` / \`let\` 重复声明同名变量；在循环/分支中推荐用 \`var\`
- 确保所有 \`{}\`、\`[]\`、\`()\` 成对闭合，不要截断脚本
- 函数声明不要丢末尾的 \`}\`
- 模板字符串用 \`\`\` 而不是 \`"\` 以避免 JSON 转义混乱
- 禁止在正则字面量中使用未转义的 \`/\`（如匹配 URL 用 \`[/]\` 代替 \`/\`）

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
主题关键词：{{topicKeywords}}

脚本：
\`\`\`javascript
{{script}}
\`\`\`

采集结果（前 5 条）：
\`\`\`json
{{items}}
\`\`\`

**数据质量统计（系统预计算）**
\`\`\`json
{{qualityStats}}
\`\`\`
- \`itemsWithDate\`：有 publishedAt 的条目数（应有 publishedAt = 100%）
- \`itemsWithin30Days\`：发布时间在 30 天内的条目数（实时新闻站应接近 100%）
- \`itemsWithin90Days\`：发布时间在 90 天内的条目数（行业资讯站可放宽到此）
- \`itemsWithin7Days\`：发布时间在 7 天内的条目数
- \`oldestDate\` / \`newestDate\`：采集结果的时间范围
- \`daysSinceNewest\`：最新条目距今多少天
- \`itemsOnTopic\` / \`onTopicRatio\`：主题关键词命中的条目数和比例
- \`freshRatio30\` / \`freshRatio90\`：30/90 天内条目占比
- \`appearsStale\`：true 表示最新条目已超过 180 天，**该源可能已停更**，应建议 admin 废弃

**CollectedItem 返回字段格式**
- \`title\`（必填，string）：条目标题
- \`url\`（必填，string）：条目详情链接
- \`publishedAt\`（**必填**，ISO 8601 字符串）：发布时间，如 "2024-03-15T10:30:00Z" 或 "2024-03-15T18:30:00+08:00"
- \`summary\`（可选，string）：内容摘要
- \`thumbnailUrl\`（可选，string）：封面图片 URL
- \`criteriaResult\`（监控条件不为"无"时必填）：'matched' | 'not_matched' | 'invalid'
- \`metricValue\`（监控条件不为"无"时建议）：提取的监控指标原始值（如 "¥299"、"98%"、"5000+"）

**审查步骤**
1. 时间新鲜度（**硬性**）：
   - \`itemsWithDate < totalItems\`：脚本没提取时间，必须修
   - \`itemsWithin30Days < totalItems\` 且 \`itemsWithin90Days === totalItems\`：有 30-90 天数据但无 30 天内，**可接受**（行业资讯常态）
   - \`itemsWithin90Days < totalItems\`：存在 > 90 天内容，**必须**在脚本里加强时间过滤
   - \`appearsStale === true\`：源已停更超过 180 天，**不要修改脚本**，直接在 reason 里写"源已停更，建议废弃"
2. 主题相关性（**硬性**）：
   - 主题关键词不为"无"且 \`onTopicRatio < 0.7\`：超过 30% 条目不相关，必须在脚本里加强关键词过滤
3. 代码质量：
   - 有无假数据兜底？无数据应返回 \`[]\`
   - \`publishedAt\` 必须能从页面提取（不是脚本生成时填的）
   - fetch 是否使用了 headers 应对反爬？是否正确地用了 DOMAIN 过滤？
   - 是否优先使用了 __htmlGetElements / __htmlGetLinks 等辅助函数（比手写正则更可靠）？
   - 监控条件不为"无"时是否正确实现 \`criteriaResult\`/\`metricValue\`？
4. 数据真实性：用 webFetch 抓取前 2 条 URL，确认可访问且页面内容与 title 吻合

**输出**
\`\`\`json
{"valid": true, "reason": "简明说明（30字以内）"}
\`\`\`
valid=false 且可修复时，在 JSON 块后附完整修复脚本（必须保留主题关键词过滤 + 30 天新鲜度过滤 + publishedAt 提取）。`,
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
可用：\`fetch(url, opts)\`（最多 5 次，opts 支持 method/headers/body）、\`URL\`、\`URLSearchParams\`
可用：\`TextDecoder\`/\`TextEncoder\`、\`atob\`/\`btoa\`、\`console.log\`
禁用：\`require\`/\`import\`、\`process\`/\`fs\`/\`Buffer\`、DOM API、\`setTimeout\`
HTML 解析辅助：\`__htmlGetText\`、\`__htmlGetByTag\`、\`__htmlGetAttr\`、\`__htmlGetLinks\`、\`__htmlGetElements\`

**你的调研工具（仅供你调研使用，绝不可出现在脚本代码中）**
- \`webFetch(url)\`：获取页面内容，用于了解当前页面结构
- \`webFetchBrowser(url)\`：无头浏览器，捕获 XHR/Fetch 请求
- \`webSearch(query)\`：搜索辅助信息
- \`validateScript(script)\`：在沙箱中验证脚本（**必须调用**）

⚠️ 脚本代码内部只能使用沙箱环境中列出的 API（\`fetch\`、\`URL\`、\`URLSearchParams\`、\`TextDecoder\`、\`atob\`、\`__htmlGetText\` 等 HTML 辅助函数），不能调用上述调研工具。

**步骤**
1. 用 webFetch 重新抓取页面，分析当前结构；SPA 骨架则改用 webFetchBrowser
2. 推荐用 __htmlGetElements / __htmlGetLinks 等辅助函数提取结构化数据
3. 结合错误信息定位问题并修复；无数据返回 \`[]\`，禁止构造假数据兜底
4. 用 validateScript 验证，失败则重试（最多 3 次）

**常见 JavaScript 陷阱（务必遵守）**
- \`continue\` / \`break\` 只能出现在 for/while 循环体内，不能出现在 if/函数顶层
- 同一作用域内禁止用 \`const\` / \`let\` 重复声明同名变量；在循环/分支中推荐用 \`var\`
- 确保所有 \`{}\`、\`[]\`、\`()\` 成对闭合，不要截断脚本
- 函数声明不要丢末尾的 \`}\`

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
