import { NextRequest, NextResponse } from 'next/server';
import { eq, count } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { getSession, hashPassword } from '@/lib/auth';
import { verifyCode, invalidateCode } from '@/lib/auth/verification';
import { isSmtpConfigured, isVerificationRequired } from '@/lib/email/smtp';
import { createId } from '@paralleldrive/cuid2';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, password, name, verificationCode } = body;

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
    }

    if (password.length < 6) {
      return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 });
    }

    const db = getDb();

    // Check if email already exists
    const existingUser = (await db.select().from(users).where(eq(users.email, email)))[0];
    if (existingUser) {
      return NextResponse.json({ error: 'Email already registered' }, { status: 400 });
    }

    // Check if this is the first user (will be admin)
    const userCount = (await db.select({ count: count() }).from(users).where(eq(users.isGuest, false)))[0];
    const isFirstUser = (userCount?.count ?? 0) === 0;

    // First user (admin) skips verification; others require it when SMTP is configured and setting is on
    if (!isFirstUser && (await isSmtpConfigured()) && (await isVerificationRequired())) {
      if (!verificationCode) {
        return NextResponse.json({ error: '请输入验证码' }, { status: 400 });
      }

      const verifyResult = await verifyCode(email, verificationCode, 'register');
      if (!verifyResult.valid) {
        return NextResponse.json({ error: verifyResult.error || '验证码错误' }, { status: 400 });
      }

      // Invalidate the used code
      if (verifyResult.codeId) {
        await invalidateCode(verifyResult.codeId);
      }
    }

    // Create user
    const userId = createId();
    const now = new Date();
    await db.insert(users).values({
      id: userId,
      email,
      passwordHash: await hashPassword(password),
      name: name || email.split('@')[0],
      isAdmin: isFirstUser,
      isGuest: false,
      createdAt: now,
      updatedAt: now,
    });

    // Set session
    const session = await getSession();
    session.userId = userId;
    session.isGuest = false;
    session.isAdmin = isFirstUser;
    await session.save();

    return NextResponse.json({
      user: {
        id: userId,
        email,
        name: name || email.split('@')[0],
        isAdmin: isFirstUser,
        isGuest: false,
      },
    });
  } catch (error) {
    console.error('[Auth] Register error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
