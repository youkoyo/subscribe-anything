'use client';

import { useCallback, useEffect, useState } from 'react';
import { Pause, Pencil, Play, Save, Trash2 } from 'lucide-react';
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
import { parseRecipientEmailsJson } from '@/lib/enterprise/recipientEmails';
import { getIndustrySubscriptionProgress } from '@/lib/enterprise/subscriptionProgress';
import { cn } from '@/lib/utils';

interface MySubscriptionRow {
  subscription: {
    id: string;
    status: string;
    customCriteria: string;
    recipientEmailsJson: string;
  };
  industry: { name: string };
  profile: { title: string; status: string; provisioningError?: string | null } | null;
}

interface MyIndustrySubscriptionsProps {
  refreshKey?: number;
  className?: string;
  title?: string;
}

function parseEmailInput(value: string) {
  return value
    .split(/[\n,，;；]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export default function MyIndustrySubscriptions({
  refreshKey = 0,
  className,
  title = '我的订阅',
}: MyIndustrySubscriptionsProps) {
  const { toast } = useToast();
  const [rows, setRows] = useState<MySubscriptionRow[]>([]);
  const [editing, setEditing] = useState<MySubscriptionRow | null>(null);
  const [customCriteria, setCustomCriteria] = useState('');
  const [extraRecipientEmails, setExtraRecipientEmails] = useState('');
  const [saving, setSaving] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const loadRows = useCallback(async () => {
    const res = await fetch('/api/enterprise/my-industry-subscriptions');
    if (!res.ok) {
      toast({ title: '加载我的订阅失败', variant: 'destructive' });
      return;
    }
    setRows(await res.json());
  }, [toast]);

  useEffect(() => {
    void loadRows();
  }, [loadRows, refreshKey]);

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

  async function cancelSubscription(id: string) {
    if (!window.confirm('确认取消订阅？你将不再收到这个产业信息池的后续邮件。')) return;
    setCancellingId(id);
    try {
      const res = await fetch(`/api/enterprise/my-industry-subscriptions/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to cancel subscription');
      setRows((previous) => previous.filter((row) => row.subscription.id !== id));
      toast({ title: '订阅已取消' });
    } catch {
      toast({ title: '取消订阅失败', variant: 'destructive' });
    } finally {
      setCancellingId(null);
    }
  }

  return (
    <section className={cn('mt-8', className)}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">{title}</h2>
        <Badge variant="outline">{rows.length} 项</Badge>
      </div>
      <div className="grid gap-3">
        {rows.map((row) => {
          const paused = row.subscription.status === 'paused';
          const recipients = parseRecipientEmailsJson(row.subscription.recipientEmailsJson);
          const progress = getIndustrySubscriptionProgress({
            subscriptionStatus: row.subscription.status,
            profileStatus: row.profile?.status ?? null,
            provisioningError: row.profile?.provisioningError ?? null,
          });
          const progressPercent = `${Math.round((progress.step / progress.totalSteps) * 100)}%`;

          return (
            <article key={row.subscription.id} className="rounded-lg border border-border bg-card p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="font-medium text-cyan-50">{row.industry.name}</div>
                    <Badge variant={progress.badgeVariant}>{progress.label}</Badge>
                  </div>
                    <div className="mt-2 text-sm text-muted-foreground">
                      {row.subscription.customCriteria || '未设置个性化条件（接收整个产业信息池）'}
                    </div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    信息池：{row.profile?.title ?? '等待管理员发布'} · 收件邮箱：
                    {recipients.join('、') || '未配置'}
                  </div>
                  <div className="mt-3 max-w-xl">
                    <div className="mb-1 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                      <span>{progress.detail}</span>
                      <span>
                        {progress.step}/{progress.totalSteps}
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-secondary">
                      <div className="h-full rounded-full bg-primary" style={{ width: progressPercent }} />
                    </div>
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
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => cancelSubscription(row.subscription.id)}
                    disabled={cancellingId === row.subscription.id}
                  >
                    <Trash2 className="h-4 w-4" />
                    {cancellingId === row.subscription.id ? '取消中…' : '取消订阅'}
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
              个性化监控条件（可选）
              <Textarea
                value={customCriteria}
                onChange={(event) => setCustomCriteria(event.target.value)}
                placeholder="留空则接收该产业信息池内的全部信息"
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
