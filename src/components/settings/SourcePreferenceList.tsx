'use client';

import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

type Source = { id: string; name: string; url: string; sourceType: string; priority: string; isEnabled: boolean };
const blank = { name: '', url: '', sourceType: 'general_news', priority: 'preferred' };

export default function SourcePreferenceList() {
  const [sources, setSources] = useState<Source[]>([]); const [form, setForm] = useState(blank);
  const load = () => fetch('/api/settings/source-preferences').then((r) => r.json()).then(setSources).catch(() => {});
  useEffect(() => { void load(); }, []);
  const add = async () => { if (!form.name.trim() || !form.url.trim()) return; await fetch('/api/settings/source-preferences', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) }); setForm(blank); load(); };
  const patch = async (id: string, update: Partial<Source>) => { await fetch(`/api/settings/source-preferences/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(update) }); load(); };
  return <div className="space-y-3">
    <p className="text-sm text-muted-foreground">发现源会优先检索“必查”站点，但仍允许 AI 扩展发现其他来源；不要把地方站点设为全局默认，按需由管理员添加。</p>
    <div className="rounded-lg border divide-y">
      {sources.map((source) => <div key={source.id} className="flex flex-wrap items-center gap-2 p-3">
        <div className="min-w-[11rem] flex-1"><p className="text-sm font-medium">{source.name}</p><p className="text-xs text-muted-foreground truncate">{source.url}</p></div>
        <Select value={source.priority} onValueChange={(priority) => patch(source.id, { priority })}><SelectTrigger className="w-24 h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="required">必查</SelectItem><SelectItem value="preferred">优先</SelectItem><SelectItem value="supplemental">补充</SelectItem></SelectContent></Select>
        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => patch(source.id, { isEnabled: !source.isEnabled })}>{source.isEnabled ? '已启用' : '已停用'}</Button>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={async () => { await fetch(`/api/settings/source-preferences/${source.id}`, { method: 'DELETE' }); load(); }}><Trash2 className="h-4 w-4" /></Button>
      </div>)}
    </div>
    <div className="grid gap-2 md:grid-cols-4"><Input placeholder="站点名称" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /><Input placeholder="https://..." value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} /><Select value={form.priority} onValueChange={(priority) => setForm({ ...form, priority })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="required">必查</SelectItem><SelectItem value="preferred">优先</SelectItem><SelectItem value="supplemental">补充</SelectItem></SelectContent></Select><Button onClick={add}><Plus className="mr-1 h-4 w-4" />添加来源</Button></div>
  </div>;
}
