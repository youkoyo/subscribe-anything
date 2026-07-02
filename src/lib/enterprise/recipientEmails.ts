const MAX_RECIPIENT_EMAILS = 5;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeRecipientEmails(
  accountEmail: string | null | undefined,
  extraEmails: unknown
): string[] {
  const rawExtras = Array.isArray(extraEmails) ? extraEmails : [];
  const seen = new Set<string>();
  const result: string[] = [];

  const push = (value: unknown) => {
    const email = String(value ?? '').trim().toLowerCase();
    if (!email || seen.has(email)) return;
    seen.add(email);
    result.push(email);
  };

  push(accountEmail);
  for (const item of rawExtras) {
    push(item);
    if (result.length >= MAX_RECIPIENT_EMAILS) break;
  }

  return result.slice(0, MAX_RECIPIENT_EMAILS);
}

export function validateRecipientEmails(
  emails: string[]
): { valid: true } | { valid: false; error: string } {
  if (emails.length === 0) {
    return { valid: false, error: '至少需要一个收件邮箱' };
  }
  if (emails.length > MAX_RECIPIENT_EMAILS) {
    return { valid: false, error: `收件邮箱最多 ${MAX_RECIPIENT_EMAILS} 个` };
  }
  for (const email of emails) {
    if (!EMAIL_RE.test(email)) {
      return { valid: false, error: `收件邮箱格式不正确：${email}` };
    }
  }
  return { valid: true };
}

export function parseRecipientEmailsJson(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.map((item) => String(item ?? '').trim().toLowerCase()).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}
