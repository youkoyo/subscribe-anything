import { requireAdmin } from '@/lib/auth';
import { getIndustryConfigForAdmin } from '@/lib/industry-configs/service';
import { runIndustryDelivery } from '@/lib/enterprise/deliveryService';

/**
 * Manual trigger: fire the delivery pipeline once for an industry config, bypassing the
 * cron schedule. Returns the created run + resulting user delivery logs so admins can
 * inspect what would have happened at the next cron tick.
 *
 * Useful when debugging the email pipeline end-to-end without waiting on node-cron.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const { id } = await params;
    const config = getIndustryConfigForAdmin(id);
    if (!config) return Response.json({ error: 'Not found' }, { status: 404 });

    const run = await runIndustryDelivery(id, new Date());
    return Response.json({ run });
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (err instanceof Error && err.message === 'FORBIDDEN') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error('[industry-configs run-now POST]', err);
    return Response.json({ error: `Failed to run delivery: ${message}` }, { status: 500 });
  }
}