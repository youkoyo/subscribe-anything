import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import type { AddressInfo } from 'node:net';

test('radar rules fetch returns empty rules when the endpoint is forbidden', async (t) => {
  const server = http.createServer((req, res) => {
    assert.equal(req.url, '/api/radar/rules');
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('forbidden');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());

  const address = server.address();
  assert.notEqual(address, null);
  assert.notEqual(typeof address, 'string');
  const port = (address as AddressInfo).port;

  const { getRadarRulesForBaseUrl } = await import('../src/lib/ai/tools/rssRadar');
  await assert.doesNotReject(async () => {
    assert.deepEqual(await getRadarRulesForBaseUrl(`http://127.0.0.1:${port}`), {});
  });
});
