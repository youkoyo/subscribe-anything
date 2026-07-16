import { eq } from 'drizzle-orm';
import { requireAdmin } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { firecrawlConfig } from '@/lib/db/schema';

export async function POST(request: Request) {
  try {
    await requireAdmin();
    const body = await request.json().catch(() => ({}));
    const suppliedKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
    const db = getDb();
    const config = (await db.select({ apiKey: firecrawlConfig.apiKey })
      .from(firecrawlConfig)
      .where(eq(firecrawlConfig.id, 'default')))[0];
    const apiKey = suppliedKey || config?.apiKey || '';
    if (!apiKey) return Response.json({ error: '请先填写 Firecrawl API Key' }, { status: 400 });

    const response = await fetch('https://api.firecrawl.dev/v2/scrape', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com', formats: ['markdown'], onlyMainContent: true }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      return Response.json({
        error: response.status === 401 || response.status === 403
          ? '认证失败，请检查 Firecrawl API Key'
          : `Firecrawl 返回 ${response.status}`,
      }, { status: 400 });
    }
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: '测试请求超时或网络不可用' }, { status: 504 });
  }
}
