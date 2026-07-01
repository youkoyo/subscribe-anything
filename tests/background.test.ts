import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('nebula background uses a restrained animated field with reduced-motion fallback', async () => {
  const css = await readFile('src/app/globals.css', 'utf8');

  assert.match(css, /\.nebula-grid::before/);
  assert.match(css, /\.nebula-grid::after/);
  assert.match(css, /@keyframes nebula-field-drift/);
  assert.match(css, /@keyframes nebula-light-sweep/);
  assert.doesNotMatch(css, /@keyframes nebula-scan/);
  assert.match(css, /prefers-reduced-motion: reduce/);
});
