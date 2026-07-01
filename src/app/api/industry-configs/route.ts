import { requireAuth } from '@/lib/auth';
import {
  createIndustryConfig,
  listIndustryConfigs,
  seedDefaultIndustryConfigsForUser,
} from '@/lib/industry-configs/service';
import type { IndustryConfigInput } from '@/lib/industry-configs/types';

// The service response includes suggestions produced by buildIndustrySubscriptionSuggestion.

function handleAuthError(err: unknown): Response | null {
  if (err instanceof Error && err.message === 'UNAUTHORIZED') {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return null;
}

function validateInput(body: IndustryConfigInput): string | null {
  if (!body.name || typeof body.name !== 'string' || !body.name.trim()) {
    return '产业名称不能为空';
  }
  return null;
}

export async function GET(req: Request) {
  try {
    const session = await requireAuth();
    const { searchParams } = new URL(req.url);
    const enabledOnly = searchParams.get('enabledOnly') === 'true';

    seedDefaultIndustryConfigsForUser(session.userId);

    return Response.json(listIndustryConfigs(session.userId, enabledOnly));
  } catch (err) {
    const authError = handleAuthError(err);
    if (authError) return authError;
    console.error('[industry-configs GET]', err);
    return Response.json({ error: 'Failed to load industry configs' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireAuth();
    const body = await req.json().catch(() => ({})) as IndustryConfigInput;
    const error = validateInput(body);
    if (error) return Response.json({ error }, { status: 400 });

    const created = createIndustryConfig(session.userId, body);
    return Response.json(created, { status: 201 });
  } catch (err) {
    const authError = handleAuthError(err);
    if (authError) return authError;
    console.error('[industry-configs POST]', err);
    return Response.json({ error: 'Failed to create industry config' }, { status: 500 });
  }
}
