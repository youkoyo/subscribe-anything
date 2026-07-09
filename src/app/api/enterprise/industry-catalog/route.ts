import { requireAuth } from '@/lib/auth';
import { listPublishedIndustryConfigsForUser } from '@/lib/industry-configs/service';

export async function GET() {
  try {
    await requireAuth();
    return Response.json(await listPublishedIndustryConfigsForUser(true));
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('[enterprise industry-catalog GET]', err);
    return Response.json({ error: 'Failed to load industry catalog' }, { status: 500 });
  }
}
