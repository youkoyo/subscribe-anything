import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';
import { middleware } from '../src/middleware';

function requestFor(pathname: string) {
  return new NextRequest(new URL(pathname, 'http://localhost:3001'));
}

test('middleware allows app manifest without a session cookie', () => {
  const response = middleware(requestFor('/manifest.webmanifest'));

  assert.equal(response.headers.get('x-middleware-next'), '1');
  assert.equal(response.status, 200);
});

test('middleware allows app icons without a session cookie', () => {
  const response = middleware(requestFor('/apple-icon.png'));

  assert.equal(response.headers.get('x-middleware-next'), '1');
  assert.equal(response.status, 200);
});
