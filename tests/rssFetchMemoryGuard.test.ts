import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { rssFetch } from '../src/lib/ai/tools/rssFetch';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('rejects an oversized RSS response before parsing it', async () => {
  globalThis.fetch = (async () => new Response(
    '<rss><channel><item><title>safe fixture</title><link>https://example.test/item</link></item></channel></rss>',
    {
      status: 200,
      headers: { 'content-length': String(64 * 1024 * 1024) },
    },
  )) as typeof fetch;

  await assert.rejects(
    rssFetch('https://example.test/feed.xml', { maxItems: 'all' }),
    /RSS response exceeds the 16 MB safety limit/,
  );
});
