import { eq } from 'drizzle-orm';
import { requireAdmin } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { sourcePreferences } from '@/lib/db/schema';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(); const { id } = await params; const body = await req.json();
    const update = { ...(typeof body.name === 'string' ? { name: body.name.trim() } : {}), ...(typeof body.url === 'string' ? { url: body.url.trim() } : {}), ...(typeof body.sourceType === 'string' ? { sourceType: body.sourceType } : {}), ...(typeof body.priority === 'string' ? { priority: body.priority } : {}), ...(typeof body.isEnabled === 'boolean' ? { isEnabled: body.isEnabled } : {}), updatedAt: new Date() };
    await getDb().update(sourcePreferences).set(update).where(eq(sourcePreferences.id, id));
    return Response.json((await getDb().select().from(sourcePreferences).where(eq(sourcePreferences.id, id)))[0]);
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Failed to update source preference' }, { status: 500 }); }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try { await requireAdmin(); const { id } = await params; await getDb().delete(sourcePreferences).where(eq(sourcePreferences.id, id)); return Response.json({ ok: true }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Failed to delete source preference' }, { status: 500 }); }
}
