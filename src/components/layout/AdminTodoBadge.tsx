'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';

interface AdminTodoBadgeProps {
  className?: string;
}

interface TodoSummary {
  total: number;
}

function formatCount(total: number) {
  return total > 99 ? '99+' : String(total);
}

export function AdminTodoBadge({ className }: AdminTodoBadgeProps) {
  const { user } = useAuth();
  const [total, setTotal] = useState(0);

  const loadSummary = useCallback(async () => {
    if (!user?.isAdmin) {
      setTotal(0);
      return;
    }

    const res = await fetch('/api/admin/todos/summary');
    if (!res.ok) {
      setTotal(0);
      return;
    }
    const data = (await res.json()) as TodoSummary;
    setTotal(Number.isFinite(data.total) ? data.total : 0);
  }, [user?.isAdmin]);

  useEffect(() => {
    void loadSummary();
    window.addEventListener('admin-todos:changed', loadSummary);
    return () => window.removeEventListener('admin-todos:changed', loadSummary);
  }, [loadSummary]);

  if (!user?.isAdmin || total <= 0) return null;

  return (
    <span
      className={cn(
        'ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-bold leading-none text-white shadow-[0_0_14px_rgba(248,113,113,0.55)]',
        className
      )}
    >
      {formatCount(total)}
    </span>
  );
}
