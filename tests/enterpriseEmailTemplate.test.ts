import assert from 'node:assert/strict';
import test from 'node:test';
import {
  renderIndustryDeliveryEmail,
  renderIndustryDigestExcelAttachment,
  renderIndustryDigestEmail,
} from '../src/lib/enterprise/emailTemplate';

test('renderIndustryDeliveryEmail includes summary and table rows', () => {
  const email = renderIndustryDeliveryEmail({
    industryName: '食品安全',
    profileTitle: '法规政策监控',
    customCriteria: '食品安全管理条例相关',
    dateLabel: '2026-07-02',
    items: [
      {
        title: '市场监管总局发布食品安全管理条例修订说明',
        sourceName: '市场监管总局',
        authorityLabel: '高',
        relevanceLabel: '高',
        publishedAtLabel: '2026-07-02 09:00',
        summary: '涉及食品安全管理条例和监管执行要求。',
        url: 'https://example.com/a',
        reason: '与管理条例高度相关',
      },
    ],
  });

  assert.match(email.subject, /食品安全产业信息/);
  assert.match(email.html, /<table/);
  assert.match(email.html, /市场监管总局发布食品安全管理条例修订说明/);
  assert.match(email.text, /与管理条例高度相关/);
});

test('renderIndustryDeliveryEmail describes an empty criterion as the whole industry pool', () => {
  const email = renderIndustryDeliveryEmail({
    industryName: '鞋业',
    profileTitle: '鞋业信息池',
    customCriteria: '',
    dateLabel: '2026-07-14',
    items: [],
  });

  assert.match(email.html, /整个产业信息池/);
  assert.match(email.text, /整个产业信息池/);
});

test('renderIndustryDigestEmail groups industries with stable readable table widths', () => {
  const email = renderIndustryDigestEmail({
    dateLabel: '2026-07-08',
    summaryLimitPerIndustry: 3,
    sections: [
      {
        industryName: '纺织/鞋帽针织',
        customCriteria: '关注纺织行业政策和安全风险',
        deliveryMode: 'new',
        totalItemCount: 4,
        items: [
          {
            title: '纺织企业安全生产检查通报',
            sourceName: '行业监管部门',
            authorityLabel: '高',
            relevanceLabel: '高',
            publishedAtLabel: '2026-07-08 09:00',
            summary: '多地开展纺织企业安全生产专项检查。',
            url: 'https://example.com/textile',
            reason: '命中安全事件：检查、整改；综合评分 86',
          },
        ],
      },
      {
        industryName: '粮食小作坊',
        customCriteria: '关注粮食加工小作坊监管信息',
        deliveryMode: 'previous',
        totalItemCount: 1,
        items: [
          {
            title: '粮食加工小作坊食品安全提醒',
            sourceName: '市场监管局',
            authorityLabel: '高',
            relevanceLabel: '中',
            publishedAtLabel: '2026-07-08 10:00',
            summary: '监管部门发布食品安全风险提醒。',
            url: 'https://example.com/grain',
            reason: '已在上一封邮件中报送，本次继续关注；综合评分 72',
          },
        ],
      },
    ],
  });

  assert.match(email.subject, /星云棱镜产业信息早报/);
  assert.match(email.html, /纺织\/鞋帽针织产业信息/);
  assert.match(email.html, /粮食小作坊产业信息/);
  assert.match(email.html, /table-layout:fixed/);
  assert.match(email.html, /width="920"/);
  assert.match(email.html, /width="430"/);
  assert.match(email.html, /min-width:430px/);
  assert.match(email.html, /mso-table-lspace:0pt/);
  assert.match(email.html, /完整明细见附件/);
  assert.match(email.text, /共 5 条产业信息/);
});

test('renderIndustryDigestExcelAttachment exports readable Excel detail rows with fixed widths', () => {
  const excel = renderIndustryDigestExcelAttachment({
    dateLabel: '2026-07-08',
    sections: [
      {
        industryName: '化工原料',
        customCriteria: '关注化工企业安全事故',
        deliveryMode: 'new',
        totalItemCount: 2,
        items: [
          {
            title: '山东一化工厂发生危化品泄漏',
            sourceName: '化工行业观察',
            authorityLabel: '中',
            relevanceLabel: '高',
            publishedAtLabel: '2026-07-08 09:00',
            summary: '事故导致上游原料供应偏紧。',
            url: 'https://example.com/chemical',
            reason: '命中安全事件：泄漏；综合评分 90',
          },
          {
            title: 'MMA 市场报价上调',
            sourceName: '市场资讯',
            authorityLabel: '中',
            relevanceLabel: '高',
            publishedAtLabel: '2026-07-08 10:00',
            summary: '丙烯酸供应偏紧。',
            url: 'https://example.com/mma',
            reason: '命中用户条件：MMA、丙烯酸；综合评分 84',
          },
        ],
      },
    ],
  });

  assert.equal(excel.filename, '星云棱镜产业信息明细-2026-07-08.xls');
  assert.equal(excel.contentType, 'application/vnd.ms-excel; charset=utf-8');
  assert.match(excel.content, /<Workbook/);
  assert.match(excel.content, /<Column ss:Width="260"/);
  assert.match(excel.content, /<Column ss:Width="420"/);
  assert.match(excel.content, /<FreezePanes\/>/);
  assert.match(excel.content, /WrapText="1"/);
  assert.match(excel.content, /化工原料/);
  assert.match(excel.content, /山东一化工厂发生危化品泄漏/);
  assert.match(excel.content, /MMA 市场报价上调/);
});

test('renderIndustryDeliveryEmail labels previously delivered items when there is no new information', () => {
  const email = renderIndustryDeliveryEmail({
    industryName: '化工原料',
    profileTitle: '事故风险监控',
    customCriteria: '事故 公司 企业',
    dateLabel: '2026-07-08',
    deliveryMode: 'previous',
    items: [
      {
        title: '某化工企业安全事故处置进展',
        sourceName: '行业媒体',
        authorityLabel: '中',
        relevanceLabel: '高',
        publishedAtLabel: '2026-07-08 09:00',
        summary: '事故处置和监管整改仍在跟进。',
        url: 'https://example.com/chemical',
        reason: '已在上一封邮件中报送，本次继续关注',
      },
    ],
  });

  assert.match(email.subject, /状态/);
  assert.match(email.html, /本周期暂无高相关新增信息/);
  assert.match(email.html, /已报送过的持续关注信息/);
  assert.match(email.text, /已在上一封邮件中报送/);
});

test('renderIndustryDeliveryEmail can send a running status when no items exist yet', () => {
  const email = renderIndustryDeliveryEmail({
    industryName: '化工原料',
    profileTitle: '事故风险监控',
    customCriteria: '事故 公司 企业',
    dateLabel: '2026-07-08',
    deliveryMode: 'empty',
    items: [],
  });

  assert.match(email.subject, /状态/);
  assert.match(email.html, /订阅仍在运行/);
  assert.doesNotMatch(email.html, /<table/);
  assert.match(email.text, /当前没有可重复展示的信息/);
});
