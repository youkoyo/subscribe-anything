import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveSessionCookieSecure } from '../src/lib/auth/session';

test('allows an explicit HTTP cookie override in production', () => {
  assert.equal(resolveSessionCookieSecure({ NODE_ENV: 'production', SESSION_COOKIE_SECURE: 'false' }), false);
});

test('keeps an explicit secure-cookie override', () => {
  assert.equal(resolveSessionCookieSecure({ NODE_ENV: 'development', SESSION_COOKIE_SECURE: 'true' }), true);
});

test('falls back to the existing production default when unset', () => {
  assert.equal(resolveSessionCookieSecure({ NODE_ENV: 'production' }), true);
  assert.equal(resolveSessionCookieSecure({ NODE_ENV: 'development' }), false);
});
