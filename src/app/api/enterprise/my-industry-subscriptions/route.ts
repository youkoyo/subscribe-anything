import { requireAuth } from '@/lib/auth';
import { listMyIndustrySubscriptions } from '@/lib/enterprise/subscriptionService';

export async function GET() {
  try {
    const session = await requireAuth();
    return Response.json(listMyIndustrySubscriptions(session.userId));
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('[enterprise my subscriptions GET]', err);
    return Response.json({ error: 'Failed to load subscriptions' }, { status: 500 });
  }
}
