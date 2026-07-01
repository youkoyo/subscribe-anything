import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('production start script runs the custom server with NODE_ENV=production', async () => {
  const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as {
    scripts?: Record<string, string>;
  };

  const startScript = packageJson.scripts?.start ?? '';

  assert.match(startScript, /\bNODE_ENV=production\b/);
  assert.match(startScript, /\bnode dist\/server\.js\b/);
});
