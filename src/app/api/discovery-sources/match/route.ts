import { requireAdmin } from '@/lib/auth';
import { matchCuratedSources } from '@/lib/discovery-sources/catalog';
import { listEnabledCatalogSources } from '@/lib/discovery-sources/repository';
import { SOURCE_PREFERENCES, type SourcePreference } from '@/lib/discovery-sources/types';

function toList(value: string | null): string[] {
  if (!value) return [];
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function toPreferences(value: string | null): SourcePreference[] {
  return toList(value).filter((item): item is SourcePreference =>
    SOURCE_PREFERENCES.includes(item as SourcePreference)
  );
}

export async function GET(request: Request) {
  try {
    await requireAdmin();
    const { searchParams } = new URL(request.url);
    const topic = searchParams.get('topic')?.trim() ?? '';
    const criteria = searchParams.get('criteria')?.trim() ?? '';

    if (!topic) return Response.json({ matches: [], total: 0 });

    const catalog = await listEnabledCatalogSources();
    const input = {
      topic,
      criteria,
      preferences: toPreferences(searchParams.get('preferences')),
      sourceTypes: toList(searchParams.get('sourceTypes')),
    };
    const allMatches = matchCuratedSources(catalog, input);
    const matches = matchCuratedSources(catalog, {
      ...input,
      limit: 6,
    });

    return Response.json({
      total: allMatches.length,
      matches: matches.map((match) => ({
        id: match.source.id,
        title: match.source.title,
        category: match.source.originalCategory,
        preferences: match.source.preferences,
        trustLevel: match.source.trustLevel,
        reasons: match.reasons,
      })),
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'FORBIDDEN') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }
    console.error('[discovery source match]', error);
    return Response.json({ error: 'Failed to match discovery sources' }, { status: 500 });
  }
}
