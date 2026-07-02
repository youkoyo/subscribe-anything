import { requireAdmin } from '@/lib/auth';
import { startProfileProvisioning } from '@/lib/enterprise/profileProvisioner';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const { id } = await params;
    const result = await startProfileProvisioning(id);
    return Response.json(result);
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (err instanceof Error && err.message === 'FORBIDDEN') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }
    console.error('[industry profile retry POST]', err);
    return Response.json({ error: 'Failed to retry profile' }, { status: 500 });
  }
}
