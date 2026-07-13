import { and, desc, eq, gt, inArray } from 'drizzle-orm';
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
import { resolveDeliverySelection, scoreToLabel, type DeliverySelectionMode } from './deliveryScoring';
import {
  renderIndustryDeliveryEmail,
  renderIndustryDigestExcelAttachment,
  renderIndustryDigestEmail,
  type DeliveryDigestSection,
  type DeliveryEmailItem,
} from './emailTemplate';

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

export function normalizeDeliveryScheduleSlot(value: Date) {
  const slot = new Date(value);
  slot.setSeconds(0, 0);
  return slot;
}

type DeliverySubscriptionRow = {
  userSub: typeof userIndustrySubscriptions.$inferSelect;
  profile: typeof industryMonitoringProfiles.$inferSelect;
  industry: typeof industryConfigs.$inferSelect;
};

type DeliveryRunEntry = {
  run: typeof industryDeliveryRuns.$inferSelect;
  created: boolean;
};

type PreparedDigestDelivery = {
  row: DeliverySubscriptionRow;
  runId: string;
  mode: DeliverySelectionMode;
  items: DeliveryEmailItem[];
  selectedCardIds: string[];
};

const DIGEST_DETAIL_ITEM_LIMIT = 500;

async function createOrReuseIndustryRun(
  db: ReturnType<typeof getDb>,
  industryConfigId: string,
  scheduledSlot: Date
): Promise<DeliveryRunEntry> {
  const existingRun = (await db
    .select()
    .from(industryDeliveryRuns)
    .where(
      and(
        eq(industryDeliveryRuns.industryConfigId, industryConfigId),
        eq(industryDeliveryRuns.scheduledFor, scheduledSlot)
      )
    ))[0];
  if (existingRun) return { run: existingRun, created: false };

  const run = (await db
    .insert(industryDeliveryRuns)
    .values({
      id: createId(),
      industryConfigId,
      scheduledFor: scheduledSlot,
      status: 'running',
      startedAt: new Date(),
      createdAt: new Date(),
    })
    .returning())[0];

  return { run, created: true };
}

async function loadActiveDeliverySubscriptions(
  db: ReturnType<typeof getDb>,
  industryConfigIds: string[]
): Promise<DeliverySubscriptionRow[]> {
  if (industryConfigIds.length === 0) return [];
  return (await db
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
        inArray(userIndustrySubscriptions.industryConfigId, industryConfigIds),
        eq(userIndustrySubscriptions.status, 'active'),
        eq(industryMonitoringProfiles.status, 'active')
      )
    ));
}

async function loadNewCardsForSubscription(db: ReturnType<typeof getDb>, row: DeliverySubscriptionRow) {
  if (!row.profile.sharedSubscriptionId) return [];
  const since = row.userSub.lastDeliveredAt ?? new Date(Date.now() - 24 * 60 * 60 * 1000);
  return (await db
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
    .limit(DIGEST_DETAIL_ITEM_LIMIT));
}

function toDeliveryEmailItems(
  selection: ReturnType<typeof resolveDeliverySelection>,
  mode: DeliverySelectionMode
): DeliveryEmailItem[] {
  return selection.selected.map(({ card, score }) => ({
    title: card.title,
    sourceName: card.sourceName ?? '未知来源',
    authorityLabel: scoreToLabel(score.authority),
    relevanceLabel: scoreToLabel(score.relevance),
    publishedAtLabel: formatDateTime(card.publishedAt ?? card.createdAt),
    summary: card.summary ?? '',
    url: (card as { sourceUrl?: string }).sourceUrl ?? '',
    reason:
      mode === 'previous'
        ? `已在上一封邮件中报送，本次继续关注；${score.matchReason ?? `相关性 ${score.relevance}`}；综合评分 ${score.total}`
        : `${score.matchReason ?? `相关性 ${score.relevance}`}；综合评分 ${score.total}`,
  }));
}

function normalizedRecipients(row: DeliverySubscriptionRow) {
  return Array.from(new Set(parseRecipientEmailsJson(row.userSub.recipientEmailsJson))).sort();
}

function recipientGroupKey(row: DeliverySubscriptionRow) {
  return `${row.userSub.userId}::${normalizedRecipients(row).join('|')}`;
}

async function markRuns(
  db: ReturnType<typeof getDb>,
  runs: DeliveryRunEntry[],
  status: 'completed' | 'failed',
  error?: string
) {
  for (const entry of runs) {
    if (!entry.created) continue;
    await db.update(industryDeliveryRuns)
      .set({ status, error: error ?? null, finishedAt: new Date() })
      .where(eq(industryDeliveryRuns.id, entry.run.id));
  }
}

export async function runIndustryDelivery(industryConfigId: string, scheduledFor = new Date()) {
  const db = getDb();
  const scheduledSlot = normalizeDeliveryScheduleSlot(scheduledFor);
  const existingRun = (await db
    .select()
    .from(industryDeliveryRuns)
    .where(
      and(
        eq(industryDeliveryRuns.industryConfigId, industryConfigId),
        eq(industryDeliveryRuns.scheduledFor, scheduledSlot)
      )
    ))[0];
  if (existingRun) return existingRun;

  const run = (await db
    .insert(industryDeliveryRuns)
    .values({
      id: createId(),
      industryConfigId,
      scheduledFor: scheduledSlot,
      status: 'running',
      startedAt: new Date(),
      createdAt: new Date(),
    })
    .returning())[0];

  try {
    const userSubs = (await db
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
      ));

    for (const row of userSubs) {
      await runUserDelivery(run.id, row.userSub.id);
    }

    await db.update(industryDeliveryRuns)
      .set({ status: 'completed', finishedAt: new Date() })
      .where(eq(industryDeliveryRuns.id, run.id));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.update(industryDeliveryRuns)
      .set({ status: 'failed', error: message, finishedAt: new Date() })
      .where(eq(industryDeliveryRuns.id, run.id));
  }

  // Re-read the run row so callers (admin run-now endpoint, scripts) get the final
  // status/error/finishedAt instead of the pre-update snapshot we inserted above.
  const finalRun =
    (await db.select().from(industryDeliveryRuns).where(eq(industryDeliveryRuns.id, run.id)))[0] ?? run;
  return finalRun;
}

export async function runIndustryDeliveryGroup(
  industryConfigIds: string[],
  scheduledFor = new Date()
) {
  const db = getDb();
  const scheduledSlot = normalizeDeliveryScheduleSlot(scheduledFor);
  const uniqueIndustryIds = Array.from(new Set(industryConfigIds)).filter(Boolean);
  const runEntries = await Promise.all(
    uniqueIndustryIds.map((industryConfigId) =>
      createOrReuseIndustryRun(db, industryConfigId, scheduledSlot)
    )
  );
  const createdEntries = runEntries.filter((entry) => entry.created);
  if (createdEntries.length === 0) return runEntries.map((entry) => entry.run);

  const runIdByIndustry = new Map(
    createdEntries.map((entry) => [entry.run.industryConfigId, entry.run.id])
  );

  try {
    const rows = (await loadActiveDeliverySubscriptions(
      db,
      Array.from(runIdByIndustry.keys())
    )).filter((row) => row.profile.sharedSubscriptionId);
    const rowsByUser = new Map<string, DeliverySubscriptionRow[]>();
    for (const row of rows) {
      const key = recipientGroupKey(row);
      const existing = rowsByUser.get(key) ?? [];
      existing.push(row);
      rowsByUser.set(key, existing);
    }

    for (const userRows of rowsByUser.values()) {
      const recipients = normalizedRecipients(userRows[0]);
      const prepared: PreparedDigestDelivery[] = [];
      for (const row of userRows) {
        const rawCards = await loadNewCardsForSubscription(db, row);
        const selection = resolveDeliverySelection({
          newCards: rawCards,
          previousCards: [],
          customCriteria: row.userSub.customCriteria,
          now: new Date(),
          maxItems: DIGEST_DETAIL_ITEM_LIMIT,
        });

        prepared.push({
          row,
          runId: runIdByIndustry.get(row.industry.id)!,
          mode: selection.mode,
          items: toDeliveryEmailItems(selection, selection.mode),
          selectedCardIds: selection.selected.map((item) => item.card.id),
        });
      }

      if (recipients.length === 0) {
        for (const item of prepared) {
          await db.insert(userDeliveryLogs)
            .values({
              id: createId(),
              runId: item.runId,
              userIndustrySubscriptionId: item.row.userSub.id,
              userId: item.row.userSub.userId,
              recipientEmailsJson: '[]',
              selectedCardIdsJson: '[]',
              subject: `${item.row.industry.name}产业信息报送`,
              status: 'skipped',
              error: '无有效收件邮箱',
              createdAt: new Date(),
            });
        }
        continue;
      }

      const sections: DeliveryDigestSection[] = prepared.map((item) => ({
        industryName: item.row.industry.name,
        customCriteria: item.row.userSub.customCriteria,
        deliveryMode: item.mode,
        totalItemCount: item.items.length,
        items: item.items,
      }));
      const email = renderIndustryDigestEmail({
        dateLabel: formatDateTime(new Date()).slice(0, 10),
        summaryLimitPerIndustry: 3,
        sections,
      });
      const attachment = renderIndustryDigestExcelAttachment({
        dateLabel: formatDateTime(new Date()).slice(0, 10),
        sections,
      });

      const sendResults = [];
      for (const recipient of recipients) {
        sendResults.push(
          await sendEmail({
            to: recipient,
            subject: email.subject,
            html: email.html,
            text: email.text,
            attachments: [attachment],
          })
        );
      }
      const failed = sendResults.find((result) => !result.success);

      for (const item of prepared) {
        await db.insert(userDeliveryLogs)
          .values({
            id: createId(),
            runId: item.runId,
            userIndustrySubscriptionId: item.row.userSub.id,
            userId: item.row.userSub.userId,
            recipientEmailsJson: JSON.stringify(recipients),
            selectedCardIdsJson: JSON.stringify(item.selectedCardIds),
            subject: email.subject,
            status: failed ? 'failed' : 'sent',
            error: failed?.error ?? null,
            sentAt: failed ? null : new Date(),
            createdAt: new Date(),
          });

        if (!failed) {
          await db.update(userIndustrySubscriptions)
            .set({ lastDeliveredAt: new Date(), updatedAt: new Date() })
            .where(eq(userIndustrySubscriptions.id, item.row.userSub.id));
        }
      }
    }

    await markRuns(db, createdEntries, 'completed');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markRuns(db, createdEntries, 'failed', message);
  }

  const refreshedRuns = await Promise.all(
    createdEntries
    .map(async (entry) => (await db.select().from(industryDeliveryRuns).where(eq(industryDeliveryRuns.id, entry.run.id)))[0])
  );
  return refreshedRuns.filter((run): run is NonNullable<typeof run> => !!run);
}

export async function runUserDelivery(runId: string, userIndustrySubscriptionId: string) {
  const db = getDb();
  const row = (await db
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
    .where(eq(userIndustrySubscriptions.id, userIndustrySubscriptionId)))[0];

  if (!row || !row.profile.sharedSubscriptionId) return null;

  const since = row.userSub.lastDeliveredAt ?? new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rawCards = (await db
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
    .limit(100));

  const selection = resolveDeliverySelection({
    newCards: rawCards,
    previousCards: [],
    customCriteria: row.userSub.customCriteria,
    now: new Date(),
    maxItems: row.industry.maxItemsPerEmail,
  });

  const recipients = parseRecipientEmailsJson(row.userSub.recipientEmailsJson);
  if (recipients.length === 0) {
    await db.insert(userDeliveryLogs)
      .values({
        id: createId(),
        runId,
        userIndustrySubscriptionId: row.userSub.id,
        userId: row.userSub.userId,
        recipientEmailsJson: JSON.stringify(recipients),
        selectedCardIdsJson: '[]',
        subject: `${row.industry.name}产业信息报送`,
        status: 'skipped',
        error: '无有效收件邮箱',
        createdAt: new Date(),
      });
    return null;
  }

  const email = renderIndustryDeliveryEmail({
    industryName: row.industry.name,
    profileTitle: row.profile.title,
    customCriteria: row.userSub.customCriteria,
    dateLabel: formatDateTime(new Date()).slice(0, 10),
    deliveryMode: selection.mode,
    items: selection.selected.map(({ card, score }) => ({
      title: card.title,
      sourceName: card.sourceName ?? '未知来源',
      authorityLabel: scoreToLabel(score.authority),
      relevanceLabel: scoreToLabel(score.relevance),
      publishedAtLabel: formatDateTime(card.publishedAt ?? card.createdAt),
      summary: card.summary ?? '',
      url: (card as { sourceUrl?: string }).sourceUrl ?? '',
      reason:
        selection.mode === 'previous'
          ? `已在上一封邮件中报送，本次继续关注；${score.matchReason ?? `相关性 ${score.relevance}`}；综合评分 ${score.total}`
          : `${score.matchReason ?? `相关性 ${score.relevance}`}；综合评分 ${score.total}`,
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

  await db.insert(userDeliveryLogs)
    .values({
      id: createId(),
      runId,
      userIndustrySubscriptionId: row.userSub.id,
      userId: row.userSub.userId,
      recipientEmailsJson: JSON.stringify(recipients),
      selectedCardIdsJson: JSON.stringify(selection.selected.map((item) => item.card.id)),
      subject: email.subject,
      status: failed ? 'failed' : 'sent',
      error: failed?.error ?? null,
      sentAt: failed ? null : new Date(),
      createdAt: new Date(),
    });

  if (!failed) {
    await db.update(userIndustrySubscriptions)
      .set({ lastDeliveredAt: new Date(), updatedAt: new Date() })
      .where(eq(userIndustrySubscriptions.id, row.userSub.id));
  }

  return { sent: !failed, selectedCount: selection.selected.length };
}
