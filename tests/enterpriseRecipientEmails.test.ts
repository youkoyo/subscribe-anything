import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeRecipientEmails,
  validateRecipientEmails,
} from '../src/lib/enterprise/recipientEmails';

test('normalizeRecipientEmails includes account email first and deduplicates extras', () => {
  assert.deepEqual(
    normalizeRecipientEmails('user@example.com', [
      ' Team@Example.com ',
      'user@example.com',
      '',
      'team@example.com',
    ]),
    ['user@example.com', 'team@example.com']
  );
});

test('normalizeRecipientEmails limits total recipient count to five', () => {
  assert.deepEqual(
    normalizeRecipientEmails('owner@example.com', [
      'a@example.com',
      'b@example.com',
      'c@example.com',
      'd@example.com',
      'e@example.com',
    ]),
    ['owner@example.com', 'a@example.com', 'b@example.com', 'c@example.com', 'd@example.com']
  );
});

test('validateRecipientEmails rejects invalid email syntax', () => {
  const result = validateRecipientEmails(['ok@example.com', 'bad-email']);

  assert.equal(result.valid, false);
  assert.equal(result.error, '收件邮箱格式不正确：bad-email');
});

test('validateRecipientEmails accepts one to five valid emails', () => {
  const result = validateRecipientEmails(['a@example.com', 'b@example.com']);

  assert.deepEqual(result, { valid: true });
});
