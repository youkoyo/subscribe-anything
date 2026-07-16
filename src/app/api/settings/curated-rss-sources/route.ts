import { asc, eq } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
import { requireAdmin } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { discoverySourceCatalog } from '@/lib/db/schema';
import { OPML_SOURCE_CATEGORIES, SOURCE_PREFERENCES } from '@/lib/discovery-sources/types';

const TRUST_LEVELS = ['high', 'medium', 'low'] as const;
const USAGE_ROLES = ['primary', 'supplementary', 'discovery'] as const;

function parseList(value: unknown) {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function validate(body: Record<string, unknown>) {
  if (typeof body.title !== 'string' || !body.title.trim()) return '名称不能为空';
  if (typeof body.feedUrl !== 'string') return 'RSS 地址不能为空';
  try {
    const url = new URL(body.feedUrl);
    if (!['http:', 'https:'].includes(url.protocol)) return 'RSS 地址必须使用 HTTP 或 HTTPS';
  } catch {
    return 'RSS 地址格式无效';
  }
  if (!OPML_SOURCE_CATEGORIES.includes(body.originalCategory as never)) return '分类无效';
  if (!(TRUST_LEVELS as readonly string[]).includes(String(body.trustLevel))) return '可信度无效';
  if (!(USAGE_ROLES as readonly string[]).includes(String(body.defaultUsage))) return '用途无效';
  if (parseList(body.preferences).some((value) => !SOURCE_PREFERENCES.includes(value as never))) return '信息源偏好无效';
  return null;
}

function toValues(body: Record<string, unknown>) {
  return {
    title: String(body.title).trim(),
    feedUrl: String(body.feedUrl).trim(),
    feedProvider: body.feedProvider === 'anyfeeder' ? 'anyfeeder' as const : 'direct' as const,
    originalCategory: String(body.originalCategory),
    preferencesJson: JSON.stringify(parseList(body.preferences)),
    trustLevel: String(body.trustLevel) as 'high' | 'medium' | 'low',
    defaultUsage: String(body.defaultUsage) as 'primary' | 'supplementary' | 'discovery',
    topicTagsJson: JSON.stringify(parseList(body.topicTags)),
    keywordsJson: JSON.stringify(parseList(body.keywords)),
    updatedAt: new Date(),
  };
}

export async function GET() {
  try {
    await requireAdmin();
    return Response.json(await getDb().select().from(discoverySourceCatalog).orderBy(asc(discoverySourceCatalog.title)));
  } catch (error) {
    return Response.json({ error: error instanceof Error && error.message === 'FORBIDDEN' ? 'Admin access required' : 'Failed to load curated RSS sources' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await requireAdmin();
    const body = await request.json() as Record<string, unknown>;
    const error = validate(body);
    if (error) return Response.json({ error }, { status: 400 });
    const db = getDb();
    const now = new Date();
    const [created] = await db.insert(discoverySourceCatalog).values({ id: createId(), ...toValues(body), isEnabled: true, healthStatus: 'unknown', lastValidatedAt: null, lastValidationError: null, createdAt: now }).returning();
    return Response.json(created, { status: 201 });
  } catch (error) {
    return Response.json({ error: 'Failed to create curated RSS source' }, { status: 500 });
  }
}
