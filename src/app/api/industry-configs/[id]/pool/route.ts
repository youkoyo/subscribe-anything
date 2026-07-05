import { requireAdmin } from '@/lib/auth';
import { bindSubscriptionAsIndustryPool } from '@/lib/enterprise/industryPoolService';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAdmin();
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as { subscriptionId?: string };

    if (!body.subscriptionId) {
      return Response.json({ error: 'subscriptionId is required' }, { status: 400 });
    }

    const profile = bindSubscriptionAsIndustryPool({
      industryConfigId: id,
      subscriptionId: body.subscriptionId,
      adminUserId: session.userId,
    });

    return Response.json({ profile });
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (err instanceof Error && err.message === 'FORBIDDEN') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }
    if (err instanceof Error && err.message === 'INDUSTRY_NOT_FOUND') {
      return Response.json({ error: 'Industry not found' }, { status: 404 });
    }
    if (err instanceof Error && err.message === 'SUBSCRIPTION_NOT_FOUND') {
      return Response.json({ error: 'Subscription not found' }, { status: 404 });
    }
    console.error('[industry config pool POST]', err);
    return Response.json({ error: 'Failed to bind industry pool' }, { status: 500 });
  }
}
