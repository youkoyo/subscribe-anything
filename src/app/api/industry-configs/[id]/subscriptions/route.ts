import { requireAdmin } from '@/lib/auth';
import { listIndustrySubscribersForAdmin } from '@/lib/enterprise/subscriptionService';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const { id } = await params;
    return Response.json(await listIndustrySubscribersForAdmin(id));
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (err instanceof Error && err.message === 'FORBIDDEN') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }
    console.error('[industry config subscribers GET]', err);
    return Response.json({ error: 'Failed to load industry subscribers' }, { status: 500 });
  }
}
