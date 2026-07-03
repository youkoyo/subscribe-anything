import { requireAdmin, requireAuth } from '@/lib/auth';
import {
  deleteIndustryConfigForAdmin,
  getIndustryConfigForAdmin,
  getPublishedIndustryConfig,
  updateIndustryConfigForAdmin,
} from '@/lib/industry-configs/service';
import type { IndustryConfigInput } from '@/lib/industry-configs/types';

function handleAuthError(err: unknown): Response | null {
  if (err instanceof Error && err.message === 'UNAUTHORIZED') {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (err instanceof Error && err.message === 'FORBIDDEN') {
    return Response.json({ error: 'Admin access required' }, { status: 403 });
  }
  return null;
}

function validateInput(body: IndustryConfigInput): string | null {
  if (!body.name || typeof body.name !== 'string' || !body.name.trim()) {
    return '产业名称不能为空';
  }
  return null;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth();
    const { id } = await params;
    const config = session.isAdmin
      ? getIndustryConfigForAdmin(id)
      : getPublishedIndustryConfig(id);
    if (!config) return Response.json({ error: 'Not found' }, { status: 404 });
    return Response.json(config);
  } catch (err) {
    const authError = handleAuthError(err);
    if (authError) return authError;
    console.error('[industry-configs/[id] GET]', err);
    return Response.json({ error: 'Failed to load industry config' }, { status: 500 });
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const { id } = await params;
    const body = await req.json().catch(() => ({})) as IndustryConfigInput;
    const error = validateInput(body);
    if (error) return Response.json({ error }, { status: 400 });

    const updated = updateIndustryConfigForAdmin(id, body);
    if (!updated) return Response.json({ error: 'Not found' }, { status: 404 });
    return Response.json(updated);
  } catch (err) {
    const authError = handleAuthError(err);
    if (authError) return authError;
    console.error('[industry-configs/[id] PATCH]', err);
    return Response.json({ error: 'Failed to update industry config' }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const { id } = await params;
    const deleted = deleteIndustryConfigForAdmin(id);
    if (!deleted) return Response.json({ error: 'Not found' }, { status: 404 });
    return new Response(null, { status: 204 });
  } catch (err) {
    const authError = handleAuthError(err);
    if (authError) return authError;
    console.error('[industry-configs/[id] DELETE]', err);
    return Response.json({ error: 'Failed to delete industry config' }, { status: 500 });
  }
}
