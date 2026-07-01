'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { LoginForm } from './components/LoginForm';
import { OAuthButtons } from './components/OAuthButtons';
import { APP_NAME, APP_SHORT_NAME, APP_TAGLINE } from '@/lib/branding';

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login, register, loginAsGuest } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [googleOAuthEnabled, setGoogleOAuthEnabled] = useState(false);

  const redirect = searchParams.get('redirect') || '/';
  const reset = searchParams.get('reset');

  useEffect(() => {
    fetch('/api/auth/register-status')
      .then(r => r.json())
      .then(data => setGoogleOAuthEnabled(!!data.googleOAuthEnabled))
      .catch(() => {});

    // Show success message if password was reset
    if (reset === 'success') {
      setSuccessMessage('密码已重置，请使用新密码登录');
    }
  }, [reset]);

  const handleSubmit = async (email: string, password: string, name?: string, verificationCode?: string) => {
    setError(null);
    setLoading(true);

    try {
      if (mode === 'register') {
        await register(email, password, name, verificationCode);
      } else {
        await login(email, password);
      }
      router.push(redirect);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleGuestLogin = async () => {
    setError(null);
    setLoading(true);

    try {
      await loginAsGuest();
      router.push(redirect);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = () => {
    window.location.href = `/api/auth/oauth/google?redirect=${encodeURIComponent(redirect)}`;
  };

  return (
    <div className="nebula-page-bg relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      <div className="nebula-grid pointer-events-none fixed inset-0" />
      <div className="relative w-full max-w-md space-y-8 rounded-lg border border-cyan-400/28 bg-card/78 p-7 shadow-[0_24px_80px_rgba(2,10,31,0.5)] backdrop-blur-xl">
        <div className="text-center">
          {/* Logo + 主标题 */}
          <div className="flex items-center justify-center gap-3 mb-2">
            <img
              src="/icon.svg"
              alt="Logo"
              className="h-12 w-12 rounded-md ring-1 ring-cyan-300/50 shadow-[0_0_18px_rgba(50,202,255,0.28)]"
            />
            <h1 className="text-3xl font-bold text-cyan-50">
              {APP_SHORT_NAME}
            </h1>
          </div>

          {/* 副标题 - 英文 */}
          <p className="mb-2 text-sm font-medium text-cyan-200/80">
            {APP_TAGLINE}
          </p>
          <p className="mb-5 text-xs text-cyan-100/56">
            {APP_NAME}
          </p>

          <p className="text-sm text-cyan-100/70">
            {mode === 'login' ? '登录您的账户' : '创建新账户'}
          </p>
        </div>

        {successMessage && (
          <div className="rounded-md border border-emerald-300/35 bg-emerald-500/12 px-4 py-3 text-sm text-emerald-100">
            {successMessage}
          </div>
        )}

        {error && (
          <div className="rounded-md border border-rose-300/35 bg-rose-500/12 px-4 py-3 text-sm text-rose-100">
            {error}
          </div>
        )}

        <LoginForm
          mode={mode}
          loading={loading}
          onSubmit={handleSubmit}
          onToggleMode={() => setMode(mode === 'login' ? 'register' : 'login')}
        />

        <div className="space-y-3">
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-cyan-400/18" />
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="bg-card px-2 text-cyan-100/54">
                或者
              </span>
            </div>
          </div>

          <OAuthButtons
            onGoogleLogin={handleGoogleLogin}
            onGuestLogin={handleGuestLogin}
            loading={loading}
            googleOAuthEnabled={googleOAuthEnabled}
          />
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  );
}
