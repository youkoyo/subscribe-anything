import assert from 'node:assert/strict';
import test from 'node:test';
import { buildStandardFeedScript } from '@/lib/discovery-sources/standard-feed-script';

test('standard feed script returns every parsable entry without relevance filtering', () => {
  const script = buildStandardFeedScript('https://example.test/feed?x="quoted"');

  assert.match(script, /https:\/\/example\.test\/feed\?x=\\"quoted\\"/);
  assert.match(script, /return blocks\.map/);
  assert.doesNotMatch(script, /slice\(0, \d+\)/);
  assert.doesNotMatch(script, /relevanceLabel|STRICT|RELATED|CONTEXT/);
  assert.doesNotMatch(script, /generateScriptAgent|require\(|import\s/);
  assert.doesNotThrow(() => new Function(script));
});
