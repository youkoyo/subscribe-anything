import { and, asc, eq, gte } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { subscriptions, managedBuildLogs } from '@/lib/db/schema';
import { requireAuth } from '@/lib/auth';

// GET /api/subscriptions/[id]/stream-progress
// SSE endpoint: streams managed_build_logs in real-time by polling the DB.
// Sends: { type: 'log', id, step, level, message, payload, createdAt }
//        { type: 'done', reason: 'complete' | 'deleted' }
// Closes when: subscription deleted, managedStatus becomes null (complete), or client disconnects.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth();
    const { id } = await params;
    const db = getDb();

    const sub = (await db
      .select({ managedStatus: subscriptions.managedStatus })
      .from(subscriptions)
      .where(and(eq(subscriptions.id, id), eq(subscriptions.userId, session.userId))))[0];

    if (!sub) {
      return Response.json({ error: 'Not found' }, { status: 404 });
    }

    const encoder = new TextEncoder();

    const STREAM_MAX_AGE_MS = 5 * 60 * 1000;
    let stopStream: (() => void) | null = null;

    const stream = new ReadableStream({
      async start(controller) {
        const send = (data: unknown) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
          } catch {
            // stream already closed — ignore
          }
        };

        const seenIds = new Set<string>();
        let closed = false;
        let lastSeenAt: Date | null = null;
        let polling = false;
        let interval: ReturnType<typeof setInterval> | null = null;
        let timeout: ReturnType<typeof setTimeout> | null = null;

        const close = () => {
          if (closed) return;
          closed = true;
          if (interval) clearInterval(interval);
          if (timeout) clearTimeout(timeout);
          try {
            controller.close();
          } catch {
            // already closed
          }
        };

        stopStream = close;

        const sendNewLogs = async (allowWhenBackpressured = false) => {
          // Do not keep querying Postgres for a browser that has stopped
          // consuming this stream. Success logs can contain scripts and RSS items.
          if (
            closed ||
            polling ||
            (!allowWhenBackpressured && controller.desiredSize !== null && controller.desiredSize <= 0)
          ) return undefined;
          polling = true;
          try {
            const logFilter = lastSeenAt
              ? and(
                  eq(managedBuildLogs.subscriptionId, id),
                  gte(managedBuildLogs.createdAt, lastSeenAt)
                )
              : eq(managedBuildLogs.subscriptionId, id);
            const logs = (await db
              .select()
              .from(managedBuildLogs)
              .where(logFilter)
              .orderBy(asc(managedBuildLogs.createdAt)));

            for (const log of logs) {
              if (!seenIds.has(log.id)) {
                seenIds.add(log.id);
                send({
                  type: 'log',
                  id: log.id,
                  step: log.step,
                  level: log.level,
                  message: log.message,
                  payload: log.payload ? JSON.parse(log.payload) : null,
                  createdAt: log.createdAt,
                });
              }
              if (!lastSeenAt || log.createdAt > lastSeenAt) lastSeenAt = log.createdAt;
            }

            // Check subscription status
            const current = (await db
              .select({ managedStatus: subscriptions.managedStatus })
              .from(subscriptions)
              .where(eq(subscriptions.id, id)))[0];

            return current;
          } finally {
            polling = false;
          }
        };

        // Send all existing logs immediately
        const initial = await sendNewLogs(true);
        if (!initial) {
          send({ type: 'done', reason: 'deleted' });
          close();
          return;
        }
        if (initial.managedStatus === null) {
          send({ type: 'done', reason: 'complete' });
          close();
          return;
        }

        // Poll for new logs every 800ms
        interval = setInterval(async () => {
          if (closed) {
            return;
          }
          const current = await sendNewLogs();
          if (current === undefined) return;
          if (!current) {
            send({ type: 'done', reason: 'deleted' });
            close();
          } else if (current.managedStatus === null) {
            send({ type: 'done', reason: 'complete' });
            close();
          }
        }, 800);

        // Safety: an abandoned view cannot retain a connection for 30 minutes.
        timeout = setTimeout(() => {
          close();
        }, STREAM_MAX_AGE_MS);

        // Handle client disconnect
        req.signal.addEventListener('abort', () => {
          close();
        });
      },
      cancel() {
        stopStream?.();
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('[stream-progress GET]', err);
    return Response.json({ error: 'Failed to stream progress' }, { status: 500 });
  }
}
