import { requireAdmin } from '@/lib/auth';
import { reloadIndustryDelivery } from '@/lib/enterprise/deliveryScheduler';
import {
  getIndustryDeliveryConfig,
  updateIndustryDeliveryConfig,
} from '@/lib/enterprise/deliverySettings';

function authError(error: unknown): Response | null {
  if (!(error instanceof Error)) return null;
  if (error.message === 'UNAUTHORIZED') return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (error.message === 'FORBIDDEN') return Response.json({ error: 'Admin access required' }, { status: 403 });
  return null;
}

export async function GET() {
  try {
    await requireAdmin();
    return Response.json(await getIndustryDeliveryConfig());
  } catch (error) {
    return authError(error) ?? Response.json({ error: 'Failed to load industry delivery settings' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const session = await requireAdmin();
    const body = await request.json().catch(() => ({}));
    const config = await updateIndustryDeliveryConfig({
      cron: typeof body.cron === 'string' ? body.cron : '',
      timezone: typeof body.timezone === 'string' ? body.timezone : '',
    }, session.userId);
    await reloadIndustryDelivery();
    return Response.json(config);
  } catch (error) {
    if (error instanceof Error && error.message === 'INVALID_DELIVERY_CRON') {
      return Response.json({ error: '无效的投递频率' }, { status: 400 });
    }
    return authError(error) ?? Response.json({ error: 'Failed to update industry delivery settings' }, { status: 500 });
  }
}
