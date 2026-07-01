'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ArrowLeft } from 'lucide-react';
import { Turnstile } from '@marsidev/react-turnstile';
import { APP_NAME, APP_SHORT_NAME, APP_TAGLINE } from '@/lib/branding';

function ResetPasswordContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get('token');

  const [step, setStep] = useState<'send' | 'verify'>('send');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [tokenValid, setTokenValid] = useState<boolean | null>(null);

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [resetting, setResetting] = useState(false);

  // Turnstile state
  const [turnstileToken, setTurnstileToken] = useState('');
  const [turnstileKey, setTurnstileKey] = useState(0);
  const [turnstileSiteKey] = useState(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || '');

  // Check if we have a token, validate it
  useEffect(() => {
    if (token) {
      setStep('verify');
      validateToken(token);
    }
  }, [token]);

  const validateToken = async (tokenToValidate: string) => {
    try {
      const res = await fetch('/api/auth/reset-password/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: tokenToValidate }),
      });
      const data = await res.json();
      setTokenValid(data.valid);
      if (!data.valid) {
        setError(data.error || '令牌无效');
      }
    } catch {
      setError('验证失败');
      setTokenValid(false);
    }
  };

  const handleSendEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Check Turnstile if configured
    if (turnstileSiteKey && !turnstileToken) {
      alert('请先完成人机验证');
      return;
    }

    setLoading(true);

    try {
      const res = await fetch('/api/auth/reset-password/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, turnstileToken }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || '发送失败');
      }

      setSuccess(true);
      // Reset turnstile token for potential next use
      setTurnstileToken('');
      setTurnstileKey(prev => prev + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : '未知错误');
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (newPassword.length < 6) {
      setError('密码至少需要 6 个字符');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }

    setResetting(true);

    try {
      const res = await fetch('/api/auth/reset-password/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || '重置失败');
      }

      router.push('/login?reset=success');
    } catch (err) {
      setError(err instanceof Error ? err.message : '未知错误');
    } finally {
      setResetting(false);
    }
  };

  const showTurnstile = turnstileSiteKey;

  return (
    <div className="nebula-page-bg relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      <div className="nebula-grid pointer-events-none fixed inset-0" />
      <div className="relative w-full max-w-md space-y-8 rounded-lg border border-cyan-400/28 bg-card/78 p-7 shadow-[0_24px_80px_rgba(2,10,31,0.5)] backdrop-blur-xl">
        <div className="text-center">
          {/* Logo + 标题 */}
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

          <p className="mb-2 text-sm font-medium text-cyan-200/80">
            {APP_TAGLINE}
          </p>
          <p className="mb-5 text-xs text-cyan-100/56">
            {APP_NAME}
          </p>

          <p className="text-sm text-cyan-100/70">
            {step === 'send' ? '重置密码' : '设置新密码'}
          </p>
        </div>

        {error && (
          <div className="rounded-md border border-rose-300/35 bg-rose-500/12 px-4 py-3 text-sm text-rose-100">
            {error}
          </div>
        )}

        {step === 'send' && (
          <>
            {success ? (
              <div className="rounded-md border border-emerald-300/35 bg-emerald-500/12 px-4 py-3 text-sm text-emerald-100">
                <p>重置邮件已发送到您的邮箱。</p>
                <p className="mt-2">邮件链接有效期 15 分钟，请及时查收。</p>
              </div>
            ) : (
              <form onSubmit={handleSendEmail} className="space-y-4">
                <div>
                  <Label htmlFor="email">邮箱</Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="your@email.com"
                    required
                    disabled={loading}
                  />
                </div>

                {/* Turnstile 验证组件 */}
                {showTurnstile && (
                  <div className="flex justify-center py-2">
                    <Turnstile
                      key={turnstileKey}
                      siteKey={turnstileSiteKey}
                      onSuccess={(token) => setTurnstileToken(token)}
                      onError={() => setTurnstileToken('')}
                      onExpire={() => setTurnstileToken('')}
                    />
                  </div>
                )}

                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? '发送中...' : '发送重置邮件'}
                </Button>
              </form>
            )}
          </>
        )}

        {step === 'verify' && (
          <>
            {tokenValid === null ? (
              <div className="text-center py-8">
                <div className="mx-auto h-8 w-8 animate-spin rounded-full border-b-2 border-cyan-300"></div>
                <p className="mt-4 text-sm text-cyan-100/70">验证中...</p>
              </div>
            ) : tokenValid === false ? (
              <div className="space-y-4">
                <p className="text-sm text-cyan-100/70">
                  重置链接无效或已过期。请重新发起密码重置。
                </p>
                <Button
                  onClick={() => router.push('/reset-password')}
                  className="w-full"
                >
                  重新发送
                </Button>
              </div>
            ) : (
              <form onSubmit={handleResetPassword} className="space-y-4">
                <div>
                  <Label htmlFor="newPassword">新密码</Label>
                  <Input
                    id="newPassword"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="至少 6 个字符"
                    required
                    minLength={6}
                    disabled={resetting}
                  />
                </div>

                <div>
                  <Label htmlFor="confirmPassword">确认密码</Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="再次输入新密码"
                    required
                    minLength={6}
                    disabled={resetting}
                  />
                </div>

                <Button type="submit" className="w-full" disabled={resetting}>
                  {resetting ? '重置中...' : '确认重置'}
                </Button>
              </form>
            )}
          </>
        )}

        <div className="flex justify-center">
          <Button
            type="button"
            variant="ghost"
            onClick={() => router.push('/login')}
            className="text-sm"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            返回登录
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordContent />
    </Suspense>
  );
}
