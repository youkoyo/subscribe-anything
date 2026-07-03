import assert from 'node:assert/strict';
import test from 'node:test';
import { renderIndustryDeliveryEmail } from '../src/lib/enterprise/emailTemplate';

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
