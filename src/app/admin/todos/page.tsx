'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ClipboardList, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/AuthContext';

interface AdminTodoItem {
  id: string;
  type: 'approve_subscription' | 'confirm_profile_expansion' | 'retry_profile_provisioning';
  title: string;
  industryName: string;
  userLabel: string;
  customCriteria: string;
  reason: string;
  actionLabel: string;
  actionEndpoint: string;
  updatedAt: string;
}

const typeLabels: Record<AdminTodoItem['type'], string> = {
  approve_subscription: '订阅审批',
  confirm_profile_expansion: '确认扩展',
  retry_profile_provisioning: '重试创建',
};

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '刚刚更新';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(
    date.getMinutes()
  ).padStart(2, '0')}`;
}

export default function AdminTodosPage() {
  const { user, loading } = useAuth();
  const { toast } = useToast();
  const [todos, setTodos] = useState<AdminTodoItem[]>([]);
  const [loadingTodos, setLoadingTodos] = useState(true);
  const [actingId, setActingId] = useState<string | null>(null);

  const loadTodos = useCallback(async () => {
    if (!user?.isAdmin) {
      setTodos([]);
      setLoadingTodos(false);
      return;
    }

    setLoadingTodos(true);
    const res = await fetch('/api/admin/todos');
    setLoadingTodos(false);
    if (!res.ok) {
      toast({ title: '加载工作台失败', variant: 'destructive' });
      return;
    }
    const data = (await res.json()) as AdminTodoItem[];
    setTodos(Array.isArray(data) ? data : []);
  }, [toast, user?.isAdmin]);

  useEffect(() => {
    if (!loading) void loadTodos();
  }, [loadTodos, loading]);

  const stats = useMemo(
    () => ({
      approveSubscription: todos.filter((todo) => todo.type === 'approve_subscription').length,
      confirmProfileExpansion: todos.filter((todo) => todo.type === 'confirm_profile_expansion')
        .length,
      retryProfileProvisioning: todos.filter((todo) => todo.type === 'retry_profile_provisioning')
        .length,
    }),
    [todos]
  );

  async function handleAction(todo: AdminTodoItem) {
    setActingId(todo.id);
    const res = await fetch(todo.actionEndpoint, { method: 'POST' });
    setActingId(null);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast({ title: data.error ?? '处理待办失败', variant: 'destructive' });
      return;
    }

    toast({ title: '待办已处理' });
    window.dispatchEvent(new Event('admin-todos:changed'));
    await loadTodos();
  }

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground">加载中...</div>;
  }

  if (!user?.isAdmin) {
    return (
      <div className="p-4 md:p-6">
        <div className="rounded-lg border border-destructive/40 bg-card p-6">
          <div className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            <h1 className="text-lg font-semibold">无权访问</h1>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">只有管理员可以查看工作台。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-6">
      <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-cyan-100/78">
            <ClipboardList className="h-5 w-5" />
            <span className="text-sm font-medium">管理员工作台</span>
          </div>
          <h1 className="mt-2 text-2xl font-semibold text-cyan-50">工作台</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            集中处理订阅审批、信息池扩展确认和失败重试，后续管理员申请与系统异常也会收敛到这里。
          </p>
        </div>
        <Button variant="outline" onClick={loadTodos} disabled={loadingTodos}>
          <RefreshCw className="h-4 w-4" />
          刷新
        </Button>
      </div>

      <div className="mb-4 grid gap-3 md:grid-cols-4">
        <div className="rounded-lg border border-cyan-300/25 bg-card p-4">
          <div className="text-sm text-muted-foreground">待处理总数</div>
          <div className="mt-2 text-2xl font-semibold text-cyan-50">{todos.length}</div>
        </div>
        <div className="rounded-lg border border-cyan-300/25 bg-card p-4">
          <div className="text-sm text-muted-foreground">订阅审批</div>
          <div className="mt-2 text-2xl font-semibold text-cyan-50">{stats.approveSubscription}</div>
        </div>
        <div className="rounded-lg border border-cyan-300/25 bg-card p-4">
          <div className="text-sm text-muted-foreground">确认扩展</div>
          <div className="mt-2 text-2xl font-semibold text-cyan-50">{stats.confirmProfileExpansion}</div>
        </div>
        <div className="rounded-lg border border-cyan-300/25 bg-card p-4">
          <div className="text-sm text-muted-foreground">重试创建</div>
          <div className="mt-2 text-2xl font-semibold text-cyan-50">{stats.retryProfileProvisioning}</div>
        </div>
      </div>

      {loadingTodos ? (
        <div className="grid gap-3">
          {[1, 2, 3].map((item) => (
            <div key={item} className="h-32 animate-pulse rounded-lg border border-border bg-card" />
          ))}
        </div>
      ) : todos.length === 0 ? (
        <div className="rounded-lg border border-dashed border-cyan-300/35 bg-card/70 px-6 py-14 text-center">
          <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-300" />
          <div className="mt-3 text-lg font-medium text-cyan-50">暂无待处理事项</div>
          <p className="mt-2 text-sm text-muted-foreground">当前没有需要管理员处理的信息池或订阅事项。</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {todos.map((todo) => (
            <article key={todo.id} className="rounded-lg border border-border bg-card p-4">
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={todo.type === 'retry_profile_provisioning' ? 'destructive' : 'default'}>
                      {typeLabels[todo.type]}
                    </Badge>
                    <span className="font-medium text-cyan-50">{todo.industryName}</span>
                    <span className="text-xs text-muted-foreground">{formatDate(todo.updatedAt)}</span>
                  </div>
                  <div className="mt-2 text-sm text-cyan-50/82">
                    {todo.userLabel}：{todo.customCriteria}
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">{todo.reason}</div>
                </div>
                <Button
                  size="sm"
                  onClick={() => handleAction(todo)}
                  disabled={actingId === todo.id}
                  variant={todo.type === 'retry_profile_provisioning' ? 'outline' : 'default'}
                >
                  {actingId === todo.id ? '处理中...' : todo.actionLabel}
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
