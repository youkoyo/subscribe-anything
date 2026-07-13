import assert from 'node:assert/strict';
import test from 'node:test';
import { sampleStaticArticleList } from '../src/lib/collection/staticListSampler';

test('samples real article pages linked by a static list and ignores navigation pages', async () => {
  const pages = new Map<string, string>([
    ['https://industry.example.cn/news-list', `
      <nav><a href="/">首页</a><a href="/about.html">关于我们</a></nav>
      <article><a href="/news/shoe-fire-1">晋江鞋厂火灾通报</a></article>
      <article><a href='/news/shoe-fire-2?utm_source=list'>第二起制鞋企业事故</a></article>
      <a href="javascript:void(0)">下一页</a>
      <a href="/products/shoe">鞋类商品</a>
    `],
    ['https://industry.example.cn/news/shoe-fire-1', '<html><title>晋江鞋厂火灾通报</title></html>'],
    ['https://industry.example.cn/news/shoe-fire-2?utm_source=list', '<html><title>第二起制鞋企业事故</title></html>'],
  ]);
  const fetched: string[] = [];

  const candidates = await sampleStaticArticleList('https://industry.example.cn/news-list', {
    fetchText: async (url) => {
      fetched.push(url);
      const text = pages.get(url);
      if (text === undefined) throw new Error(`unexpected fetch: ${url}`);
      return { text, finalUrl: url };
    },
  });

  assert.deepEqual(candidates.map((candidate) => candidate.url), [
    'https://industry.example.cn/news/shoe-fire-1',
    'https://industry.example.cn/news/shoe-fire-2?utm_source=list',
  ]);
  assert.deepEqual(candidates.map((candidate) => candidate.title), [
    '晋江鞋厂火灾通报',
    '第二起制鞋企业事故',
  ]);
  assert.ok(candidates.every((candidate) => candidate.origin === 'feed' && candidate.rawHtml));
  assert.deepEqual(fetched, [
    'https://industry.example.cn/news-list',
    'https://industry.example.cn/news/shoe-fire-1',
    'https://industry.example.cn/news/shoe-fire-2?utm_source=list',
  ]);
});

test('returns a healthy empty sample when a static list has no article-like links', async () => {
  const candidates = await sampleStaticArticleList('https://industry.example.cn/news-list', {
    fetchText: async (url) => ({
      finalUrl: url,
      text: '<a href="/">首页</a><a href="/aboutus">关于我们</a>',
    }),
  });

  assert.deepEqual(candidates, []);
});

test('does not mistake a single article with a related-story link for a static list', async () => {
  const candidates = await sampleStaticArticleList('https://industry.example.cn/news/single-article', {
    fetchText: async (url) => ({
      finalUrl: url,
      text: `
        <script type="application/ld+json">{"@type":"NewsArticle"}</script>
        <h1>晋江鞋厂火灾通报</h1>
        <a href="/news/related-fire">另一篇鞋厂事故报道</a>
      `,
    }),
  });

  assert.deepEqual(candidates, []);
});

test('does not mistake an unmarked single article with multiple related links for a static list', async () => {
  const articleUrl = 'https://industry.example.cn/news/single-article';
  const fetched: string[] = [];
  const candidates = await sampleStaticArticleList(articleUrl, {
    fetchText: async (url) => {
      fetched.push(url);
      return {
        finalUrl: url,
        text: `
          <main><h1>Factory incident report</h1><p>Article body without metadata.</p></main>
          <aside>
            <a href="/news/related-fire-one">Related factory incident one</a>
            <a href="/news/related-fire-two">Related factory incident two</a>
          </aside>
        `,
      };
    },
  });

  assert.deepEqual(candidates, []);
  assert.deepEqual(fetched, [articleUrl]);
});

test('does not treat a related-story ul inside an unmarked article as list evidence', async () => {
  const articleUrl = 'https://industry.example.cn/news/single-article';
  const fetched: string[] = [];
  const candidates = await sampleStaticArticleList(articleUrl, {
    fetchText: async (url) => {
      fetched.push(url);
      return {
        finalUrl: url,
        text: `
          <main><h1>Factory incident report</h1><p>Article body without metadata.</p></main>
          <section class="related">
            <ul>
              <li><a href="/news/related-fire-one">Related factory incident one</a></li>
              <li><a href="/news/related-fire-two">Related factory incident two</a></li>
            </ul>
          </section>
        `,
      };
    },
  });

  assert.deepEqual(candidates, []);
  assert.deepEqual(fetched, [articleUrl]);
});

test('drops article links that redirect outside the validated list hostname', async () => {
  const pages = new Map<string, { finalUrl: string; text: string }>([
    ['https://industry.example.cn/news-list', {
      finalUrl: 'https://industry.example.cn/news-list',
      text: `
        <script type="application/ld+json">{"@type":"ItemList"}</script>
        <a href="/news/local-fire">本地鞋厂火灾通报</a>
        <a href="/news/redirected-fire">另一篇鞋厂事故通报</a>
      `,
    }],
    ['https://industry.example.cn/news/local-fire', {
      finalUrl: 'https://industry.example.cn/news/local-fire',
      text: '<html>local</html>',
    }],
    ['https://industry.example.cn/news/redirected-fire', {
      finalUrl: 'https://unrelated.example.com/news/borrowed',
      text: '<html>external</html>',
    }],
  ]);
  const candidates = await sampleStaticArticleList('https://industry.example.cn/news-list', {
    fetchText: async (url) => pages.get(url)!,
  });

  assert.deepEqual(candidates.map((candidate) => candidate.url), [
    'https://industry.example.cn/news/local-fire',
  ]);
});

test('drops article links whose redirect changes the validated list origin', async () => {
  const pages = new Map<string, { finalUrl: string; text: string }>([
    ['https://industry.example.cn/news-list', {
      finalUrl: 'https://industry.example.cn/news-list',
      text: `
        <script type="application/ld+json">{"@type":"ItemList"}</script>
        <a href="/news/local-fire">Local factory incident report</a>
        <a href="/news/downgraded-fire">Downgraded factory incident report</a>
        <a href="/news/alternate-port-fire">Alternate port incident report</a>
      `,
    }],
    ['https://industry.example.cn/news/local-fire', {
      finalUrl: 'https://industry.example.cn/news/local-fire',
      text: '<html>local</html>',
    }],
    ['https://industry.example.cn/news/downgraded-fire', {
      finalUrl: 'http://industry.example.cn/news/downgraded-fire',
      text: '<html>downgraded</html>',
    }],
    ['https://industry.example.cn/news/alternate-port-fire', {
      finalUrl: 'https://industry.example.cn:8443/news/alternate-port-fire',
      text: '<html>alternate port</html>',
    }],
  ]);
  const candidates = await sampleStaticArticleList('https://industry.example.cn/news-list', {
    fetchText: async (url) => pages.get(url)!,
  });

  assert.deepEqual(candidates.map((candidate) => candidate.url), [
    'https://industry.example.cn/news/local-fire',
  ]);
});

test('accepts one live link when the page explicitly declares an ItemList', async () => {
  const candidates = await sampleStaticArticleList('https://industry.example.cn/latest', {
    fetchText: async (url) => url.endsWith('/latest')
      ? {
          finalUrl: url,
          text: `
            <script type="application/ld+json">{"@type":"ItemList"}</script>
            <a href="/news/only-current-item">当前唯一一篇鞋厂事故通报</a>
          `,
        }
      : { finalUrl: url, text: '<html>article</html>' },
  });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].url, 'https://industry.example.cn/news/only-current-item');
});

test('accepts repeated links in an explicitly named HTML news list', async () => {
  const candidates = await sampleStaticArticleList('https://industry.example.cn/latest', {
    fetchText: async (url) => url.endsWith('/latest')
      ? {
          finalUrl: url,
          text: `
            <ul class="news-list">
              <li><a href="/news/current-item-one">Current factory incident one</a></li>
              <li><a href="/news/current-item-two">Current factory incident two</a></li>
            </ul>
          `,
        }
      : { finalUrl: url, text: '<html>article</html>' },
  });

  assert.deepEqual(candidates.map((candidate) => candidate.url), [
    'https://industry.example.cn/news/current-item-one',
    'https://industry.example.cn/news/current-item-two',
  ]);
});
