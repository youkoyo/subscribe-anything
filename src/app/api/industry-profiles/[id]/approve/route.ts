import { requireAdmin } from '@/lib/auth';
import {
  approveMonitoringProfile,
  startProfileProvisioning,
} from '@/lib/enterprise/profileProvisioner';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAdmin();
    const { id } = await params;
    const profile = approveMonitoringProfile(id, session.userId);
    if (!profile) return Response.json({ error: 'Not found' }, { status: 404 });
    await startProfileProvisioning(id);
    return Response.json({ success: true });
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (err instanceof Error && err.message === 'FORBIDDEN') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }
    console.error('[industry profile approve POST]', err);
    return Response.json({ error: 'Failed to approve profile' }, { status: 500 });
  }
}
