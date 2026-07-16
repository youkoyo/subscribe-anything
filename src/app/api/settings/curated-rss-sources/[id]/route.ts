import { eq } from 'drizzle-orm';
import { requireAdmin } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { discoverySourceCatalog } from '@/lib/db/schema';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await params;
    const body = await request.json() as Record<string, unknown>;
    if (typeof body.title !== 'string' || !body.title.trim() || typeof body.feedUrl !== 'string') {
      return Response.json({ error: '名称和 RSS 地址不能为空' }, { status: 400 });
    }
    const url = new URL(body.feedUrl);
    if (!['http:', 'https:'].includes(url.protocol)) return Response.json({ error: 'RSS 地址格式无效' }, { status: 400 });
    const [updated] = await getDb().update(discoverySourceCatalog).set({
      title: body.title.trim(), feedUrl: body.feedUrl.trim(), originalCategory: String(body.originalCategory),
      preferencesJson: JSON.stringify(Array.isArray(body.preferences) ? body.preferences : []),
      trustLevel: String(body.trustLevel) as 'high' | 'medium' | 'low', defaultUsage: String(body.defaultUsage) as 'primary' | 'supplementary' | 'discovery',
      topicTagsJson: JSON.stringify(Array.isArray(body.topicTags) ? body.topicTags : []),
      keywordsJson: JSON.stringify(Array.isArray(body.keywords) ? body.keywords : []), updatedAt: new Date(),
    }).where(eq(discoverySourceCatalog.id, id)).returning();
    if (!updated) return Response.json({ error: 'Not found' }, { status: 404 });
    return Response.json(updated);
  } catch {
    return Response.json({ error: 'Failed to update curated RSS source' }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await params;
    const deleted = await getDb().delete(discoverySourceCatalog).where(eq(discoverySourceCatalog.id, id)).returning({ id: discoverySourceCatalog.id });
    if (!deleted.length) return Response.json({ error: 'Not found' }, { status: 404 });
    return new Response(null, { status: 204 });
  } catch {
    return Response.json({ error: 'Failed to delete curated RSS source' }, { status: 500 });
  }
}
