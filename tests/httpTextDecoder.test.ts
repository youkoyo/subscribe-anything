import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeHttpText } from '../src/lib/utils/httpTextDecoder';

test('decodes GBK HTML from a meta charset declaration', () => {
  const gbkFixture = Uint8Array.from([
    ...Buffer.from('<html><head><meta charset="gbk"></head><body>', 'ascii'),
    0xb9, 0xd9, 0xb7, 0xbd,
    ...Buffer.from('</body></html>', 'ascii'),
  ]);

  assert.match(decodeHttpText(gbkFixture), /官方/);
});

test('prefers an HTTP charset over a conflicting HTML meta charset', () => {
  const utf8Fixture = new TextEncoder().encode('<meta charset="gbk">鞋厂火灾');

  assert.match(decodeHttpText(utf8Fixture, 'text/html; charset=utf-8'), /鞋厂火灾/);
});
