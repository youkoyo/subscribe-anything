import { requireAdmin } from '@/lib/auth';

export async function POST(request: Request) {
  try {
    await requireAdmin();
    const { provider, apiKey } = await request.json();
    if (!apiKey || !['tavily', 'serper'].includes(provider)) return Response.json({ error: '请填写有效的供应商和 API Key' }, { status: 400 });
    const url = provider === 'tavily' ? 'https://api.tavily.com/search' : 'https://google.serper.dev/search';
    const response = await fetch(url, { method: 'POST', headers: provider === 'tavily' ? { 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json', 'X-API-KEY': apiKey }, body: JSON.stringify(provider === 'tavily' ? { api_key: apiKey, query: 'test', max_results: 1 } : { q: 'test' }), signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return Response.json({ error: response.status === 401 || response.status === 403 ? '认证失败，请检查 API Key' : `上游服务返回 ${response.status}` }, { status: 400 });
    return Response.json({ ok: true });
  } catch { return Response.json({ error: '测试请求超时或网络不可用' }, { status: 504 }); }
}
