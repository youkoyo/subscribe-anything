'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BookOpen, Heart, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';
import { APP_SHORT_NAME, APP_TAGLINE } from '@/lib/branding';
import { UserMenu } from './UserMenu';

interface NavSidebarProps {
  className?: string;
}

export function NavSidebar({ className }: NavSidebarProps) {
  const pathname = usePathname();

  const navItems = [
    { href: '/subscriptions', label: '订阅', icon: BookOpen },
    { href: '/favorites', label: '收藏', icon: Heart },
    { href: '/settings', label: '配置', icon: Settings },
  ];

  return (
    <aside
      className={cn(
        'fixed inset-y-0 left-0 z-40 w-64 flex-col border-r border-cyan-400/25 bg-[#071946]/92 shadow-[12px_0_40px_rgba(2,10,31,0.45)] backdrop-blur-xl',
        className
      )}
    >
      <div className="relative flex h-20 items-center gap-3 border-b border-cyan-400/20 px-5">
        <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-cyan-300/70 to-transparent" />
        {/* Native <img> so the browser renders the SVG as a vector at any size */}
        <img
          src="/icon.svg"
          alt=""
          aria-hidden="true"
          width={48}
          height={48}
          className="rounded-md ring-1 ring-cyan-300/50 shadow-[0_0_18px_rgba(50,202,255,0.28)]"
        />
        <div className="min-w-0">
          <div className="text-lg font-semibold leading-tight text-cyan-50">{APP_SHORT_NAME}</div>
          <div className="mt-0.5 truncate text-xs font-medium text-cyan-200/75">{APP_TAGLINE}</div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto py-4">
        <ul className="space-y-1 px-3">
          {navItems.map(({ href, label, icon: Icon }) => (
            <li key={href}>
              <Link
                href={href}
                className={cn(
                  'group flex items-center gap-3 rounded-md border border-transparent px-3 py-2.5 text-sm font-medium transition-all',
                  pathname.startsWith(href)
                    ? 'border-cyan-300/45 bg-primary text-primary-foreground shadow-[0_0_22px_rgba(32,160,255,0.28)]'
                    : 'text-cyan-100/68 hover:border-cyan-300/25 hover:bg-accent hover:text-cyan-50'
                )}
              >
                <Icon className="h-4 w-4 shrink-0 text-cyan-200/80 transition-colors group-hover:text-cyan-50" />
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <div className="space-y-1 border-t border-cyan-400/20 p-3">
        <UserMenu />
      </div>
    </aside>
  );
}
