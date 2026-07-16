'use client';

import { Clock3, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { DEFAULT_EMAIL_DELIVERY_CRON, EMAIL_DELIVERY_SLOTS } from '@/lib/industry-configs/types';

export default function IndustryDeliveryConfigForm() {
  const { toast } = useToast();
  const [cron, setCron] = useState(DEFAULT_EMAIL_DELIVERY_CRON);
  const [timezone, setTimezone] = useState('Asia/Shanghai');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/settings/industry-delivery')
      .then(async (response) => response.ok ? response.json() : Promise.reject())
      .then((data: { cron?: string; timezone?: string }) => {
        setCron(data.cron || DEFAULT_EMAIL_DELIVERY_CRON);
        setTimezone(data.timezone || 'Asia/Shanghai');
      })
      .catch(() => toast({ title: '加载统一投递设置失败', variant: 'destructive' }))
      .finally(() => setLoading(false));
  }, [toast]);

  async function save() {
    setSaving(true);
    try {
      const response = await fetch('/api/settings/industry-delivery', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cron, timezone }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? '保存失败');
      toast({ title: '统一投递设置已保存', description: '所有已发布且启用投递的产业信息池将在 15 秒内按此节奏重载。' });
    } catch (error) {
      toast({ title: '保存失败', description: error instanceof Error ? error.message : '请求失败', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="py-8 text-center text-sm text-muted-foreground">正在加载统一投递设置…</div>;

  return <Card className="mt-2 border-cyan-300/20 bg-card/80">
    <CardHeader>
      <CardTitle className="flex items-center gap-2 text-base"><Clock3 className="h-4 w-4 text-cyan-200" />产业邮件统一投递</CardTitle>
      <CardDescription>一次设置，全体产业信息池共用。单个产业池只决定是否参与投递，不再分别设置发送时间。</CardDescription>
    </CardHeader>
    <CardContent className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
      <Label className="grid gap-2">发送频率
        <Select value={cron} onValueChange={setCron}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>{EMAIL_DELIVERY_SLOTS.map((slot) => <SelectItem key={slot.cron} value={slot.cron}>{slot.label}{slot.description ? ` · ${slot.description}` : ''}</SelectItem>)}</SelectContent>
        </Select>
      </Label>
      <Button type="button" onClick={save} disabled={saving}>
        {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}{saving ? '保存中…' : '保存统一设置'}
      </Button>
    </CardContent>
  </Card>;
}
