import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applySourceIntentPolicy,
  classifySource,
} from '../src/lib/ai/agents/sourceIntentPolicy';

const source = (title: string, description: string, url: string, recommended = true) => ({
  title,
  description,
  url,
  recommended,
});

test('classifies social and local pages ahead of finance pages', () => {
  assert.equal(
    classifySource(source('人民网社会频道', '社会突发新闻与公共事件', 'https://people.com.cn/society')),
    'general_news'
  );
  assert.equal(
    classifySource(source('泉州市政府新闻', '地方产业动态与政务新闻', 'https://quanzhou.gov.cn/news')),
    'local_news'
  );
  assert.equal(
    classifySource(source('人民网财经', '财经新闻与资本市场', 'https://people.com.cn/finance')),
    'finance'
  );
});

test('demotes extra finance feeds and preserves preferred source types', () => {
  const result = applySourceIntentPolicy([
    source('人民网财经', '财经新闻', 'https://people.com.cn/finance'),
    source('中新网财经', '财经新闻', 'https://chinanews.com.cn/finance'),
    source('晋江政府新闻', '地方产业动态', 'https://jinjiang.gov.cn/news'),
    source('鞋业头条', '鞋业垂直行业新闻', 'https://shoes.example.com/news'),
    source('人民网社会', '社会突发新闻', 'https://people.com.cn/society'),
  ]);

  assert.equal(result.filter((item) => item.sourceType === 'finance' && item.recommended).length, 1);
  assert.ok(result.some((item) => item.sourceType === 'local_news' && item.recommended));
  assert.ok(result.some((item) => item.sourceType === 'industry_vertical' && item.recommended));
});

test('source intent policy preserves sourceType for UI labels', () => {
  const [result] = applySourceIntentPolicy([
    source('鞋业头条', '鞋业垂直行业新闻', 'https://shoes.example.com/news'),
  ]);

  assert.equal(result.sourceType, 'industry_vertical');
});

test('promotes available local and industry sources even when the model marks them as backup', () => {
  const result = applySourceIntentPolicy([
    source('晋江政府新闻', '地方产业动态', 'https://jinjiang.gov.cn/news', false),
    source('鞋业头条', '鞋业垂直行业新闻', 'https://shoes.example.com/news', false),
  ]);

  assert.ok(result.every((item) => item.recommended));
});

test('does not let a finance URL bypass the finance limit with a model-supplied category', () => {
  const result = applySourceIntentPolicy([
    { ...source('人民网财经', '财经新闻', 'https://people.com.cn/finance'), sourceType: 'general_news' as const },
    source('财新财经', '财经新闻', 'https://caixin.com/business'),
    source('晋江政府新闻', '地方产业动态', 'https://jinjiang.gov.cn/news'),
  ]);

  assert.equal(result.filter((item) => item.sourceType === 'finance').length, 2);
  assert.equal(result.filter((item) => item.sourceType === 'finance' && item.recommended).length, 1);
});
