import { NextRequest, NextResponse } from 'next/server';
import { requireAgentAccess } from '@/lib/server/require-auth';
import MEDIA_CATEGORIES from '@/lib/media/categories';

// Редактирование названия / описания / категории медиафайла.
// Удаление — через существующий DELETE /knowledge/sources/[sourceId] (чистит и хранилище).
export async function PATCH(request: NextRequest, { params }: { params: { agentId: string; sourceId: string } }) {
  const access = await requireAgentAccess(params.agentId);
  if (!access.ok) return access.response;

  const body = await request.json().catch(() => ({}));

  const { data: source, error } = await access.admin
    .from('kb_sources')
    .select('id, title, metadata')
    .eq('id', params.sourceId)
    .eq('agent_id', params.agentId)
    .maybeSingle();

  if (error || !source) return NextResponse.json({ error: 'Файл не найден' }, { status: 404 });

  const next: Record<string, unknown> = { ...(source.metadata ?? {}) };
  let nextTitle: string | undefined;

  if (typeof body.title === 'string') {
    const t = body.title.trim().slice(0, 120);
    if (!t) return NextResponse.json({ error: 'Название не может быть пустым' }, { status: 400 });
    next.media_title = t;
    nextTitle = t;
  }
  if (typeof body.description === 'string') {
    next.media_description = body.description.trim().slice(0, 500);
  }
  if (typeof body.category === 'string') {
    if (!MEDIA_CATEGORIES.some((c) => c.id === body.category)) {
      return NextResponse.json({ error: 'Неверная категория' }, { status: 400 });
    }
    next.media_category = body.category;
  }

  const { error: updateError } = await access.admin
    .from('kb_sources')
    .update({ metadata: next, ...(nextTitle ? { title: nextTitle } : {}) })
    .eq('id', params.sourceId)
    .eq('agent_id', params.agentId);

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
