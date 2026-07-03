import { requireAdmin } from '@/lib/auth';
import { approveUserIndustrySubscription } from '@/lib/enterprise/subscriptionService';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAdmin();
    const { id } = await params;
    const updated = approveUserIndustrySubscription(id, session.userId);
    if (!updated) return Response.json({ error: 'Not found' }, { status: 404 });
    return Response.json(updated);
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (err instanceof Error && err.message === 'FORBIDDEN') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }
    console.error('[admin todo subscription approve POST]', err);
    return Response.json({ error: 'Failed to approve subscription' }, { status: 500 });
  }
}
