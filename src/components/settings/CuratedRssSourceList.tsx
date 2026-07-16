'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/use-toast';

type Source = { id: string; title: string; feedUrl: string; originalCategory: string; preferencesJson: string; trustLevel: string };
const empty = { title: '', feedUrl: '', originalCategory: '新闻', preferences: ['mainstream'], trustLevel: 'medium', defaultUsage: 'discovery', topicTags: [], keywords: [] };

export default function CuratedRssSourceList() {
  const { toast } = useToast(); const [items, setItems] = useState<Source[]>([]); const [query, setQuery] = useState(''); const [form, setForm] = useState<any>(empty); const [editing, setEditing] = useState<Source | null>(null);
  const load = async () => { const res = await fetch('/api/settings/curated-rss-sources'); if (res.ok) setItems(await res.json()); };
  useEffect(() => { void load(); }, []);
  const save = async () => { const url = editing ? `/api/settings/curated-rss-sources/${editing.id}` : '/api/settings/curated-rss-sources'; const res = await fetch(url, { method: editing ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) }); if (!res.ok) return toast({ title: '保存失败', variant: 'destructive' }); setForm(empty); setEditing(null); await load(); };
  const remove = async (id: string) => { if (!confirm('确认删除该预置 RSS 源？不会影响已建立的信息池。')) return; await fetch(`/api/settings/curated-rss-sources/${id}`, { method: 'DELETE' }); await load(); };
  const edit = (item: Source) => { setEditing(item); setForm({ ...empty, title: item.title, feedUrl: item.feedUrl, originalCategory: item.originalCategory, trustLevel: item.trustLevel, preferences: JSON.parse(item.preferencesJson) }); };
  return <div className="space-y-4 py-2"><div className="grid gap-2 md:grid-cols-3"><Input placeholder="源名称" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })}/><Input placeholder="https://example.com/feed.xml" value={form.feedUrl} onChange={e => setForm({ ...form, feedUrl: e.target.value })}/><Button onClick={save}>{editing ? '保存编辑' : '新增预置 RSS 源'}</Button></div><Input placeholder="搜索名称或 RSS 地址" value={query} onChange={e => setQuery(e.target.value)}/><div className="space-y-2">{items.filter(item => `${item.title} ${item.feedUrl}`.toLowerCase().includes(query.toLowerCase())).map(item => <div key={item.id} className="flex gap-3 rounded-md border p-3"><div className="min-w-0 flex-1"><div className="font-medium">{item.title}</div><div className="truncate text-xs text-muted-foreground">{item.feedUrl}</div><div className="mt-1 text-xs text-muted-foreground">{item.originalCategory} · {item.trustLevel}</div></div><Button size="sm" variant="outline" onClick={() => edit(item)}>编辑</Button><Button size="sm" variant="outline" className="text-destructive" onClick={() => remove(item.id)}>删除</Button></div>)}</div></div>;
}
