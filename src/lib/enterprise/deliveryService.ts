import { and, desc, eq, inArray, sql } from 'drizzle-orm';
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
import {
  resolveDeliverySelection,
  scoreCardsForTrace,
  scoreToLabel,
  type DeliverySelectionMode,
} from './deliveryScoring';
import {
  formatDeliveryTrace,
  logDeliveryTrace,
  summarizeTrace,
  type DeliveryTrace,
  type ScoredTraceCard,
} from './deliveryLogger';
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
  run: typeof industryDeliveryRuns.$inferSelect | null;
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

  try {
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
  } catch (err) {
    // The industry config was deleted between when the scheduler loaded it
    // into memory and when the cron fired. PostgreSQL FK violation (23503)
    // surfaces here. Surface a clean `missing: true` so the caller can
    // skip this industry and the scheduler can prune its stale entry.
    if (isForeignKeyViolation(err)) {
      console.warn(
        `[DeliveryService] industry_config ${industryConfigId} not found ` +
          `(deleted after scheduler registered it) — skipping run for slot ${scheduledSlot.toISOString()}`
      );
      return { run: null, created: false };
    }
    throw err;
  }
}

/** Postgres foreign-key violation: SQLSTATE 23503. */
function isForeignKeyViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  // node-postgres puts the SQLSTATE on `code` as a 5-char string
  const code = (err as { code?: string }).code;
  return code === '23503';
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
  // Load ALL matching cards. Time-based dedup is handled by filtering out
  // cards already sent in previous deliveries (via loadPreviouslyDeliveredCards),
  // and freshness is handled by scoring. SQL-level time windows cause empty
  // emails when posts are infrequent, which is normal for niche industries.
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
        eq(messageCards.meetsCriteriaFlag, true)
      )
    )
    .orderBy(desc(messageCards.createdAt))
    .limit(DIGEST_DETAIL_ITEM_LIMIT));
}

/**
 * Count cards in the pool for delivery trace diagnostics.
 */
async function loadCardFilterStats(
  db: ReturnType<typeof getDb>,
  row: DeliverySubscriptionRow
): Promise<{
  allInPool: number;
  failsMeets: number;
}> {
  if (!row.profile.sharedSubscriptionId) {
    return { allInPool: 0, failsMeets: 0 };
  }
  const result = await db
    .select({
      allInPool: sql<number>`count(*)::int`,
      failsMeets: sql<number>`count(*) filter (where ${messageCards.meetsCriteriaFlag} = false)::int`,
    })
    .from(messageCards)
    .where(eq(messageCards.subscriptionId, row.profile.sharedSubscriptionId));
  const row0 = result[0] ?? { allInPool: 0, failsMeets: 0 };
  return {
    allInPool: Number(row0.allInPool),
    failsMeets: Number(row0.failsMeets),
  };
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
    reason: score.matchReason ?? `相关性 ${score.relevance}`,
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
    if (!entry.created || !entry.run) continue;
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

  let run: typeof industryDeliveryRuns.$inferSelect;
  try {
    run = (await db
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
  } catch (err) {
    // The industry config was deleted between when the caller looked it up
    // and when we tried to insert. Don't crash — surface a clean error.
    if (isForeignKeyViolation(err)) {
      const message = `产业配置 ${industryConfigId} 已被删除，无法报送`;
      console.warn(`[DeliveryService] ${message}`);
      throw new Error(message);
    }
    throw err;
  }

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

function parseSelectedCardIds(value: string | null | undefined) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((item) => String(item)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

async function loadPreviouslyDeliveredCards(
  db: ReturnType<typeof getDb>,
  userIndustrySubscriptionId: string
) {
  const previousLog = (await db
    .select({ selectedCardIdsJson: userDeliveryLogs.selectedCardIdsJson })
    .from(userDeliveryLogs)
    .where(
      and(
        eq(userDeliveryLogs.userIndustrySubscriptionId, userIndustrySubscriptionId),
        eq(userDeliveryLogs.status, 'sent')
      )
    )
    .orderBy(desc(userDeliveryLogs.createdAt))
    .limit(1))[0];

  const previousIds = parseSelectedCardIds(previousLog?.selectedCardIdsJson);
  if (previousIds.length === 0) return [];

  const rows = (await db
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
    .where(inArray(messageCards.id, previousIds)));

  const byId = new Map(rows.map((card) => [card.id, card]));
  return previousIds
    .map((id) => byId.get(id))
    .filter((card): card is NonNullable<typeof card> => !!card);
}

export interface DeliveryGroupResult {
  runs: Array<typeof industryDeliveryRuns.$inferSelect>;
  /** Industry ids that were registered but no longer exist in the DB.
   *  Caller should prune these from any in-memory cache. */
  missing: string[];
}

export async function runIndustryDeliveryGroup(
  industryConfigIds: string[],
  scheduledFor = new Date()
): Promise<DeliveryGroupResult> {
  const db = getDb();
  const scheduledSlot = normalizeDeliveryScheduleSlot(scheduledFor);
  const uniqueIndustryIds = Array.from(new Set(industryConfigIds)).filter(Boolean);
  const runEntries = await Promise.all(
    uniqueIndustryIds.map((industryConfigId) =>
      createOrReuseIndustryRun(db, industryConfigId, scheduledSlot)
    )
  );
  const createdEntries: Array<{ run: typeof industryDeliveryRuns.$inferSelect; created: true }> =
    runEntries.filter(
      (entry): entry is { run: typeof industryDeliveryRuns.$inferSelect; created: boolean } =>
        entry.created && entry.run !== null
    ).map((entry) => ({ run: entry.run, created: true as const }));
  if (createdEntries.length === 0) {
    // Return whatever existing runs we found (may be empty if all industries
    // were deleted since the scheduler registered them).
    const existingRuns = runEntries.flatMap((entry) => (entry.run ? [entry.run] : []));
    const missingIds: string[] = [];
    for (let i = 0; i < runEntries.length; i++) {
      if (runEntries[i].run === null) missingIds.push(uniqueIndustryIds[i]);
    }
    return { runs: existingRuns, missing: missingIds };
  }

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
      // One trace per user-row (= per industry profile) so the admin can see
      // exactly why a particular user's email was empty/short.
      const traces: DeliveryTrace[] = [];
      for (const row of userRows) {
        const startedAt = Date.now();
        const filterStats = await loadCardFilterStats(db, row);
        const rawCards = await loadNewCardsForSubscription(db, row);

        // Build the trace-scored list (always uses the *new* cards only;
        // for the "previous" fallback we still report the new-card trace so
        // the admin can see why new cards alone weren't enough).
        const trace = scoreCardsForTrace({
          cards: rawCards,
          customCriteria: row.userSub.customCriteria,
          now: new Date(),
          maxItems: DIGEST_DETAIL_ITEM_LIMIT,
        });

        // Same selection logic as before — use the new-card selection if
        // non-empty, else fall back to previous cards.
        let selection = resolveDeliverySelection({
          newCards: rawCards,
          previousCards: [],
          customCriteria: row.userSub.customCriteria,
          now: new Date(),
          maxItems: DIGEST_DETAIL_ITEM_LIMIT,
        });
        if (selection.mode === 'empty') {
          const previousCards = await loadPreviouslyDeliveredCards(db, row.userSub.id);
          selection = resolveDeliverySelection({
            newCards: rawCards,
            previousCards,
            customCriteria: row.userSub.customCriteria,
            now: new Date(),
            maxItems: DIGEST_DETAIL_ITEM_LIMIT,
          });
        }

        // Build the user-facing delivery trace now; send result gets filled
        // in after the email send completes.
        const deliveryTrace: DeliveryTrace = {
          userSubId: row.userSub.id,
          userId: row.userSub.userId,
          industryName: row.industry.name,
          customCriteria: row.userSub.customCriteria,
          parsedCriteriaSummary: {
            groups: trace.parsedCriteria.groups.length,
            groupSummaries: trace.parsedCriteria.groups.map((g) =>
              `${g.name}(${g.terms.slice(0, 3).join('、')}${g.terms.length > 3 ? '…' : ''})`
            ),
            timeWindowDays: trace.parsedCriteria.timeWindowDays,
          },
          recipients,
          candidatesLoaded: rawCards.length,
          candidatesFiltered: {
            failsMeetsCriteria: filterStats.failsMeets,
            poolTotal: filterStats.allInPool,
          },
          scored: trace.scored.map<ScoredTraceCard>((s) => ({
            id: s.card.id,
            title: s.card.title,
            sourceName: s.card.sourceName ?? null,
            publishedAt: s.card.publishedAt ?? null,
            createdAt: s.card.createdAt,
            text: `${s.card.title} ${s.card.summary ?? ''}`.toLowerCase(),
            score: s.score.relevance,
            matched: s.matched,
            matchedTerms: s.matchedTerms,
            reason: s.reason,
            disposition: s.disposition,
          })),
          selectedCount: selection.selected.length,
          sendResult: 'pending',
          durationMs: Date.now() - startedAt,
        };
        traces.push(deliveryTrace);

        prepared.push({
          row,
          runId: runIdByIndustry.get(row.industry.id)!,
          mode: selection.mode,
          items: toDeliveryEmailItems(selection, selection.mode),
          selectedCardIds: selection.selected.map((item) => item.card.id),
        });
      }

      if (recipients.length === 0) {
        for (let i = 0; i < prepared.length; i++) {
          const item = prepared[i];
          const trace = traces[i];
          trace.sendResult = 'skipped';
          trace.sendError = '无有效收件邮箱';
          logDeliveryTrace(trace);
          console.log(summarizeTrace(trace));
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

      // Print the full trace for each user-row right after the send completes
      // so an admin tailing the server log sees the decision chain inline with
      // the cron tick that produced it.
      for (let i = 0; i < prepared.length; i++) {
        const item = prepared[i];
        const trace = traces[i];
        trace.sendResult = failed ? 'failed' : 'sent';
        trace.sendError = failed?.error;
        logDeliveryTrace(trace);
        console.log(summarizeTrace(trace));
      }

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
  const validRuns = refreshedRuns.filter((run): run is NonNullable<typeof run> => !!run);

  // Identify industry ids that the scheduler registered but the DB no longer
  // has (deleted between startup and this cron tick). Callers can use this
  // list to prune their in-memory cache so future ticks don't keep retrying.
  const missingIds: string[] = [];
  for (let i = 0; i < runEntries.length; i++) {
    if (runEntries[i].run === null) {
      missingIds.push(uniqueIndustryIds[i]);
    }
  }

  return { runs: validRuns, missing: missingIds };
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

  const subId = row.profile.sharedSubscriptionId;
  const rawCards = await db
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
    .where(eq(messageCards.subscriptionId, subId))
    .orderBy(desc(messageCards.createdAt))
    .limit(100);

  let selection = resolveDeliverySelection({
    newCards: rawCards,
    previousCards: [],
    customCriteria: row.userSub.customCriteria,
    now: new Date(),
    maxItems: row.industry.maxItemsPerEmail,
  });
  if (selection.mode === 'empty') {
    const previousCards = await loadPreviouslyDeliveredCards(db, row.userSub.id);
    selection = resolveDeliverySelection({
      newCards: rawCards,
      previousCards,
      customCriteria: row.userSub.customCriteria,
      now: new Date(),
      maxItems: row.industry.maxItemsPerEmail,
    });
  }

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
      reason: score.matchReason ?? `相关性 ${score.relevance}`,
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
