/**
 * One-shot script to:
 *   1. Upsert the smtp_config row with the relay credentials (incl. tlsServername).
 *   2. Call sendEmail() to dispatch a test message.
 *   3. Print SMTP info (accepted / rejected / response) so we know what really happened.
 *
 * Usage:  npx tsx src/scripts/test-smtp.ts
 *
 * Edit the constants below to point at a different recipient or to tweak the message.
 */
import { getDb } from '@/lib/db';
import { smtpConfig } from '@/lib/db/schema';
import nodemailer from 'nodemailer';
import SMTPTransport from 'nodemailer/lib/smtp-transport';
import { eq } from 'drizzle-orm';
import { sendEmail } from '@/lib/email/smtp';

const RECIPIENT = 'lts2438@163.com';
const SUBJECT = 'subscribe-anything SMTP 配置测试';
const HTML_BODY = `
  <p>这是一封来自 <b>subscribe-anything</b> 项目的 SMTP 配置自检邮件。</p>
  <p>如果你在 <code>${RECIPIENT}</code> 的收件箱或垃圾箱看到这封邮件，
  说明 SMTP 中继、隐式 TLS + SNI 主机名覆盖都已正常工作。</p>
`;

async function seedConfig() {
  const db = getDb();
  const now = new Date();
  const values = {
    id: 'default',
    provider: 'smtp',
    host: '103.129.252.46',
    port: 994,
    secure: true,
    user: 'exceptian@126.com',
    password: 'ZNZ9GCvpFtTS6hBe',
    zeaburApiKey: null,
    resendApiKey: null,
    aliyunDirectMailAccessKeyId: null,
    aliyunDirectMailAccessKeySecret: null,
    aliyunDirectMailRegion: 'cn-hangzhou',
    tlsServername: 'smtp.126.com',
    fromEmail: 'exceptian@126.com',
    fromName: 'Blog Dev',
    requireVerification: true,
    updatedAt: now,
  };
  db.insert(smtpConfig)
    .values(values)
    .onConflictDoUpdate({
      target: smtpConfig.id,
      set: values,
    })
    .run();
  console.log('[seed] smtp_config row upserted with tlsServername=smtp.126.com');
}

async function verifyHandshake() {
  // Pull config straight from DB so we mirror what sendEmail() will see.
  const db = getDb();
  const row = db.select().from(smtpConfig).where(eq(smtpConfig.id, 'default')).get();
  if (!row) throw new Error('smtp_config row missing after seed');

  const options: SMTPTransport.Options & { family?: number } = {
    host: row.host,
    port: row.port,
    secure: row.secure,
    auth: { user: row.user, pass: row.password },
    family: 4,
  };
  if (row.tlsServername) {
    options.tls = { servername: row.tlsServername as string };
  }
  const transporter = nodemailer.createTransport(options);

  console.log('[verify] Checking SMTP handshake (verifies TLS + auth)...');
  try {
    await transporter.verify();
    console.log('[verify] ✅ Handshake OK — server ready for messages');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[verify] ❌ Handshake failed:', msg);
    throw err;
  }
}

async function dispatchTest() {
  console.log(`[send] Posting test email to ${RECIPIENT}...`);
  const result = await sendEmail({
    to: RECIPIENT,
    subject: SUBJECT,
    html: HTML_BODY,
    text: 'SMTP 配置测试邮件 — 请忽略。',
  });

  if (!result.success) {
    console.error('[send] ❌ sendEmail returned failure:', result.error);
    return false;
  }
  console.log('[send] ✅ sendEmail reported success');
  return true;
}

async function main() {
  try {
    await seedConfig();
    await verifyHandshake();
    const ok = await dispatchTest();
    if (!ok) {
      process.exitCode = 1;
    }
  } catch (err) {
    console.error('[fatal]', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  }
}

main();