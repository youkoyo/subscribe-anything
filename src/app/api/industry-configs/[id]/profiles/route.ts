import { requireAdmin } from '@/lib/auth';
import { listMonitoringProfilesForIndustry } from '@/lib/enterprise/profileProvisioner';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const { id } = await params;
    return Response.json(listMonitoringProfilesForIndustry(id));
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (err instanceof Error && err.message === 'FORBIDDEN') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }
    console.error('[industry profiles GET]', err);
    return Response.json({ error: 'Failed to load profiles' }, { status: 500 });
  }
}
