import { requireAuth } from '@/lib/auth';
import { pauseMyIndustrySubscription } from '@/lib/enterprise/subscriptionService';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth();
    const { id } = await params;
    const body = await req.json().catch(() => ({})) as { paused?: boolean };
    const updated = pauseMyIndustrySubscription(id, session.userId, body.paused !== false);
    if (!updated) return Response.json({ error: 'Not found' }, { status: 404 });
    return Response.json(updated);
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('[enterprise my subscription pause POST]', err);
    return Response.json({ error: 'Failed to update subscription' }, { status: 500 });
  }
}
