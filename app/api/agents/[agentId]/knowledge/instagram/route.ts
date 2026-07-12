import { createAdminClient } from '@/lib/supabase/admin';
import { parseInstagramProfileUrl, processInstagramSource } from '@/lib/server/knowledge/instagram';

export async function POST(request: Request, { params }: { params: { agentId: string } }) {
  try {
    const body = await request.json().catch(() => ({}));
    const profileUrl = typeof body?.profileUrl === 'string'
      ? body.profileUrl
      : typeof body?.username === 'string'
        ? body.username
        : '';

    console.log('[KB] Instagram POST payload:', { agentId: params.agentId, profileUrl });

    if (!profileUrl.trim()) {
      return Response.json({ error: 'profileUrl required' }, { status: 400 });
    }

    const parsed = parseInstagramProfileUrl(profileUrl);
    if (!parsed) {
      return Response.json({ error: 'Введите корректную ссылку на публичный Instagram-профиль' }, { status: 400 });
    }

    if (!process.env.APIFY_API_TOKEN?.trim()) {
      return Response.json(
        { error: 'APIFY_API_TOKEN не задан. Добавьте токен в .env или Supabase Vault и повторите.' },
        { status: 503 }
      );
    }

    const supabase = createAdminClient();
    const { data: source, error: sourceError } = await supabase
      .from('kb_sources')
      .insert({
        agent_id: params.agentId,
        type: 'instagram',
        title: `@${parsed.handle}`,
        raw_content: '',
        status: 'pending',
        metadata: {
          handle: parsed.handle,
          requested_posts: 120,
          provider: 'apify',
          source_type: 'instagram',
          error_hint: 'Проверьте ссылку, профиль должен быть публичным и доступным для сканирования.',
        },
      })
      .select('id, metadata')
      .single();

    if (sourceError || !source) {
      return Response.json({ error: sourceError?.message || 'Не удалось создать источник' }, { status: 500 });
    }

    setImmediate(async () => {
      try {
        await processInstagramSource(source.id, params.agentId, parsed.profileUrl);
      } catch (error: any) {
        console.error('[KB] Instagram processing failed:', source.id, error);
        try {
          const admin = createAdminClient();
          await admin.from('kb_sources').update({
            status: 'error',
            metadata: {
              handle: parsed.handle,
              requested_posts: 120,
              provider: 'apify',
              source_type: 'instagram',
              error_hint: 'Проверьте ссылку, профиль должен быть публичным и доступным для сканирования.',
              error: error?.message || String(error),
              failed_at: new Date().toISOString(),
            },
          }).eq('id', source.id);
        } catch (dbError) {
          console.error('[KB] Instagram failed to update source status:', source.id, dbError);
        }
      }
    });

    return Response.json({
      sourceId: source.id,
      source_id: source.id,
      status: 'pending',
      handle: parsed.handle,
      message: 'Сканирование запущено',
    });
  } catch (error: any) {
    console.error('[KB] Instagram parse failed:', error);
    return Response.json({ error: error.message || 'Неизвестная ошибка' }, { status: 500 });
  }
}
