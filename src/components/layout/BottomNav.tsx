'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Activity,
  BookOpen,
  Database,
  Factory,
  LayoutDashboard,
  Plus,
  Settings,
  SlidersHorizontal,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';

interface BottomNavProps {
  className?: string;
}

export function BottomNav({ className }: BottomNavProps) {
  const pathname = usePathname();
  const { user } = useAuth();

  const navItems = user?.isAdmin
    ? [
        { href: '/admin/todos', label: '工作台', icon: LayoutDashboard },
        { href: '/industry-configs/new', label: '新建', icon: Plus },
        { href: '/industry-configs', label: '信息池', icon: Database, exact: true },
        { href: '/industry-configs/monitoring', label: '监控', icon: Activity },
        { href: '/settings', label: '配置', icon: Settings },
      ]
    : [
        { href: '/subscriptions', label: '我的订阅', icon: BookOpen },
        { href: '/industry-configs', label: '产业目录', icon: Factory, exact: true },
        { href: '/settings', label: '个人配置', icon: SlidersHorizontal },
      ];

  return (
    <nav
      className={cn(
        'fixed inset-x-0 bottom-0 z-40 items-center justify-around border-t border-cyan-400/25 bg-[#071946]/92 shadow-[0_-12px_34px_rgba(2,10,31,0.35)] backdrop-blur-xl',
        'pb-[env(safe-area-inset-bottom)]',
        className
      )}
      style={{ touchAction: 'manipulation' }}
    >
      {navItems.map(({ href, label, icon: Icon, exact }) => {
        const active = exact ? pathname === href : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              'flex min-h-[44px] min-w-[44px] flex-col items-center justify-center gap-1 px-4 py-2 transition-colors',
              active ? 'text-cyan-100' : 'text-cyan-100/55'
            )}
          >
            <span className="relative">
              <Icon className="h-5 w-5 shrink-0" />
            </span>
            <span className="text-[10px] font-medium">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
