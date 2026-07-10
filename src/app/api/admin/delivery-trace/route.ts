// POST /api/admin/delivery-trace — admin only
//
// Re-runs the delivery scoring pipeline against the *current* pool state for a
// user-industry-subscription, without sending an email. Returns the full
// per-user DeliveryTrace so the admin can see exactly which cards would
// be selected, which were filtered by meets_criteria_flag or the time
// window, and how each surviving card scored against the user's criteria.
//
// Body:
//   { userIndustrySubscriptionId: string, lookbackDays?: number }
//
// lookbackDays defaults to 1 (the same window the cron uses) and can be
// raised when you want to debug "why didn't this card show up" cases.

import { and, eq, gt } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import {
  industryConfigs,
  industryMonitoringProfiles,
  messageCards,
  sources,
  userIndustrySubscriptions,
} from '@/lib/db/schema';
import { scoreCardsForTrace } from '@/lib/enterprise/deliveryScoring';
import { formatDeliveryTrace, type DeliveryTrace, type ScoredTraceCard } from '@/lib/enterprise/deliveryLogger';
import { parseRecipientEmailsJson } from '@/lib/enterprise/recipientEmails';
import { requireAdmin } from '@/lib/auth';

const DEFAULT_LOOKBACK_DAYS = 1;

export async function POST(req: Request) {
  try {
    await requireAdmin();
    const body = (await req.json().catch(() => null)) as
      | { userIndustrySubscriptionId?: string; lookbackDays?: number }
      | null;
    const userSubId = body?.userIndustrySubscriptionId?.trim();
    if (!userSubId) {
      return Response.json(
        { error: 'userIndustrySubscriptionId is required' },
        { status: 400 }
      );
    }
    const lookbackDays =
      typeof body?.lookbackDays === 'number' && body.lookbackDays > 0
        ? Math.min(body.lookbackDays, 365)
        : DEFAULT_LOOKBACK_DAYS;

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
      .where(eq(userIndustrySubscriptions.id, userSubId)))[0];

    if (!row) {
      return Response.json({ error: 'user-industry-subscription not found' }, { status: 404 });
    }
    if (!row.profile.sharedSubscriptionId) {
      return Response.json({ error: 'industry pool not built yet' }, { status: 400 });
    }

    const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

    // Counts at SQL level (so admin sees how many were filtered)
    const countRow = await db
      .select({
        allInPool: messageCards.id,
      })
      .from(messageCards)
      .where(eq(messageCards.subscriptionId, row.profile.sharedSubscriptionId));
    // Run a second pass with conditional counts. Drizzle's count helper returns strings
    // for bigint counts, but for these (pool sizes under 10k) we just use length.
    const allInPool = countRow.length;

    const failingMeets = (await db
      .select({ id: messageCards.id })
      .from(messageCards)
      .where(
        and(
          eq(messageCards.subscriptionId, row.profile.sharedSubscriptionId),
          eq(messageCards.meetsCriteriaFlag, false)
        )
      )).length;
    const candidates = await db
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
          eq(messageCards.meetsCriteriaFlag, true),
          gt(messageCards.createdAt, since)
        )
      )
      .orderBy(messageCards.createdAt);

    const trace = scoreCardsForTrace({
      cards: candidates,
      customCriteria: row.userSub.customCriteria,
      now: new Date(),
      maxItems: row.industry.maxItemsPerEmail,
    });

    const recipients = Array.from(
      new Set(parseRecipientEmailsJson(row.userSub.recipientEmailsJson))
    ).sort();

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
      candidatesLoaded: candidates.length,
      candidatesFiltered: {
        failsMeetsCriteria: failingMeets,
        poolTotal: allInPool,
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
      selectedCount: trace.selected.length,
      sendResult: 'pending',
      durationMs: 0,
    };

    return Response.json({
      trace: deliveryTrace,
      logLines: formatDeliveryTrace(deliveryTrace),
    });
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') {
      return new Response('Unauthorized', { status: 401 });
    }
    if (err instanceof Error && err.message === 'FORBIDDEN') {
      return new Response('Admin access required', { status: 403 });
    }
    console.error('[admin delivery-trace POST]', err);
    return new Response('Internal server error', { status: 500 });
  }
}
