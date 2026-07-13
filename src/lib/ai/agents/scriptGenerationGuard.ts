export const MAX_SCRIPT_VALIDATION_ATTEMPTS = 3;

export function hasRemainingScriptValidationAttempt(attempts: number) {
  return attempts < MAX_SCRIPT_VALIDATION_ATTEMPTS;
}
