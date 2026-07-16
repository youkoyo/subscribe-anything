import { eq } from 'drizzle-orm';
import { requireAdmin } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { llmProviders } from '@/lib/db/schema';
import { buildOpenAIClient } from '@/lib/ai/client';

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await params;
    const provider = (await getDb().select().from(llmProviders).where(eq(llmProviders.id, id)))[0];
    if (!provider) return Response.json({ error: '供应商不存在' }, { status: 404 });
    const result = await buildOpenAIClient(provider).chat.completions.create({ model: provider.modelId, messages: [{ role: 'user', content: 'Reply with OK.' }], max_tokens: 4 }, { signal: AbortSignal.timeout(15_000) });
    return Response.json({ ok: true, model: result.model });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    return Response.json({ error: /401|403|auth|key/i.test(message) ? '认证失败，请检查 API Key' : '测试请求超时或供应商不可用' }, { status: 400 });
  }
}
