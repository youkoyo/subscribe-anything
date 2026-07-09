import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('production compose runs only the app behind localhost and externalizes secrets', async () => {
  const source = await readFile('docker-compose.prod.yml', 'utf8');

  assert.match(source, /services:\s*\n\s*app:/);
  assert.doesNotMatch(source, /\n\s*postgres:/);
  assert.match(source, /127\.0\.0\.1:3000:3000/);
  assert.match(source, /\.env\.production\.local/);
  assert.match(source, /restart:\s*unless-stopped/);
  assert.doesNotMatch(source, /new_postgres_password/);
});

test('production env example documents remote database without real secrets', async () => {
  const source = await readFile('.env.production.example', 'utf8');

  assert.match(source, /DATABASE_TARGET=remote/);
  assert.match(source, /DATABASE_URL_REMOTE=postgresql:\/\/nebula_app:<password>@47\.97\.114\.189:5432\/nebula_prism_industry_info/);
  assert.match(source, /SESSION_SECRET=<replace-with-strong-random-secret>/);
  assert.match(source, /NEXT_PUBLIC_BASE_URL=https:\/\/your-domain\.example\.com/);
  assert.doesNotMatch(source, /new_postgres_password/);
});

test('nginx example proxies HTTPS traffic to the local app port', async () => {
  const source = await readFile('deploy/nginx/nebula-prism.conf.example', 'utf8');

  assert.match(source, /listen 80/);
  assert.match(source, /listen 443 ssl/);
  assert.match(source, /proxy_pass http:\/\/127\.0\.0\.1:3000/);
  assert.match(source, /proxy_set_header Host \$host/);
});

test('Alibaba Cloud deployment guide covers the production runbook', async () => {
  const source = await readFile('docs/deployment/alibaba-cloud.md', 'utf8');

  assert.match(source, /阿里云 ECS/);
  assert.match(source, /docker compose -f docker-compose\.prod\.yml up -d --build/);
  assert.match(source, /nebula_app/);
  assert.match(source, /Nginx/);
  assert.match(source, /HTTPS/);
  assert.match(source, /ICP/);
});
