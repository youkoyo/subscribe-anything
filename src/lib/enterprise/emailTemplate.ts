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
  deliveryMode?: 'new' | 'previous' | 'empty';
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderIndustryDeliveryEmail(input: RenderIndustryDeliveryEmailInput) {
  const deliveryMode = input.deliveryMode ?? 'new';
  const subjectPrefix =
    deliveryMode === 'new'
      ? `${input.industryName}产业信息早报`
      : `${input.industryName}产业信息状态`;
  const subject = `${subjectPrefix}｜${input.profileTitle}｜${input.dateLabel}`;
  const intro =
    deliveryMode === 'new'
      ? `本次为你筛选出 ${input.items.length} 条与「${escapeHtml(input.customCriteria)}」相关的产业信息。`
      : deliveryMode === 'previous'
        ? `本周期暂无高相关新增信息。以下为已报送过的持续关注信息，供你复核。`
        : `本周期暂无高相关新增信息，订阅仍在运行。当前没有可重复展示的信息。`;
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
  const table = input.items.length > 0
    ? `
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
      `
    : '';

  const html = `
    <!doctype html>
    <html>
      <body style="font-family:Arial,'Microsoft YaHei',sans-serif;color:#0f172a;line-height:1.6;">
        <h2>${escapeHtml(subject)}</h2>
        <p>${intro}</p>
        ${table}
        <p style="margin-top:20px;color:#64748b;font-size:12px;">此邮件由系统自动发送，请勿直接回复。</p>
      </body>
    </html>
  `;

  const text = [
    subject,
    deliveryMode === 'new'
      ? `本次为你筛选出 ${input.items.length} 条与「${input.customCriteria}」相关的产业信息。`
      : deliveryMode === 'previous'
        ? '本周期暂无高相关新增信息。以下为已报送过的持续关注信息，供你复核。'
        : '本周期暂无高相关新增信息，订阅仍在运行。当前没有可重复展示的信息。',
    ...input.items.map((item, index) =>
      `${index + 1}. ${item.title}\n来源：${item.sourceName}\n权威性：${item.authorityLabel}，相关性：${item.relevanceLabel}\n概要：${item.summary}\n原因：${item.reason}\n链接：${item.url}`
    ),
  ].join('\n\n');

  return { subject, html, text };
}

export interface DeliveryDigestSection {
  industryName: string;
  customCriteria: string;
  deliveryMode: 'new' | 'previous' | 'empty';
  totalItemCount: number;
  items: DeliveryEmailItem[];
}

export interface RenderIndustryDigestEmailInput {
  dateLabel: string;
  sections: DeliveryDigestSection[];
  summaryLimitPerIndustry?: number;
}

export interface IndustryDigestExcelAttachment {
  filename: string;
  content: string;
  contentType: string;
}

function modeLabel(value: DeliveryDigestSection['deliveryMode']) {
  if (value === 'new') return '新增';
  if (value === 'previous') return '已报送继续关注';
  return '暂无可展示信息';
}

function renderDigestRows(items: DeliveryEmailItem[]) {
  const tableWidth = 920;
  const columnWidths = {
    index: 56,
    title: 430,
    source: 128,
    authority: 74,
    relevance: 74,
    publishedAt: 130,
  };
  const headerCell =
    'padding:10px 8px;border:1px solid #cbd5e1;background:#eef2f7;color:#0f172a;font-weight:700;white-space:nowrap;word-break:keep-all;text-align:center;';
  const bodyCell =
    'padding:10px 8px;border:1px solid #d8dee9;color:#0f172a;vertical-align:top;white-space:normal;word-break:normal;word-wrap:break-word;overflow-wrap:break-word;';
  const compactCell = `${bodyCell}white-space:nowrap;word-break:keep-all;text-align:center;`;

  const rows = items
    .map((item, index) => {
      const title = item.url
        ? `<a href="${escapeHtml(item.url)}" style="color:#1d4ed8;text-decoration:none;font-weight:700;">${escapeHtml(item.title)}</a>`
        : `<strong>${escapeHtml(item.title)}</strong>`;
      return `
        <tr>
          <td width="${columnWidths.index}" style="width:${columnWidths.index}px;min-width:${columnWidths.index}px;${compactCell}">${index + 1}</td>
          <td width="${columnWidths.title}" style="width:${columnWidths.title}px;min-width:${columnWidths.title}px;${bodyCell}">
            <div style="width:${columnWidths.title}px;min-width:${columnWidths.title}px;white-space:normal;word-break:normal;word-wrap:break-word;overflow-wrap:break-word;mso-line-height-rule:exactly;">
              ${title}
              <div style="margin-top:6px;color:#475569;font-size:12px;line-height:1.5;">${escapeHtml(item.summary)}</div>
              <div style="margin-top:6px;color:#64748b;font-size:12px;line-height:1.5;">${escapeHtml(item.reason)}</div>
            </div>
          </td>
          <td width="${columnWidths.source}" style="width:${columnWidths.source}px;min-width:${columnWidths.source}px;${bodyCell}">${escapeHtml(item.sourceName)}</td>
          <td width="${columnWidths.authority}" style="width:${columnWidths.authority}px;min-width:${columnWidths.authority}px;${compactCell}">${escapeHtml(item.authorityLabel)}</td>
          <td width="${columnWidths.relevance}" style="width:${columnWidths.relevance}px;min-width:${columnWidths.relevance}px;${compactCell}">${escapeHtml(item.relevanceLabel)}</td>
          <td width="${columnWidths.publishedAt}" style="width:${columnWidths.publishedAt}px;min-width:${columnWidths.publishedAt}px;${compactCell}">${escapeHtml(item.publishedAtLabel)}</td>
        </tr>
      `;
    })
    .join('');

  return `
    <table width="${tableWidth}" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;table-layout:fixed;width:${tableWidth}px;min-width:${tableWidth}px;font-size:13px;line-height:1.5;margin-top:10px;mso-table-lspace:0pt;mso-table-rspace:0pt;">
      <colgroup>
        <col width="${columnWidths.index}" style="width:${columnWidths.index}px;" />
        <col width="${columnWidths.title}" style="width:${columnWidths.title}px;" />
        <col width="${columnWidths.source}" style="width:${columnWidths.source}px;" />
        <col width="${columnWidths.authority}" style="width:${columnWidths.authority}px;" />
        <col width="${columnWidths.relevance}" style="width:${columnWidths.relevance}px;" />
        <col width="${columnWidths.publishedAt}" style="width:${columnWidths.publishedAt}px;" />
      </colgroup>
      <thead>
        <tr>
          <th width="${columnWidths.index}" style="width:${columnWidths.index}px;min-width:${columnWidths.index}px;${headerCell}">序号</th>
          <th width="${columnWidths.title}" style="width:${columnWidths.title}px;min-width:${columnWidths.title}px;${headerCell}text-align:left;">标题与摘要</th>
          <th width="${columnWidths.source}" style="width:${columnWidths.source}px;min-width:${columnWidths.source}px;${headerCell}">信息来源</th>
          <th width="${columnWidths.authority}" style="width:${columnWidths.authority}px;min-width:${columnWidths.authority}px;${headerCell}">权威性</th>
          <th width="${columnWidths.relevance}" style="width:${columnWidths.relevance}px;min-width:${columnWidths.relevance}px;${headerCell}">相关性</th>
          <th width="${columnWidths.publishedAt}" style="width:${columnWidths.publishedAt}px;min-width:${columnWidths.publishedAt}px;${headerCell}">发布时间</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

export function renderIndustryDigestEmail(input: RenderIndustryDigestEmailInput) {
  const summaryLimit = input.summaryLimitPerIndustry ?? 3;
  const totalIndustryCount = input.sections.length;
  const totalItemCount = input.sections.reduce((sum, section) => sum + section.totalItemCount, 0);
  const subject = `星云棱镜产业信息早报 | ${input.dateLabel}`;

  const sectionBlocks = input.sections
    .map((section, index) => {
      const visibleItems = section.items.slice(0, summaryLimit);
      const tableOrStatus =
        visibleItems.length > 0
          ? renderDigestRows(visibleItems)
          : '<p style="margin:8px 0 0;color:#64748b;">本周期暂无可展示信息，订阅仍在运行。</p>';
      return `
        <section style="margin-top:24px;">
          <h3 style="margin:0 0 6px;font-size:18px;line-height:1.4;color:#0f172a;">${index + 1}. ${escapeHtml(section.industryName)}产业信息</h3>
          <p style="margin:0;color:#64748b;font-size:13px;">条件：${escapeHtml(section.customCriteria)}；状态：${modeLabel(section.deliveryMode)}；本产业 ${section.totalItemCount} 条。</p>
          ${tableOrStatus}
        </section>
      `;
    })
    .join('');

  const html = `
    <!doctype html>
    <html>
      <body style="font-family:Arial,'Microsoft YaHei',sans-serif;color:#0f172a;line-height:1.6;margin:0;padding:0;background:#ffffff;">
        <div style="width:960px;max-width:960px;margin:0 auto;padding:24px 18px;">
          <h2 style="margin:0 0 12px;font-size:22px;line-height:1.35;">${escapeHtml(subject)}</h2>
          <p style="margin:0 0 12px;">各位领导同事好，</p>
          <p style="margin:0;color:#334155;">今日星云棱镜为你汇总 ${totalIndustryCount} 个产业订阅，共 ${totalItemCount} 条产业信息；正文每个产业最多展示 Top${summaryLimit}，完整明细见附件。</p>
          ${sectionBlocks}
          <p style="margin-top:24px;color:#64748b;font-size:12px;">此邮件由系统自动发送，请勿直接回复。</p>
        </div>
      </body>
    </html>
  `;

  const text = [
    subject,
    `今日星云棱镜为你汇总 ${totalIndustryCount} 个产业订阅，共 ${totalItemCount} 条产业信息；正文每个产业最多展示 Top${summaryLimit}，完整明细见附件。`,
    ...input.sections.flatMap((section, sectionIndex) => [
      `${sectionIndex + 1}. ${section.industryName}产业信息（${modeLabel(section.deliveryMode)}，${section.totalItemCount} 条）`,
      ...section.items.slice(0, summaryLimit).map((item, itemIndex) =>
        `${itemIndex + 1}. ${item.title}\n来源：${item.sourceName}\n权威性：${item.authorityLabel}，相关性：${item.relevanceLabel}\n发布时间：${item.publishedAtLabel}\n摘要：${item.summary}\n原因：${item.reason}\n链接：${item.url}`
      ),
    ]),
  ].join('\n\n');

  return { subject, html, text };
}

function excelCell(value: string | number, style = 'Body') {
  return `<Cell ss:StyleID="${style}"><Data ss:Type="String">${escapeHtml(String(value)).replace(/\r?\n/g, '&#10;')}</Data></Cell>`;
}

export function renderIndustryDigestExcelAttachment(
  input: Pick<RenderIndustryDigestEmailInput, 'dateLabel' | 'sections'>
): IndustryDigestExcelAttachment {
  const rows = [
    ['产业名称', '订阅条件', '状态', '标题', '摘要', '来源', '权威性', '相关性', '发布时间', '匹配原因', '链接'],
    ...input.sections.flatMap((section) =>
      section.items.map((item) => [
        section.industryName,
        section.customCriteria,
        modeLabel(section.deliveryMode),
        item.title,
        item.summary,
        item.sourceName,
        item.authorityLabel,
        item.relevanceLabel,
        item.publishedAtLabel,
        item.reason,
        item.url,
      ])
    ),
  ];
  const bodyRows = rows
    .map(
      (row, index) =>
        `<Row ss:AutoFitHeight="1">${row
          .map((cell) => excelCell(cell, index === 0 ? 'Header' : 'Body'))
          .join('')}</Row>`
    )
    .join('');

  return {
    filename: `星云棱镜产业信息明细-${input.dateLabel}.xls`,
    contentType: 'application/vnd.ms-excel; charset=utf-8',
    content: `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:o="urn:schemas-microsoft-com:office:office"
  xmlns:x="urn:schemas-microsoft-com:office:excel"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Styles>
    <Style ss:ID="Header">
      <Font ss:FontName="Microsoft YaHei" ss:Bold="1" ss:Color="#0F172A"/>
      <Interior ss:Color="#EAF1F8" ss:Pattern="Solid"/>
      <Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/>
      <Borders>
        <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
        <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
        <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
        <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
      </Borders>
    </Style>
    <Style ss:ID="Body">
      <Font ss:FontName="Microsoft YaHei" ss:Color="#0F172A"/>
      <Alignment ss:Vertical="Top" ss:WrapText="1"/>
      <Borders>
        <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D8DEE9"/>
        <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D8DEE9"/>
        <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D8DEE9"/>
        <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D8DEE9"/>
      </Borders>
    </Style>
  </Styles>
  <Worksheet ss:Name="产业信息明细">
    <Table ss:ExpandedColumnCount="11" ss:ExpandedRowCount="${rows.length}" x:FullColumns="1" x:FullRows="1" ss:DefaultRowHeight="48">
      <Column ss:Width="110"/>
      <Column ss:Width="220"/>
      <Column ss:Width="120"/>
      <Column ss:Width="260"/>
      <Column ss:Width="420"/>
      <Column ss:Width="140"/>
      <Column ss:Width="70"/>
      <Column ss:Width="70"/>
      <Column ss:Width="130"/>
      <Column ss:Width="360"/>
      <Column ss:Width="300"/>
      ${bodyRows}
    </Table>
    <WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel">
      <FreezePanes/>
      <FrozenNoSplit/>
      <SplitHorizontal>1</SplitHorizontal>
      <TopRowBottomPane>1</TopRowBottomPane>
      <ActivePane>2</ActivePane>
    </WorksheetOptions>
  </Worksheet>
</Workbook>`,
  };
}
