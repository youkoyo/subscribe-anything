'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BookOpen, Heart, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';

interface BottomNavProps {
  className?: string;
}

export function BottomNav({ className }: BottomNavProps) {
  const pathname = usePathname();

  const navItems = [
    { href: '/subscriptions', label: '订阅', icon: BookOpen },
    { href: '/favorites', label: '收藏', icon: Heart },
    { href: '/settings', label: '配置', icon: Settings },
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
      {navItems.map(({ href, label, icon: Icon }) => {
        const active = pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              'flex min-h-[44px] min-w-[44px] flex-col items-center justify-center gap-1 px-4 py-2 transition-colors',
              active ? 'text-cyan-100' : 'text-cyan-100/55'
            )}
          >
            <Icon className="h-5 w-5 shrink-0" />
            <span className="text-[10px] font-medium">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
