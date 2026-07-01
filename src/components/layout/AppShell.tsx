'use client';

import { usePathname } from 'next/navigation';
import { NavSidebar } from './NavSidebar';
import { BottomNav } from './BottomNav';
import { AppBar } from './AppBar';
import { useAuth } from '@/contexts/AuthContext';

export function AppShell({ children }: { children: React.ReactNode }) {
  const { loading } = useAuth();
  const pathname = usePathname();

  // Don't show app shell on login page, reset-password page, or while loading auth
  const isLoginPage = pathname === '/login';
  const isResetPasswordPage = pathname === '/reset-password';

  if (isLoginPage || isResetPasswordPage) {
    return <>{children}</>;
  }

  if (loading) {
    return (
      <div className="nebula-page-bg flex min-h-screen items-center justify-center">
        <div className="rounded-md border border-cyan-400/30 bg-card/80 px-4 py-2 text-sm text-muted-foreground shadow-[0_0_24px_rgba(37,167,255,0.18)]">
          加载中...
        </div>
      </div>
    );
  }

  return (
    <div className="nebula-page-bg min-h-screen text-foreground">
      <div className="nebula-grid pointer-events-none fixed inset-0 z-0" />

      {/* Desktop sidebar */}
      <NavSidebar className="hidden md:flex" />

      {/* Mobile top app bar */}
      <AppBar className="flex md:hidden" />

      {/* Main content: mobile has top padding for AppBar + bottom padding for BottomNav */}
      <main className="relative z-10 min-h-screen pb-16 pt-14 md:ml-64 md:pb-0 md:pt-0">
        {children}
      </main>

      {/* Mobile bottom nav */}
      <BottomNav className="flex md:hidden" />
    </div>
  );
}
