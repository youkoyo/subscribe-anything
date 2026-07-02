import { requireAuth } from '@/lib/auth';
import { normalizeRecipientEmails } from '@/lib/enterprise/recipientEmails';
import { createUserIndustrySubscription } from '@/lib/enterprise/subscriptionService';

export async function POST(req: Request) {
  try {
    const session = await requireAuth();
    const body = await req.json().catch(() => ({})) as {
      industryConfigId?: string;
      customCriteria?: string;
      extraRecipientEmails?: string[];
    };

    if (!body.industryConfigId) {
      return Response.json({ error: 'industryConfigId is required' }, { status: 400 });
    }
    if (!body.customCriteria?.trim()) {
      return Response.json({ error: 'customCriteria is required' }, { status: 400 });
    }

    normalizeRecipientEmails(null, body.extraRecipientEmails ?? []);
    const created = createUserIndustrySubscription({
      userId: session.userId,
      industryConfigId: body.industryConfigId,
      customCriteria: body.customCriteria,
      extraRecipientEmails: body.extraRecipientEmails ?? [],
    });

    return Response.json(created, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const message = err instanceof Error ? err.message : String(err);
    if (message === 'INDUSTRY_NOT_FOUND') {
      return Response.json({ error: 'Industry not found' }, { status: 404 });
    }
    console.error('[enterprise industry-subscriptions POST]', err);
    return Response.json({ error: message }, { status: 400 });
  }
}
