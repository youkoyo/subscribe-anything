import { requireAdmin } from '@/lib/auth';
import { getAdminTodoSummary } from '@/lib/admin/todos';

export async function GET() {
  try {
    await requireAdmin();
    return Response.json(getAdminTodoSummary());
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (err instanceof Error && err.message === 'FORBIDDEN') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }
    console.error('[admin todos summary GET]', err);
    return Response.json({ error: 'Failed to load admin todo summary' }, { status: 500 });
  }
}
