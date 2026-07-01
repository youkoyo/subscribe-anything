import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const controlFiles = [
  'src/components/ui/input.tsx',
  'src/components/ui/select.tsx',
  'src/components/ui/textarea.tsx',
];

test('form controls use generated dark-theme background utilities', async () => {
  for (const file of controlFiles) {
    const source = await readFile(file, 'utf8');

    assert.doesNotMatch(source, /bg-\[#0b2a63\]\/64/, `${file} uses an invalid opacity modifier`);
    assert.doesNotMatch(source, /placeholder:text-cyan-100\/42/, `${file} uses an invalid placeholder opacity modifier`);
    assert.match(source, /bg-\[rgb\(11_42_99_\/_0\.64\)\]/, `${file} should render the shared dark field background`);
  }
});

test('textarea uses dark native control chrome', async () => {
  const source = await readFile('src/components/ui/textarea.tsx', 'utf8');

  assert.doesNotMatch(source, /\[color-scheme:dark\]/);
  assert.match(source, /style=\{\{\s*colorScheme: 'dark',\s*\.\.\.style\s*\}\}/s);
});
