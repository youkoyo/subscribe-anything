import { eq } from 'drizzle-orm';
import { requireAdmin } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { firecrawlConfig } from '@/lib/db/schema';

function authError(error: unknown): Response | null {
  if (!(error instanceof Error)) return null;
  if (error.message === 'UNAUTHORIZED') return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (error.message === 'FORBIDDEN') return Response.json({ error: 'Admin access required' }, { status: 403 });
  return null;
}

export async function GET() {
  try {
    await requireAdmin();
    const db = getDb();
    const config = (await db.select({ apiKey: firecrawlConfig.apiKey })
      .from(firecrawlConfig)
      .where(eq(firecrawlConfig.id, 'default')))[0];
    return Response.json({ configured: Boolean(config?.apiKey.trim()), apiKey: '' });
  } catch (error) {
    return authError(error) ?? Response.json({ error: 'Failed to load Firecrawl config' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const session = await requireAdmin();
    const body = await request.json().catch(() => ({}));
    const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
    const db = getDb();
    const existing = (await db.select({ apiKey: firecrawlConfig.apiKey })
      .from(firecrawlConfig)
      .where(eq(firecrawlConfig.id, 'default')))[0];
    const resolvedKey = apiKey || existing?.apiKey || '';
    if (!resolvedKey) return Response.json({ error: '请填写 Firecrawl API Key' }, { status: 400 });

    await db.insert(firecrawlConfig).values({
      id: 'default', apiKey: resolvedKey, createdBy: session.userId, updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: firecrawlConfig.id,
      set: { apiKey: resolvedKey, updatedAt: new Date() },
    });
    return Response.json({ configured: true, apiKey: '' });
  } catch (error) {
    return authError(error) ?? Response.json({ error: 'Failed to update Firecrawl config' }, { status: 500 });
  }
}
