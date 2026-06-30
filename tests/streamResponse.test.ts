import assert from 'node:assert/strict';
import test from 'node:test';
import { sseStream } from '../src/lib/utils/streamResponse';

test('sseStream logs generator errors before emitting an error event', async (t) => {
  const originalError = console.error;
  const calls: unknown[][] = [];
  console.error = (...args: unknown[]) => {
    calls.push(args);
  };
  t.after(() => {
    console.error = originalError;
  });

  const response = sseStream(async () => {
    throw new Error('boom');
  });

  const body = await response.text();

  assert.match(body, /"type":"error"/);
  assert.match(body, /"message":"boom"/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], '[sseStream] generator failed');
  assert.equal((calls[0][1] as Error).message, 'boom');
});
