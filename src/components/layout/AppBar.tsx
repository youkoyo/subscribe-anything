'use client';

import { cn } from '@/lib/utils';
import { APP_NAME } from '@/lib/branding';
import { UserMenu } from './UserMenu';

interface AppBarProps {
  className?: string;
}

export function AppBar({ className }: AppBarProps) {
  return (
    <header
      className={cn(
        'fixed inset-x-0 top-0 z-40 h-14 items-center border-b border-cyan-400/25 bg-[#071946]/90 px-4 shadow-[0_12px_32px_rgba(2,10,31,0.35)] backdrop-blur-xl',
        className
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        {/* Native <img> so the browser renders the SVG as a vector at any size */}
        <img
          src="/icon.svg"
          alt=""
          aria-hidden="true"
          width={40}
          height={40}
          className="rounded-md ring-1 ring-cyan-300/50 shadow-[0_0_18px_rgba(50,202,255,0.28)]"
        />
        <span className="truncate text-sm font-semibold text-cyan-50">{APP_NAME}</span>
      </div>
      <div className="ml-auto flex items-center gap-2">
        <UserMenu />
      </div>
    </header>
  );
}
