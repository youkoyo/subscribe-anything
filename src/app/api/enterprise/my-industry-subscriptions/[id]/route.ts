import { requireAuth } from '@/lib/auth';
import {
  deleteMyIndustrySubscription,
  updateMyIndustrySubscription,
} from '@/lib/enterprise/subscriptionService';

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth();
    const { id } = await params;
    const body = await req.json().catch(() => ({})) as {
      customCriteria?: string;
      extraRecipientEmails?: string[];
    };
    const updated = updateMyIndustrySubscription(id, session.userId, body);
    if (!updated) return Response.json({ error: 'Not found' }, { status: 404 });
    return Response.json(updated);
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error('[enterprise my subscription PATCH]', err);
    return Response.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth();
    const { id } = await params;
    const deleted = await deleteMyIndustrySubscription(id, session.userId);
    if (!deleted) return Response.json({ error: 'Not found' }, { status: 404 });
    return Response.json({ deleted: true });
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('[enterprise my subscription DELETE]', err);
    return Response.json({ error: 'Failed to cancel subscription' }, { status: 500 });
  }
}
