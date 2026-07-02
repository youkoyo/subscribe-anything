import { and, desc, eq, gt } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
import { getDb } from '@/lib/db';
import {
  industryConfigs,
  industryDeliveryRuns,
  industryMonitoringProfiles,
  messageCards,
  sources,
  userDeliveryLogs,
  userIndustrySubscriptions,
} from '@/lib/db/schema';
import { sendEmail } from '@/lib/email/smtp';
import { parseRecipientEmailsJson } from './recipientEmails';
import { scoreToLabel, selectDeliveryCards } from './deliveryScoring';
import { renderIndustryDeliveryEmail } from './emailTemplate';

function formatDateTime(value: Date | string | null | undefined) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(
    date.getMinutes()
  ).padStart(2, '0')}`;
}

export async function runIndustryDelivery(industryConfigId: string, scheduledFor = new Date()) {
  const db = getDb();
  const run = db
    .insert(industryDeliveryRuns)
    .values({
      id: createId(),
      industryConfigId,
      scheduledFor,
      status: 'running',
      startedAt: new Date(),
      createdAt: new Date(),
    })
    .returning()
    .get();

  try {
    const userSubs = db
      .select({
        userSub: userIndustrySubscriptions,
        profile: industryMonitoringProfiles,
        industry: industryConfigs,
      })
      .from(userIndustrySubscriptions)
      .innerJoin(
        industryMonitoringProfiles,
        eq(userIndustrySubscriptions.monitoringProfileId, industryMonitoringProfiles.id)
      )
      .innerJoin(industryConfigs, eq(userIndustrySubscriptions.industryConfigId, industryConfigs.id))
      .where(
        and(
          eq(userIndustrySubscriptions.industryConfigId, industryConfigId),
          eq(userIndustrySubscriptions.status, 'active'),
          eq(industryMonitoringProfiles.status, 'active')
        )
      )
      .all();

    for (const row of userSubs) {
      await runUserDelivery(run.id, row.userSub.id);
    }

    db.update(industryDeliveryRuns)
      .set({ status: 'completed', finishedAt: new Date() })
      .where(eq(industryDeliveryRuns.id, run.id))
      .run();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    db.update(industryDeliveryRuns)
      .set({ status: 'failed', error: message, finishedAt: new Date() })
      .where(eq(industryDeliveryRuns.id, run.id))
      .run();
  }

  return run;
}

export async function runUserDelivery(runId: string, userIndustrySubscriptionId: string) {
  const db = getDb();
  const row = db
    .select({
      userSub: userIndustrySubscriptions,
      profile: industryMonitoringProfiles,
      industry: industryConfigs,
    })
    .from(userIndustrySubscriptions)
    .innerJoin(
      industryMonitoringProfiles,
      eq(userIndustrySubscriptions.monitoringProfileId, industryMonitoringProfiles.id)
    )
    .innerJoin(industryConfigs, eq(userIndustrySubscriptions.industryConfigId, industryConfigs.id))
    .where(eq(userIndustrySubscriptions.id, userIndustrySubscriptionId))
    .get();

  if (!row || !row.profile.sharedSubscriptionId) return null;

  const since = row.userSub.lastDeliveredAt ?? new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rawCards = db
    .select({
      id: messageCards.id,
      title: messageCards.title,
      summary: messageCards.summary,
      sourceName: sources.title,
      sourceUrl: messageCards.sourceUrl,
      publishedAt: messageCards.publishedAt,
      createdAt: messageCards.createdAt,
    })
    .from(messageCards)
    .innerJoin(sources, eq(messageCards.sourceId, sources.id))
    .where(
      and(
        eq(messageCards.subscriptionId, row.profile.sharedSubscriptionId),
        gt(messageCards.createdAt, since)
      )
    )
    .orderBy(desc(messageCards.createdAt))
    .limit(100)
    .all();

  const selected = selectDeliveryCards({
    cards: rawCards,
    customCriteria: row.userSub.customCriteria,
    now: new Date(),
    maxItems: row.industry.maxItemsPerEmail,
  });

  const recipients = parseRecipientEmailsJson(row.userSub.recipientEmailsJson);
  if (selected.length === 0 || recipients.length === 0) {
    db.insert(userDeliveryLogs)
      .values({
        id: createId(),
        runId,
        userIndustrySubscriptionId: row.userSub.id,
        userId: row.userSub.userId,
        recipientEmailsJson: JSON.stringify(recipients),
        selectedCardIdsJson: '[]',
        subject: `${row.industry.name}产业信息报送`,
        status: 'skipped',
        error: selected.length === 0 ? '无高相关新增信息' : '无有效收件邮箱',
        createdAt: new Date(),
      })
      .run();
    return null;
  }

  const email = renderIndustryDeliveryEmail({
    industryName: row.industry.name,
    profileTitle: row.profile.title,
    customCriteria: row.userSub.customCriteria,
    dateLabel: formatDateTime(new Date()).slice(0, 10),
    items: selected.map(({ card, score }) => ({
      title: card.title,
      sourceName: card.sourceName ?? '未知来源',
      authorityLabel: scoreToLabel(score.authority),
      relevanceLabel: scoreToLabel(score.relevance),
      publishedAtLabel: formatDateTime(card.publishedAt ?? card.createdAt),
      summary: card.summary ?? '',
      url: (card as { sourceUrl?: string }).sourceUrl ?? '',
      reason: `相关性 ${score.relevance}，综合评分 ${score.total}`,
    })),
  });

  const sendResults = [];
  for (const recipient of recipients) {
    sendResults.push(
      await sendEmail({
        to: recipient,
        subject: email.subject,
        html: email.html,
        text: email.text,
      })
    );
  }
  const failed = sendResults.find((result) => !result.success);

  db.insert(userDeliveryLogs)
    .values({
      id: createId(),
      runId,
      userIndustrySubscriptionId: row.userSub.id,
      userId: row.userSub.userId,
      recipientEmailsJson: JSON.stringify(recipients),
      selectedCardIdsJson: JSON.stringify(selected.map((item) => item.card.id)),
      subject: email.subject,
      status: failed ? 'failed' : 'sent',
      error: failed?.error ?? null,
      sentAt: failed ? null : new Date(),
      createdAt: new Date(),
    })
    .run();

  if (!failed) {
    db.update(userIndustrySubscriptions)
      .set({ lastDeliveredAt: new Date(), updatedAt: new Date() })
      .where(eq(userIndustrySubscriptions.id, row.userSub.id))
      .run();
  }

  return { sent: !failed, selectedCount: selected.length };
}
