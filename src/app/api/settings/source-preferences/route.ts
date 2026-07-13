import { asc, eq } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
import { requireAdmin } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { sourcePreferences } from '@/lib/db/schema';

export async function GET() {
  try {
    await requireAdmin();
    return Response.json(await getDb().select().from(sourcePreferences).orderBy(asc(sourcePreferences.createdAt)));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Failed to load source preferences' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireAdmin();
    const body = await req.json();
    if (!body.name?.trim() || !body.url?.startsWith('http')) return Response.json({ error: 'name and a valid url are required' }, { status: 400 });
    if (!['general_news', 'local_news', 'industry_vertical'].includes(body.sourceType)) return Response.json({ error: 'invalid sourceType' }, { status: 400 });
    if (!['required', 'preferred', 'supplemental'].includes(body.priority)) return Response.json({ error: 'invalid priority' }, { status: 400 });
    const now = new Date();
    const id = createId();
    await getDb().insert(sourcePreferences).values({ id, name: body.name.trim(), url: body.url.trim(), sourceType: body.sourceType, priority: body.priority, isEnabled: body.isEnabled !== false, createdBy: session.userId, createdAt: now, updatedAt: now });
    return Response.json((await getDb().select().from(sourcePreferences).where(eq(sourcePreferences.id, id)))[0], { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Failed to create source preference' }, { status: 500 });
  }
}
