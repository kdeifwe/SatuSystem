import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { processSource } from '@/lib/server/knowledge/processor';
import { processInstagramSource } from '@/lib/server/knowledge/instagram';

export async function POST(req: Request, { params }: { params: { agentId: string; sourceId: string } }) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 });

    const admin = createAdminClient();
    const { data: source, error: fetchError } = await admin
      .from('kb_sources')
      .select('*')
      .eq('id', params.sourceId)
      .eq('agent_id', params.agentId)
      .single();

    if (fetchError || !source) {
      return NextResponse.json({ error: 'Источник не найден' }, { status: 404 });
    }

    if (source.status === 'processing') {
      return NextResponse.json({ error: 'Источник уже обрабатывается' }, { status: 409 });
    }

    const nextMetadata = {
      ...(source.metadata || {}),
      error: null,
      error_hint: null,
      failed_at: null,
      retry_count: (source.metadata?.retry_count ?? 0) + 1,
      retried_at: new Date().toISOString(),
    };

    const { error: updateError } = await admin
      .from('kb_sources')
      .update({
        status: 'processing',
        metadata: nextMetadata,
      })
      .eq('id', params.sourceId)
      .eq('agent_id', params.agentId);

    if (updateError) {
      console.error('[KB] Failed to reset source status:', updateError);
      return NextResponse.json({ error: 'Ошибка сброса статуса' }, { status: 500 });
    }

    await admin.from('kb_chunks').delete().eq('source_id', params.sourceId).eq('agent_id', params.agentId);

    setImmediate(() => {
      const isInstagramSource = source.type === 'instagram' || source.metadata?.source_type === 'instagram';
      const instagramProfileUrl = source.metadata?.handle
        ? `https://www.instagram.com/${String(source.metadata.handle).replace(/^@/, '')}/`
        : source.title
          ? `https://www.instagram.com/${String(source.title).replace(/^@/, '')}/`
          : '';

      const runRetry = isInstagramSource
        ? processInstagramSource(params.sourceId, params.agentId, instagramProfileUrl)
        : processSource(params.sourceId, params.agentId, source.metadata?.use_ai !== false);

      return runRetry.catch((error) => {
        console.error('[KB] Retry processing failed:', error);
      });
    });

    console.log('[KB] Retry triggered for source:', params.sourceId);
    return NextResponse.json({ success: true, status: 'processing' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
