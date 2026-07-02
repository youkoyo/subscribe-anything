export interface DeliveryEmailItem {
  title: string;
  sourceName: string;
  authorityLabel: string;
  relevanceLabel: string;
  publishedAtLabel: string;
  summary: string;
  url: string;
  reason: string;
}

export interface RenderIndustryDeliveryEmailInput {
  industryName: string;
  profileTitle: string;
  customCriteria: string;
  dateLabel: string;
  items: DeliveryEmailItem[];
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderIndustryDeliveryEmail(input: RenderIndustryDeliveryEmailInput) {
  const subject = `${input.industryName}产业信息早报｜${input.profileTitle}｜${input.dateLabel}`;
  const rows = input.items
    .map((item, index) => `
      <tr>
        <td style="padding:8px;border:1px solid #d8dee9;">${index + 1}</td>
        <td style="padding:8px;border:1px solid #d8dee9;"><a href="${escapeHtml(item.url)}">${escapeHtml(item.title)}</a></td>
        <td style="padding:8px;border:1px solid #d8dee9;">${escapeHtml(item.sourceName)}</td>
        <td style="padding:8px;border:1px solid #d8dee9;">${escapeHtml(item.authorityLabel)}</td>
        <td style="padding:8px;border:1px solid #d8dee9;">${escapeHtml(item.relevanceLabel)}</td>
        <td style="padding:8px;border:1px solid #d8dee9;">${escapeHtml(item.publishedAtLabel)}</td>
        <td style="padding:8px;border:1px solid #d8dee9;">${escapeHtml(item.summary)}<br/><span style="color:#64748b;">${escapeHtml(item.reason)}</span></td>
      </tr>
    `)
    .join('');

  const html = `
    <!doctype html>
    <html>
      <body style="font-family:Arial,'Microsoft YaHei',sans-serif;color:#0f172a;line-height:1.6;">
        <h2>${escapeHtml(subject)}</h2>
        <p>本次为你筛选出 ${input.items.length} 条与「${escapeHtml(input.customCriteria)}」相关的产业信息。</p>
        <table style="border-collapse:collapse;width:100%;font-size:14px;">
          <thead>
            <tr style="background:#f1f5f9;">
              <th style="padding:8px;border:1px solid #d8dee9;">序号</th>
              <th style="padding:8px;border:1px solid #d8dee9;">标题</th>
              <th style="padding:8px;border:1px solid #d8dee9;">来源</th>
              <th style="padding:8px;border:1px solid #d8dee9;">权威性</th>
              <th style="padding:8px;border:1px solid #d8dee9;">相关性</th>
              <th style="padding:8px;border:1px solid #d8dee9;">发布时间</th>
              <th style="padding:8px;border:1px solid #d8dee9;">概要</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <p style="margin-top:20px;color:#64748b;font-size:12px;">此邮件由系统自动发送，请勿直接回复。</p>
      </body>
    </html>
  `;

  const text = [
    subject,
    `本次为你筛选出 ${input.items.length} 条与「${input.customCriteria}」相关的产业信息。`,
    ...input.items.map((item, index) =>
      `${index + 1}. ${item.title}\n来源：${item.sourceName}\n权威性：${item.authorityLabel}，相关性：${item.relevanceLabel}\n概要：${item.summary}\n原因：${item.reason}\n链接：${item.url}`
    ),
  ].join('\n\n');

  return { subject, html, text };
}
