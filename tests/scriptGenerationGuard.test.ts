import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_SCRIPT_VALIDATION_ATTEMPTS,
  hasRemainingScriptValidationAttempt,
} from '../src/lib/ai/agents/scriptGenerationGuard';

test('stops script validation after the configured attempt limit', () => {
  assert.equal(MAX_SCRIPT_VALIDATION_ATTEMPTS, 3);
  assert.equal(hasRemainingScriptValidationAttempt(0), true);
  assert.equal(hasRemainingScriptValidationAttempt(2), true);
  assert.equal(hasRemainingScriptValidationAttempt(3), false);
});
