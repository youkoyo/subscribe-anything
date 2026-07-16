'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, KeyRound, Loader2, TestTube2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';

export default function FirecrawlConfigForm() {
  const { toast } = useToast();
  const [apiKey, setApiKey] = useState('');
  const [hasExistingKey, setHasExistingKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    fetch('/api/settings/firecrawl')
      .then(async (response) => response.ok ? response.json() : Promise.reject())
      .then((data: { configured?: boolean }) => setHasExistingKey(Boolean(data.configured)))
      .catch(() => toast({ title: '加载失败', description: '无法读取 Firecrawl 配置', variant: 'destructive' }))
      .finally(() => setLoading(false));
  }, [toast]);

  async function save() {
    setSaving(true);
    try {
      const response = await fetch('/api/settings/firecrawl', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apiKey }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? '保存失败');
      setApiKey('');
      setHasExistingKey(true);
      toast({ title: '已保存', description: 'Firecrawl 将用于网页采集与验证。' });
    } catch (error) {
      toast({ title: '保存失败', description: error instanceof Error ? error.message : '请求失败', variant: 'destructive' });
    } finally { setSaving(false); }
  }

  async function testConnection() {
    setTesting(true);
    try {
      const response = await fetch('/api/settings/firecrawl/test', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apiKey }),
      });
      const data = await response.json().catch(() => ({}));
      toast(response.ok
        ? { title: '连接成功', description: 'Firecrawl API 可用。' }
        : { title: '连接失败', description: data.error ?? '请求失败', variant: 'destructive' });
    } finally { setTesting(false); }
  }

  if (loading) return <div className="py-8 text-center text-sm text-muted-foreground">正在加载网页采集配置…</div>;

  return <Card className="mt-2 border-cyan-300/20 bg-card/80">
    <CardHeader>
      <CardTitle className="flex items-center gap-2 text-base"><KeyRound className="h-4 w-4 text-cyan-200" />Firecrawl 网页采集</CardTitle>
      <CardDescription>用于旧版发现源中的网页正文采集与验证，优先于 AI 生成网页脚本。</CardDescription>
    </CardHeader>
    <CardContent className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="firecrawl-api-key">API Key</Label>
        <Input id="firecrawl-api-key" type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)}
          placeholder={hasExistingKey ? '已保存；留空则保持不变' : 'fc-…'} autoComplete="off" />
        {hasExistingKey ? <p className="flex items-center gap-1.5 text-xs text-emerald-300"><CheckCircle2 className="h-3.5 w-3.5" />已保存 API Key（不会回显）</p> : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={save} disabled={saving || (!apiKey && !hasExistingKey)}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <KeyRound className="mr-2 h-4 w-4" />}{saving ? '保存中…' : '保存配置'}
        </Button>
        <Button type="button" variant="outline" onClick={testConnection} disabled={testing || (!apiKey && !hasExistingKey)}>
          {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <TestTube2 className="mr-2 h-4 w-4" />}{testing ? '测试中…' : '测试连接'}
        </Button>
      </div>
    </CardContent>
  </Card>;
}
