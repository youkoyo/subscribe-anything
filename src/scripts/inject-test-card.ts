/**
 * Debug helper: insert a synthetic message card into the industry's shared pool
 * with `createdAt = now()`, then a second invocation of `run-now` will pick it up
 * and actually send an email. Use this to validate the SMTP / template pipeline
 * without waiting on the real collection cadence.
 *
 * Usage:
 *   npx tsx src/scripts/inject-test-card.ts <industryConfigId> [count]
 */
import { createHash } from 'node:crypto';
import { createId } from '@paralleldrive/cuid2';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import {
  industryMonitoringProfiles,
  messageCards,
  sources,
} from '@/lib/db/schema';

function hashContent(title: string, url: string): string {
  return createHash('sha256').update(title + url).digest('hex');
}

async function main() {
  const [, , industryConfigId, countArg] = process.argv;
  if (!industryConfigId) {
    console.error('Usage: npx tsx src/scripts/inject-test-card.ts <industryConfigId> [count]');
    process.exit(1);
  }
  const count = Math.max(1, Number(countArg ?? 1));

  const db = getDb();
  const profile = (await db
    .select()
    .from(industryMonitoringProfiles)
    .where(eq(industryMonitoringProfiles.industryConfigId, industryConfigId)))[0];

  if (!profile) {
    console.error(`[inject-test-card] No monitoring profile for industry ${industryConfigId}`);
    process.exit(1);
  }
  if (!profile.sharedSubscriptionId) {
    console.error(
      `[inject-test-card] Monitoring profile ${profile.id} has no sharedSubscriptionId — run the wizard to build the pool first.`
    );
    process.exit(1);
  }

  // Need a source row to satisfy the FK on message_cards.source_id. Reuse the first
  // source attached to the shared subscription if one exists; otherwise create a
  // synthetic one that lives only for this debug insert.
  const subscriptionId = profile.sharedSubscriptionId;
  let source = (await db
    .select()
    .from(sources)
    .where(eq(sources.subscriptionId, subscriptionId)))[0];

  if (!source) {
    const sourceId = createId();
    await db.insert(sources)
      .values({
        id: sourceId,
        subscriptionId,
        title: '调试注入源',
        url: 'about:blank',
        script: '',
        cronExpression: '0 * * * *',
        isEnabled: true,
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    source = (await db.select().from(sources).where(eq(sources.id, sourceId)))[0];
    console.log(`[inject-test-card] Created synthetic source ${sourceId}`);
  }
  if (!source) {
    throw new Error('Failed to obtain a source row for the synthetic card');
  }

  const now = new Date();
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const title = `[调试注入 ${i + 1}/${count}] 化工园区停产事件监测`;
    const sourceUrl = `https://example.com/debug/${Date.now()}-${i}`;
    await db.insert(messageCards)
      .values({
        subscriptionId,
        sourceId: source.id,
        contentHash: hashContent(title, sourceUrl),
        title,
        summary: '这是一条由 inject-test-card.ts 注入的测试卡片，用于验证邮件报送链路。',
        sourceUrl,
        publishedAt: now,
        createdAt: now,
      });
    ids.push(sourceUrl);
  }

  console.log(`[inject-test-card] Inserted ${ids.length} card(s) into pool ${subscriptionId}`);
  console.log('[inject-test-card] Now POST /api/industry-configs/<id>/run-now to dispatch.');
}

main().catch((err) => {
  console.error('[inject-test-card] fatal', err);
  process.exit(1);
});