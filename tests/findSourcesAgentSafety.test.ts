import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
  new URL('../src/lib/ai/agents/findSourcesAgent.ts', import.meta.url),
  'utf8',
);

test('does not expose the unrestricted legacy checkFeed fetch to the model', () => {
  assert.doesNotMatch(source, /checkFeed(?:ToolDef)?/);
});

test('enforces the optional-agent web search budget before making another call', () => {
  assert.match(
    source,
    /if\s*\(webSearchCount\s*>=\s*MAX_WEB_SEARCH_CALLS\)[\s\S]{0,500}?continue;/,
  );
});
