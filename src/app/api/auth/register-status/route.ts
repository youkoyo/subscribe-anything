import { count, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { users, oauthConfig } from '@/lib/db/schema';
import { isSmtpConfigured, isVerificationRequired } from '@/lib/email/smtp';

// GET /api/auth/register-status
// Returns whether the next registration requires email verification.
export async function GET() {
  try {
    const db = getDb();
    const userCount = (await db.select({ count: count() }).from(users).where(eq(users.isGuest, false)))[0];
    const isFirstUser = (userCount?.count ?? 0) === 0;

    // Check Google OAuth availability
    const googleConfig = (await db.select().from(oauthConfig).where(eq(oauthConfig.id, 'google')))[0];
    const googleOAuthEnabled = !!(googleConfig?.enabled && googleConfig.clientId && googleConfig.clientSecret);

    // First user becomes admin and always skips verification
    if (isFirstUser) {
      return Response.json({
        needsVerification: false,
        isFirstUser: true,
        googleOAuthEnabled,
        canResetPassword: false,
      });
    }

    const needsVerification = (await isSmtpConfigured()) && (await isVerificationRequired());
    const canResetPassword = needsVerification;
    return Response.json({
      needsVerification,
      isFirstUser: false,
      googleOAuthEnabled,
      canResetPassword,
    });
  } catch (err) {
    console.error('[Auth] register-status error:', err);
    return Response.json({
      needsVerification: false,
      isFirstUser: false,
      googleOAuthEnabled: false,
      canResetPassword: false,
    }, { status: 500 });
  }
}
