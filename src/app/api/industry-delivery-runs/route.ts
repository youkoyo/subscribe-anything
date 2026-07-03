import { desc, eq } from 'drizzle-orm';
import { requireAdmin } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { industryDeliveryRuns, userDeliveryLogs } from '@/lib/db/schema';

export async function GET(req: Request) {
  try {
    await requireAdmin();
    const url = new URL(req.url);
    const industryConfigId = url.searchParams.get('industryConfigId');
    const db = getDb();
    const runs = industryConfigId
      ? db
          .select()
          .from(industryDeliveryRuns)
          .where(eq(industryDeliveryRuns.industryConfigId, industryConfigId))
          .orderBy(desc(industryDeliveryRuns.createdAt))
          .limit(50)
          .all()
      : db
          .select()
          .from(industryDeliveryRuns)
          .orderBy(desc(industryDeliveryRuns.createdAt))
          .limit(50)
          .all();

    const logs = db
      .select()
      .from(userDeliveryLogs)
      .orderBy(desc(userDeliveryLogs.createdAt))
      .limit(100)
      .all();

    return Response.json({ runs, logs });
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (err instanceof Error && err.message === 'FORBIDDEN') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }
    console.error('[industry-delivery-runs GET]', err);
    return Response.json({ error: 'Failed to load delivery runs' }, { status: 500 });
  }
}
