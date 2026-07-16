import { and, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { subscriptions } from '@/lib/db/schema';
import { requireAuth } from '@/lib/auth';
import {
  industrySelectionErrorResponse,
  resolveSubscriptionIndustrySelection,
} from '@/lib/industry-configs/subscriptionSelection';
import { enqueueManagedPipelineJob } from '@/lib/background-jobs/queue';
import type { ManagedStartStep } from '@/lib/managed/pipeline';
import type { IndustryConfigSnapshot } from '@/lib/industry-configs/types';
import type { FoundSource, GeneratedSource } from '@/types/wizard';

// POST /api/subscriptions/managed
// Creates a placeholder subscription (or reuses an existing one) and starts
// the managed pipeline in the background.
export async function POST(req: Request) {
  try {
    const session = await requireAuth();
    if (!session.isAdmin) {
      return Response.json(
        { error: '普通用户请从产业目录发起订阅' },
        { status: 403 }
      );
    }

    const body = await req.json();
    const {
      topic,
      criteria,
      startStep = 'find_sources',
      foundSources,
      allFoundSources,
      generatedSources,
      existingSubscriptionId,
      industryConfigId,
      industryConfigSnapshot,
      skipPresetRss,
    } = body as {
      topic?: string;
      criteria?: string;
      startStep?: ManagedStartStep;
      foundSources?: FoundSource[];
      allFoundSources?: FoundSource[];
      generatedSources?: GeneratedSource[];
      existingSubscriptionId?: string; // reuse a manual_creating subscription
      industryConfigId?: string | null;
      industryConfigSnapshot?: IndustryConfigSnapshot | null;
      skipPresetRss?: boolean;
    };

    if (!topic || typeof topic !== 'string' || !topic.trim()) {
      return Response.json({ error: 'topic is required' }, { status: 400 });
    }

    let industrySelection;
    try {
      industrySelection = await resolveSubscriptionIndustrySelection(session.userId, {
        industryConfigId,
        industryConfigSnapshot,
      }, { isAdmin: session.isAdmin });
    } catch (err) {
      const response = industrySelectionErrorResponse(err);
      if (response) return response;
      throw err;
    }

    const db = getDb();
    const now = new Date();
    let subscriptionId: string;

    // Build initial wizardStateJson so takeover works even before pipeline writes state
    const initialStep = startStep === 'find_sources' ? 2 : startStep === 'generate_scripts' ? 3 : 4;
    // allFoundSources = full discovered list for display; foundSources = selected subset for generation
    const displaySources = allFoundSources ?? foundSources ?? [];
    const selectedUrls = new Set((foundSources ?? []).map((s) => s.url));
    const initialWizardState = JSON.stringify({
      step: initialStep,
      topic: topic.trim(),
      criteria: criteria?.trim() ?? '',
      industryConfigId: industrySelection.industryConfigId,
      industryConfigSnapshot: industrySelection.snapshot,
      foundSources: displaySources,
      selectedIndices: displaySources
        .map((s: FoundSource, i: number) => selectedUrls.has(s.url) ? i : -1)
        .filter((i: number) => i >= 0),
      generatedSources: generatedSources ?? [],
      skipPresetRss: skipPresetRss === true,
    });

    if (existingSubscriptionId) {
      // Reuse an existing manual_creating subscription — upgrade it to managed_creating
      const existing = (await db
        .select()
        .from(subscriptions)
        .where(and(
          eq(subscriptions.id, existingSubscriptionId),
          eq(subscriptions.userId, session.userId),
        )))[0];

      if (!existing || existing.managedStatus !== 'manual_creating') {
        return Response.json({ error: 'Subscription not found or not in manual_creating state' }, { status: 400 });
      }

      // Only update status — don't abort running tasks or clear logs.
      // The pipeline will wait for already-running tasks and skip completed ones.
      await db.update(subscriptions)
        .set({
          managedStatus: 'managed_creating',
          managedError: null,
          wizardStateJson: initialWizardState,
          industryConfigId: industrySelection.industryConfigId,
          industryConfigSnapshot: industrySelection.industryConfigSnapshot,
          updatedAt: now,
        })
        .where(eq(subscriptions.id, existingSubscriptionId));

      subscriptionId = existingSubscriptionId;
    } else {
      // Create a new placeholder subscription
      const subscription = (await db
        .insert(subscriptions)
        .values({
          userId: session.userId,
          topic: topic.trim(),
          criteria: criteria?.trim() || null,
          industryConfigId: industrySelection.industryConfigId,
          industryConfigSnapshot: industrySelection.industryConfigSnapshot,
          isEnabled: false,
          managedStatus: 'managed_creating',
          wizardStateJson: initialWizardState,
          unreadCount: 0,
          totalCount: 0,
          createdAt: now,
          updatedAt: now,
        })
        .returning())[0];

      subscriptionId = subscription.id;
    }

    await enqueueManagedPipelineJob(subscriptionId, {
      topic: topic.trim(),
      criteria: criteria?.trim(),
      startStep,
      userId: session.userId,
      industryConfigId: industrySelection.industryConfigId,
      industryConfigSnapshot: industrySelection.snapshot,
      foundSources,
      allFoundSources,
      generatedSources,
      skipPresetRss: skipPresetRss === true,
    });

    return Response.json({ id: subscriptionId }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('[subscriptions/managed POST]', err);
    return Response.json({ error: 'Failed to start managed creation' }, { status: 500 });
  }
}
