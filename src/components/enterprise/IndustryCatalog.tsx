'use client';

import { useEffect, useState } from 'react';
import { MailPlus, Send } from 'lucide-react';
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
import { useAuth } from '@/contexts/AuthContext';

interface CatalogItem {
  id: string;
  name: string;
  description: string | null;
  deliveryCron?: string | null;
  maxItemsPerEmail?: number;
  subscriptionMode?: 'open' | 'approval_required';
  snapshot?: {
    keywords: string[];
    riskTerms: string[];
    regions: string[];
  };
}

interface IndustryCatalogProps {
  onSubscriptionCreated?: () => void;
}

function parseEmailInput(value: string) {
  return value
    .split(/[\n,，;；]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export default function IndustryCatalog({ onSubscriptionCreated }: IndustryCatalogProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<CatalogItem | null>(null);
  const [customCriteria, setCustomCriteria] = useState('');
  const [extraRecipientEmails, setExtraRecipientEmails] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch('/api/enterprise/industry-catalog')
      .then((res) => res.json())
      .then((data) => setItems(Array.isArray(data) ? data : []))
      .catch(() => toast({ title: '加载产业目录失败', variant: 'destructive' }))
      .finally(() => setLoading(false));
  }, [toast]);

  async function submitSubscription() {
    if (!selected || !customCriteria.trim()) {
      toast({ title: '请填写监控条件', variant: 'destructive' });
      return;
    }

    setSubmitting(true);
    const res = await fetch('/api/enterprise/industry-subscriptions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        industryConfigId: selected.id,
        customCriteria,
        extraRecipientEmails: parseEmailInput(extraRecipientEmails),
      }),
    });
    setSubmitting(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast({ title: data.error ?? '订阅失败', variant: 'destructive' });
      return;
    }

    toast({ title: selected.subscriptionMode === 'approval_required' ? '已提交审批' : '订阅已提交' });
    onSubscriptionCreated?.();
    setSelected(null);
    setCustomCriteria('');
    setExtraRecipientEmails('');
  }

  if (loading) {
    return (
      <div className="grid gap-3">
        {[1, 2, 3].map((item) => (
          <div key={item} className="h-28 animate-pulse rounded-lg border border-border bg-card" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      {items.map((item) => {
        const tags = [
          ...(item.snapshot?.keywords ?? []).slice(0, 3),
          ...(item.snapshot?.riskTerms ?? []).slice(0, 2),
          ...(item.snapshot?.regions ?? []).slice(0, 2),
        ];

        return (
          <article key={item.id} className="rounded-lg border border-border bg-card p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold text-cyan-50">{item.name}</h2>
                  <Badge variant="outline">
                    {item.subscriptionMode === 'approval_required' ? '需审批' : '开放订阅'}
                  </Badge>
                </div>
                {item.description ? (
                  <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{item.description}</p>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  {tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-md border border-cyan-300/20 bg-secondary/35 px-2 py-1 text-xs text-cyan-50/78"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  报送：{item.deliveryCron || '未启用'} · 每封最多 {item.maxItemsPerEmail ?? 10} 条
                </p>
              </div>
              <Button onClick={() => setSelected(item)}>
                <MailPlus className="h-4 w-4" />
                订阅
              </Button>
            </div>
          </article>
        );
      })}

      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-cyan-300/35 bg-card/70 px-6 py-10 text-center text-sm text-muted-foreground">
          暂无可订阅产业方向
        </div>
      ) : null}

      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>订阅{selected?.name}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <label className="grid gap-2 text-sm font-medium">
              个性化监控条件
              <Textarea
                value={customCriteria}
                onChange={(event) => setCustomCriteria(event.target.value)}
              />
            </label>
            <div className="grid gap-2 rounded-md border border-cyan-300/20 bg-secondary/30 p-3">
              <div className="text-sm font-medium">收件邮箱配置</div>
              <p className="text-xs text-muted-foreground">
                默认发送到账户邮箱：{user?.email || '当前账号邮箱'}。也可以补充同事或团队邮箱。
              </p>
              <label className="grid gap-2 text-sm font-medium">
                额外收件邮箱
                <Input
                  value={extraRecipientEmails}
                  onChange={(event) => setExtraRecipientEmails(event.target.value)}
                  placeholder="name@company.com, team@company.com"
                />
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelected(null)} disabled={submitting}>
              取消
            </Button>
            <Button onClick={submitSubscription} disabled={submitting}>
              <Send className="h-4 w-4" />
              {submitting ? '提交中...' : '提交'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
