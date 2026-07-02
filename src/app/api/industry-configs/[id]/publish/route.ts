import { requireAdmin } from '@/lib/auth';
import { publishIndustryConfig } from '@/lib/industry-configs/service';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const { id } = await params;
    const body = await req.json().catch(() => ({})) as { published?: boolean };
    const updated = publishIndustryConfig(id, body.published !== false);
    if (!updated) return Response.json({ error: 'Not found' }, { status: 404 });
    return Response.json(updated);
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (err instanceof Error && err.message === 'FORBIDDEN') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }
    console.error('[industry-configs publish POST]', err);
    return Response.json({ error: 'Failed to publish industry config' }, { status: 500 });
  }
}
