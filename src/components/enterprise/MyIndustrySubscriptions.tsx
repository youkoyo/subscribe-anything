'use client';

import { useEffect, useState } from 'react';
import { Pause, Pencil, Play, Save } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';

interface MySubscriptionRow {
  subscription: {
    id: string;
    status: string;
    customCriteria: string;
    recipientEmailsJson: string;
  };
  industry: { name: string };
  profile: { title: string; status: string } | null;
}

function parseRecipientEmailsJson(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch {
    return [];
  }
}

function parseEmailInput(value: string) {
  return value
    .split(/[\n,，;；]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export default function MyIndustrySubscriptions() {
  const { toast } = useToast();
  const [rows, setRows] = useState<MySubscriptionRow[]>([]);
  const [editing, setEditing] = useState<MySubscriptionRow | null>(null);
  const [customCriteria, setCustomCriteria] = useState('');
  const [extraRecipientEmails, setExtraRecipientEmails] = useState('');
  const [saving, setSaving] = useState(false);

  async function loadRows() {
    const res = await fetch('/api/enterprise/my-industry-subscriptions');
    if (!res.ok) {
      toast({ title: '加载我的订阅失败', variant: 'destructive' });
      return;
    }
    setRows(await res.json());
  }

  useEffect(() => {
    loadRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openEdit(row: MySubscriptionRow) {
    setEditing(row);
    setCustomCriteria(row.subscription.customCriteria);
    setExtraRecipientEmails(parseRecipientEmailsJson(row.subscription.recipientEmailsJson).join(', '));
  }

  async function saveEdit() {
    if (!editing) return;
    setSaving(true);
    const res = await fetch(`/api/enterprise/my-industry-subscriptions/${editing.subscription.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customCriteria,
        extraRecipientEmails: parseEmailInput(extraRecipientEmails),
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast({ title: data.error ?? '保存失败', variant: 'destructive' });
      return;
    }
    setEditing(null);
    await loadRows();
  }

  async function pause(id: string, paused: boolean) {
    const res = await fetch(`/api/enterprise/my-industry-subscriptions/${id}/pause`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paused }),
    });
    if (!res.ok) {
      toast({ title: '状态更新失败', variant: 'destructive' });
      return;
    }
    await loadRows();
  }

  return (
    <section className="mt-8">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">我的产业订阅</h2>
        <Badge variant="outline">{rows.length} 项</Badge>
      </div>
      <div className="grid gap-3">
        {rows.map((row) => {
          const paused = row.subscription.status === 'paused';
          const recipients = parseRecipientEmailsJson(row.subscription.recipientEmailsJson);
          return (
            <article key={row.subscription.id} className="rounded-lg border border-border bg-card p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="font-medium text-cyan-50">{row.industry.name}</div>
                    <Badge variant={paused ? 'secondary' : 'default'}>{row.subscription.status}</Badge>
                  </div>
                  <div className="mt-2 text-sm text-muted-foreground">{row.subscription.customCriteria}</div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    需求簇：{row.profile?.title ?? '匹配中'} · 收件邮箱：{recipients.join('、') || '未配置'}
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button variant="outline" size="sm" onClick={() => openEdit(row)}>
                    <Pencil className="h-4 w-4" />
                    编辑
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => pause(row.subscription.id, !paused)}
                  >
                    {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                    {paused ? '恢复' : '暂停'}
                  </Button>
                </div>
              </div>
            </article>
          );
        })}

        {rows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-cyan-300/35 bg-card/70 px-6 py-10 text-center text-sm text-muted-foreground">
            暂无产业订阅
          </div>
        ) : null}
      </div>

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>编辑产业订阅</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <label className="grid gap-2 text-sm font-medium">
              个性化监控条件
              <Textarea
                value={customCriteria}
                onChange={(event) => setCustomCriteria(event.target.value)}
              />
            </label>
            <label className="grid gap-2 text-sm font-medium">
              额外收件邮箱
              <Input
                value={extraRecipientEmails}
                onChange={(event) => setExtraRecipientEmails(event.target.value)}
              />
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={saving}>
              取消
            </Button>
            <Button onClick={saveEdit} disabled={saving}>
              <Save className="h-4 w-4" />
              {saving ? '保存中...' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
