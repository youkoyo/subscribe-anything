import { and, eq, inArray } from 'drizzle-orm';
import { requireAuth } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { backgroundJobs, subscriptions, workerHeartbeats } from '@/lib/db/schema';

const WORKER_OFFLINE_AFTER_MS = 15_000;

type ActiveJob = {
  id: string;
  type: string;
  status: 'queued' | 'running';
  priority: number;
  availableAt: Date;
  createdAt: Date;
  startedAt: Date | null;
  payload: string;
};

function belongsToSubscription(job: ActiveJob, subscriptionId: string) {
  try {
    return JSON.parse(job.payload).subscriptionId === subscriptionId;
  } catch {
    return false;
  }
}

function compareQueueOrder(left: ActiveJob, right: ActiveJob) {
  if (left.priority !== right.priority) return left.priority - right.priority;
  if (left.availableAt.getTime() !== right.availableAt.getTime()) {
    return left.availableAt.getTime() - right.availableAt.getTime();
  }
  return left.createdAt.getTime() - right.createdAt.getTime();
}

// GET /api/subscriptions/:id/job-status
// Gives the wizard an explainable queue state without exposing another user's topic.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireAuth();
    const { id } = await params;
    const db = getDb();
    const subscription = (await db.select({ id: subscriptions.id })
      .from(subscriptions)
      .where(and(eq(subscriptions.id, id), eq(subscriptions.userId, session.userId))))[0];
    if (!subscription) return Response.json({ error: 'Not found' }, { status: 404 });

    const [heartbeat, jobs] = await Promise.all([
      db.select().from(workerHeartbeats).where(eq(workerHeartbeats.id, 'primary')),
      db.select({
        id: backgroundJobs.id,
        type: backgroundJobs.type,
        status: backgroundJobs.status,
        priority: backgroundJobs.priority,
        availableAt: backgroundJobs.availableAt,
        createdAt: backgroundJobs.createdAt,
        startedAt: backgroundJobs.startedAt,
        payload: backgroundJobs.payload,
      }).from(backgroundJobs).where(inArray(backgroundJobs.status, ['queued', 'running'])),
    ]);

    const activeJobs = jobs as ActiveJob[];
    const batchJob = activeJobs
      .filter((job) => belongsToSubscription(job, id))
      .sort((left, right) => (left.status === right.status ? compareQueueOrder(left, right) : left.status === 'running' ? -1 : 1))[0] ?? null;
    const runningJob = activeJobs.find((job) => job.status === 'running') ?? null;
    const queuedAhead = batchJob?.status === 'queued'
      ? activeJobs.filter((job) => job.status === 'queued' && compareQueueOrder(job, batchJob) < 0).length
      : 0;
    const worker = heartbeat[0];
    const lastHeartbeatAt = worker?.lastHeartbeatAt ?? null;
    const online = Boolean(lastHeartbeatAt && Date.now() - lastHeartbeatAt.getTime() <= WORKER_OFFLINE_AFTER_MS);

    return Response.json({
      worker: {
        online,
        lastHeartbeatAt,
        currentJobId: worker?.currentJobId ?? null,
      },
      batch: batchJob ? {
        jobId: batchJob.id,
        status: batchJob.status,
        type: batchJob.type,
        queuedAhead,
      } : null,
      runningJob: runningJob ? {
        jobId: runningJob.id,
        type: runningJob.type,
        startedAt: runningJob.startedAt,
      } : null,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('[job-status GET]', error);
    return Response.json({ error: 'Failed to read background job status' }, { status: 500 });
  }
}
